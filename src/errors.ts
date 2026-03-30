const REAUTH_HINT =
  'Run "opencode auth login" and select "Qwen Code (qwen.ai OAuth)" to authenticate.';

// ============================================
// Token Manager Error Types
// ============================================

export enum TokenError {
  REFRESH_FAILED = "REFRESH_FAILED",
  NO_REFRESH_TOKEN = "NO_REFRESH_TOKEN",
  LOCK_TIMEOUT = "LOCK_TIMEOUT",
  FILE_ACCESS_ERROR = "FILE_ACCESS_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  CREDENTIALS_CLEAR_REQUIRED = "CREDENTIALS_CLEAR_REQUIRED",
}

// ============================================
// Authentication Errors
// ============================================

export type AuthErrorKind =
  | "token_expired"
  | "refresh_failed"
  | "auth_required"
  | "credentials_clear_required";

const AUTH_MESSAGES: Record<AuthErrorKind, string> = {
  token_expired: `[Qwen] Token expired. ${REAUTH_HINT}`,
  refresh_failed: `[Qwen] Failed to refresh token. ${REAUTH_HINT}`,
  auth_required: `[Qwen] Authentication required. ${REAUTH_HINT}`,
  credentials_clear_required: `[Qwen] Credentials invalid or revoked. ${REAUTH_HINT}`,
};

export class QwenAuthError extends Error {
  public readonly kind: AuthErrorKind;
  public readonly technicalDetail?: string;

  constructor(kind: AuthErrorKind, technicalDetail?: string) {
    super(AUTH_MESSAGES[kind]);
    this.name = "QwenAuthError";
    this.kind = kind;
    this.technicalDetail = technicalDetail;
  }
}

export class CredentialsClearRequiredError extends QwenAuthError {
  constructor(technicalDetail?: string) {
    super("credentials_clear_required", technicalDetail);
    this.name = "CredentialsClearRequiredError";
  }
}

export class TokenManagerError extends Error {
  public readonly type: TokenError;
  public readonly technicalDetail?: string;

  constructor(type: TokenError, message: string, technicalDetail?: string) {
    super(message);
    this.name = "TokenManagerError";
    this.type = type;
    this.technicalDetail = technicalDetail;
  }
}

// ============================================
// API Errors
// ============================================

export type RateLimitReason = "QUOTA_EXHAUSTED" | "RATE_LIMIT_EXCEEDED" | "SERVER_ERROR" | "UNKNOWN";

export type ApiErrorKind =
  | "quota_exhausted"
  | "rate_limit"
  | "unauthorized"
  | "forbidden"
  | "server_error"
  | "network_error"
  | "unknown";

function classifyApiStatus(
  statusCode: number,
  errorCode?: string,
): {
  message: string;
  kind: ApiErrorKind;
  reason: RateLimitReason;
} {
  if (statusCode === 401 || statusCode === 403) {
    return {
      message: `[Qwen] Token invalid or expired. ${REAUTH_HINT}`,
      kind: "unauthorized",
      reason: "UNKNOWN",
    };
  }

  if (statusCode === 429) {
    if (errorCode?.toUpperCase().includes("QUOTA")) {
      return {
        message: "[Qwen] Daily quota exhausted. Use multiple accounts or try again tomorrow.",
        kind: "quota_exhausted",
        reason: "QUOTA_EXHAUSTED",
      };
    }
    return {
      message: "[Qwen] Rate limit reached. Please wait a few minutes before trying again.",
      kind: "rate_limit",
      reason: "RATE_LIMIT_EXCEEDED",
    };
  }

  if (statusCode >= 500 || errorCode?.toUpperCase().includes("CAPACITY")) {
    return {
      message: `[Qwen] Qwen server unavailable (error ${statusCode}). Please try again later.`,
      kind: "server_error",
      reason: "SERVER_ERROR",
    };
  }

  return {
    message: `[Qwen] Qwen API error (${statusCode}). Check your connection and try again.`,
    kind: "unknown",
    reason: "UNKNOWN",
  };
}

export class QwenApiError extends Error {
  public readonly statusCode: number;
  public readonly kind: ApiErrorKind;
  public readonly reason: RateLimitReason;
  public readonly retryAfterMs: number | null;
  public readonly technicalDetail?: string;

  constructor(
    statusCode: number,
    options?: {
      errorCode?: string;
      retryAfterMs?: number | null;
      technicalDetail?: string;
    },
  ) {
    const classification = classifyApiStatus(statusCode, options?.errorCode);
    super(classification.message);
    this.name = "QwenApiError";
    this.statusCode = statusCode;
    this.kind = classification.kind;
    this.reason = classification.reason;
    this.retryAfterMs = options?.retryAfterMs ?? null;
    this.technicalDetail = options?.technicalDetail;
  }
}

export class QwenNetworkError extends Error {
  public readonly technicalDetail?: string;

  constructor(message: string, technicalDetail?: string) {
    super(`[Qwen] Network error: ${message}`);
    this.name = "QwenNetworkError";
    this.technicalDetail = technicalDetail;
  }
}

// ============================================
// Debug Logging Helper
// ============================================

export function logTechnicalDetail(detail: string): void {
  if (process.env.OPENCODE_QWEN_DEBUG === "1") {
    console.debug("[Qwen Debug]", detail);
  }
}

// ============================================
// Error Classification
// ============================================

export function classifyError(error: unknown): {
  kind: "auth" | "api" | "network" | "timeout" | "unknown";
  isRetryable: boolean;
  shouldClearCache: boolean;
  retryAfterMs?: number | null;
  reason?: RateLimitReason;
} {
  if (error instanceof CredentialsClearRequiredError) {
    return { kind: "auth", isRetryable: false, shouldClearCache: true };
  }

  if (error instanceof QwenAuthError) {
    return {
      kind: "auth",
      isRetryable: error.kind === "refresh_failed",
      shouldClearCache: error.kind === "credentials_clear_required",
    };
  }

  if (error instanceof QwenApiError) {
    return {
      kind: "api",
      isRetryable:
        error.kind === "rate_limit" ||
        error.kind === "quota_exhausted" ||
        error.kind === "server_error",
      shouldClearCache: false,
      retryAfterMs: error.retryAfterMs,
      reason: error.reason,
    };
  }

  if (error instanceof QwenNetworkError) {
    return { kind: "network", isRetryable: true, shouldClearCache: false };
  }

  if (error instanceof Error && error.name === "AbortError") {
    return { kind: "timeout", isRetryable: true, shouldClearCache: false };
  }

  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase();

    if (
      errorMessage.includes("fetch") ||
      errorMessage.includes("network") ||
      errorMessage.includes("timeout") ||
      errorMessage.includes("abort")
    ) {
      return { kind: "network", isRetryable: true, shouldClearCache: false };
    }
  }

  return { kind: "unknown", isRetryable: false, shouldClearCache: false };
}
