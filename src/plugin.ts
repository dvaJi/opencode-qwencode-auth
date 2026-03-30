import { spawn } from "node:child_process";

import {
  QWEN_PROVIDER_ID,
  QWEN_API_CONFIG,
  QWEN_MODELS,
  getQwenHeaders,
} from "./constants";
import {
  generatePKCE,
  requestDeviceAuthorization,
  pollDeviceToken,
  tokenResponseToCredentials,
  SlowDownError,
  refreshAccessToken,
} from "./qwen/oauth.js";
import { retryWithBackoff, getErrorStatus } from "./utils/retry.js";
import {
  RequestQueue,
  parseRateLimitReason,
  extractRetryAfterMs,
  getBackoffMs,
} from "./plugin/request-queue";
import { loadConfig, type QwenPluginConfig } from "./plugin/config/index";
import {
  loadAccounts,
  saveAccounts,
  selectAccount,
  markRateLimited,
  recordFailure,
  recordSuccess,
  getMinRateLimitWait,
  updateAccount,
  type AccountStorage,
  type QwenAccount,
} from "./plugin/account.js";
import {
  getHealthTracker,
  getTokenTracker,
  initHealthTracker,
  initTokenTracker,
  type RotationStrategy,
} from "./plugin/rotation.js";
import { createDebugLogger } from "./utils/debug-logger";

const debugLogger = createDebugLogger("PLUGIN");

let config: QwenPluginConfig;
let accountStorage: AccountStorage | null = null;
let requestQueue: RequestQueue;
let initialized = false;

async function initialize(): Promise<void> {
  if (initialized) return;

  config = await loadConfig();
  accountStorage = await loadAccounts();

  const healthConfig = config.health_score
    ? {
        initial: config.health_score.initial,
        successReward: config.health_score.success_reward,
        rateLimitPenalty: config.health_score.rate_limit_penalty,
        failurePenalty: config.health_score.failure_penalty,
        recoveryRatePerHour: config.health_score.recovery_rate_per_hour,
        minUsable: config.health_score.min_usable,
      }
    : undefined;

  const tokenBucketConfig = config.token_bucket
    ? {
        maxTokens: config.token_bucket.max_tokens,
        regenerationRatePerMinute:
          config.token_bucket.regeneration_rate_per_minute,
      }
    : undefined;

  initHealthTracker(healthConfig);
  initTokenTracker(tokenBucketConfig);

  requestQueue = new RequestQueue();

  if (config.quiet_mode) {
    process.env.OPENCODE_QWEN_DEBUG = "0";
  }

  initialized = true;
  debugLogger.info("Plugin initialized", {
    rotationStrategy: config.rotation_strategy,
    proactiveRefresh: config.proactive_refresh,
  });
}

function ensureStorageFromAuth(auth: {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
}): AccountStorage {
  return {
    version: 1,
    accounts: [
      {
        refreshToken: auth.refresh,
        accessToken: auth.access,
        expires: auth.expires,
        resourceUrl: auth.resourceUrl,
        addedAt: Date.now(),
        lastUsed: Date.now(),
      },
    ],
    activeIndex: 0,
  };
}

async function refreshAccountToken(
  account: QwenAccount,
  accountIndex: number,
): Promise<QwenAccount | null> {
  try {
    const refreshed = await refreshAccessToken(account.refreshToken);
    const updated: QwenAccount = {
      ...account,
      refreshToken: refreshed.refreshToken ?? account.refreshToken,
      accessToken: refreshed.accessToken,
      expires: refreshed.expiryDate,
      resourceUrl: refreshed.resourceUrl ?? account.resourceUrl,
      lastUsed: Date.now(),
    };

    if (accountStorage) {
      accountStorage = updateAccount(accountStorage, accountIndex, {
        refreshToken: updated.refreshToken,
        accessToken: updated.accessToken,
        expires: updated.expires,
        resourceUrl: updated.resourceUrl,
        lastUsed: updated.lastUsed,
      });
      await saveAccounts(accountStorage);
    }

    return updated;
  } catch (error) {
    debugLogger.error("Token refresh failed", {
      accountIndex,
      error: error instanceof Error ? error.message : String(error),
    });

    if (accountStorage) {
      accountStorage = markRateLimited(accountStorage, accountIndex, 60000);
      await saveAccounts(accountStorage);
    }

    return null;
  }
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? "open"
        : platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const args =
      platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.unref?.();
  } catch {
    console.error("\n[Qwen Auth] Unable to open browser automatically.");
    console.error("Please open this URL manually to authenticate:\n");
    console.error(`  ${url}\n`);
  }
}

// ============================================
// Plugin Principal
// ====================================

export const QwenAuthPlugin = async (_input: unknown) => {
  await initialize();

  return {
    auth: {
      provider: QWEN_PROVIDER_ID,

      loader: async (
        getAuth: any,
        provider: {
          models?: Record<string, { cost?: { input: number; output: number } }>;
        },
      ) => {
        if (provider?.models) {
          for (const model of Object.values(provider.models)) {
            if (model) model.cost = { input: 0, output: 0 };
          }
        }

        const auth = (await getAuth()) as {
          access?: string;
          refresh?: string;
          expires?: number;
          resourceUrl?: string;
        } | null;

        if (!auth?.access || !auth?.refresh) return null;

        if (!accountStorage) {
          accountStorage = {
            version: 1,
            accounts: [
              {
                refreshToken: auth.refresh,
                accessToken: auth.access,
                expires: auth.expires,
                resourceUrl: auth.resourceUrl,
                addedAt: Date.now(),
                lastUsed: Date.now(),
              },
            ],
            activeIndex: 0,
          };
          await saveAccounts(accountStorage);
        }

        const baseURL = auth.resourceUrl
          ? auth.resourceUrl.includes("portal.qwen.ai")
            ? QWEN_API_CONFIG.portalBaseUrl
            : QWEN_API_CONFIG.defaultBaseUrl
          : QWEN_API_CONFIG.baseUrl;

        return {
          apiKey: auth.access,
          baseURL,
          headers: getQwenHeaders(),
          fetch: async (url: string, options: any = {}) => {
            return requestQueue.enqueue(async () => {
              let attempts = 0;
              const healthTracker = getHealthTracker();
              const tokenTracker = getTokenTracker();
              const pidOffset = config.pid_offset_enabled ? process.pid : 0;

              const executeRequest = async (): Promise<Response> => {
                if (!accountStorage || accountStorage.accounts.length === 0) {
                  throw new Error(
                    "No accounts available. Please authenticate.",
                  );
                }

                const now = Date.now();
                const selection = selectAccount(
                  accountStorage,
                  config.rotation_strategy,
                  now,
                  { healthTracker, tokenTracker, pidOffset },
                );

                if (!selection) {
                  const waitMs = getMinRateLimitWait(accountStorage, now);
                  if (!waitMs) {
                    throw new Error(
                      "No available Qwen OAuth accounts. Re-authenticate to continue.",
                    );
                  }

                  const maxWaitMs = config.max_rate_limit_wait_seconds * 1000;
                  if (maxWaitMs > 0 && waitMs > maxWaitMs) {
                    throw new Error(
                      "All Qwen OAuth accounts are rate-limited. Try again later.",
                    );
                  }

                  await new Promise((resolve) => setTimeout(resolve, waitMs));
                  return executeRequest();
                }

                accountStorage = selection.storage;
                const account = selection.account;
                const accountIndex = selection.index;

                let token = account.accessToken;
                const accountExpires = account.expires;

                const needsRefresh =
                  config.proactive_refresh &&
                  accountExpires &&
                  accountExpires - config.refresh_window_seconds * 1000 < now;

                if (!token || needsRefresh) {
                  const refreshed = await refreshAccountToken(
                    account,
                    accountIndex,
                  );
                  if (refreshed) {
                    token = refreshed.accessToken;
                  } else if (!token) {
                    throw new Error("Failed to refresh token");
                  }
                }

                const mergedHeaders: Record<string, string> = {
                  ...getQwenHeaders(),
                };

                if (options.headers) {
                  if (typeof (options.headers as any).entries === "function") {
                    for (const [k, v] of (options.headers as any).entries()) {
                      const kl = k.toLowerCase();
                      if (
                        !kl.startsWith("x-dashscope") &&
                        kl !== "user-agent" &&
                        kl !== "authorization"
                      ) {
                        mergedHeaders[k] = v;
                      }
                    }
                  } else {
                    for (const [k, v] of Object.entries(options.headers)) {
                      const kl = k.toLowerCase();
                      if (
                        !kl.startsWith("x-dashscope") &&
                        kl !== "user-agent" &&
                        kl !== "authorization"
                      ) {
                        mergedHeaders[k] = v as string;
                      }
                    }
                  }
                }

                mergedHeaders["Authorization"] = `Bearer ${token}`;

                const response = await fetch(url, {
                  ...options,
                  headers: mergedHeaders,
                });

                if (response.status === 401) {
                  accountStorage = markRateLimited(
                    accountStorage,
                    accountIndex,
                    60000,
                  );
                  accountStorage = recordFailure(accountStorage, accountIndex);
                  healthTracker.recordFailure(accountIndex);
                  await saveAccounts(accountStorage);

                  attempts++;
                  if (attempts >= accountStorage.accounts.length) {
                    throw new Error("All accounts failed with 401");
                  }
                  return executeRequest();
                }

                if (response.status === 429 || response.status >= 500) {
                  const reason = parseRateLimitReason(response);
                  const headerMs = extractRetryAfterMs(response);
                  const tieredMs = getBackoffMs(reason, attempts);
                  const retryAfterMs = headerMs ?? tieredMs;

                  accountStorage = markRateLimited(
                    accountStorage,
                    accountIndex,
                    retryAfterMs,
                  );

                  if (response.status === 429) {
                    healthTracker.recordRateLimit(accountIndex);
                  } else {
                    healthTracker.recordFailure(accountIndex);
                  }

                  accountStorage = recordFailure(accountStorage, accountIndex);
                  await saveAccounts(accountStorage);

                  attempts++;
                  if (attempts >= accountStorage.accounts.length) {
                    const waitMs = getMinRateLimitWait(
                      accountStorage,
                      Date.now(),
                    );
                    if (waitMs) {
                      await new Promise((resolve) =>
                        setTimeout(resolve, waitMs),
                      );
                      attempts = 0;
                      return executeRequest();
                    }
                    return response;
                  }
                  return executeRequest();
                }

                accountStorage = recordSuccess(accountStorage, accountIndex);
                healthTracker.recordSuccess(accountIndex);
                await saveAccounts(accountStorage);

                return response;
              };

              return retryWithBackoff(() => executeRequest(), {
                authType: "qwen-oauth",
                maxAttempts: 7,
                shouldRetryOnError: (error: any) => {
                  const status = error.status || getErrorStatus(error);
                  return (
                    status === 401 ||
                    status === 429 ||
                    (status !== undefined && status >= 500 && status < 600)
                  );
                },
              });
            });
          },
        };
      },

      methods: [
        {
          type: "oauth" as const,
          label: "Qwen Code (qwen.ai OAuth)",
          authorize: async () => {
            const { verifier, challenge } = generatePKCE();

            try {
              const deviceAuth = await requestDeviceAuthorization(challenge);
              openBrowser(deviceAuth.verification_uri_complete);

              const POLLING_MARGIN_MS = 3000;

              return {
                url: deviceAuth.verification_uri_complete,
                instructions: `Code: ${deviceAuth.user_code}`,
                method: "auto" as const,
                callback: async () => {
                  const startTime = Date.now();
                  const timeoutMs = deviceAuth.expires_in * 1000;
                  let interval = 5000;

                  while (Date.now() - startTime < timeoutMs) {
                    await new Promise((resolve) =>
                      setTimeout(resolve, interval + POLLING_MARGIN_MS),
                    );

                    try {
                      const tokenResponse = await pollDeviceToken(
                        deviceAuth.device_code,
                        verifier,
                      );

                      if (tokenResponse) {
                        const credentials =
                          tokenResponseToCredentials(tokenResponse);

                        accountStorage = {
                          version: 1,
                          accounts: [
                            {
                              refreshToken: credentials.refreshToken ?? "",
                              accessToken: credentials.accessToken,
                              expires: credentials.expiryDate,
                              resourceUrl: credentials.resourceUrl,
                              addedAt: Date.now(),
                              lastUsed: Date.now(),
                            },
                          ],
                          activeIndex: 0,
                        };
                        await saveAccounts(accountStorage);

                        return {
                          type: "success" as const,
                          access: credentials.accessToken,
                          refresh: credentials.refreshToken ?? "",
                          expires:
                            credentials.expiryDate || Date.now() + 3600000,
                        };
                      }
                    } catch (e) {
                      if (e instanceof SlowDownError) {
                        interval = Math.min(interval + 5000, 15000);
                      } else if (
                        !(e instanceof Error) ||
                        !e.message.includes("authorization_pending")
                      ) {
                        return { type: "failed" as const };
                      }
                    }
                  }

                  return { type: "failed" as const };
                },
              };
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Unknown error";
              return {
                url: "",
                instructions: `Error: ${msg}`,
                method: "auto" as const,
                callback: async () => ({ type: "failed" as const }),
              };
            }
          },
        },
      ],
    },

    config: async (config: Record<string, unknown>) => {
      const providers = (config.provider as Record<string, unknown>) || {};

      providers[QWEN_PROVIDER_ID] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Qwen Code",
        options: {
          baseURL: QWEN_API_CONFIG.baseUrl,
          headers: getQwenHeaders(),
        },
        models: Object.fromEntries(
          Object.entries(QWEN_MODELS).map(([id, m]) => {
            const hasVision = "capabilities" in m && m.capabilities?.vision;
            return [
              id,
              {
                id: m.id,
                name: m.name,
                reasoning: m.reasoning,
                limit: { context: m.contextWindow, output: m.maxOutput },
                cost: m.cost,
                modalities: {
                  input: hasVision ? ["text", "image"] : ["text"],
                  output: ["text"],
                },
              },
            ];
          }),
        ),
      };

      config.provider = providers;
    },
  };
};

export default QwenAuthPlugin;
