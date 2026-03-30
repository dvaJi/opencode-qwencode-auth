/**
 * Request Queue with throttling and rate limit handling
 * Prevents hitting rate limits by controlling request frequency
 * Supports server hints via retry-after-ms and x-error-code headers
 */

import { createDebugLogger } from "../utils/debug-logger.js";

const debugLogger = createDebugLogger("REQUEST_QUEUE");

export type RateLimitReason =
  | "QUOTA_EXHAUSTED"
  | "RATE_LIMIT_EXCEEDED"
  | "SERVER_ERROR"
  | "UNKNOWN";

const BACKOFF_TIERS: Record<RateLimitReason, number[]> = {
  QUOTA_EXHAUSTED: [60_000, 300_000, 1800_000],
  RATE_LIMIT_EXCEEDED: [30_000, 60_000],
  SERVER_ERROR: [20_000, 40_000],
  UNKNOWN: [60_000],
};

export interface RateLimitInfo {
  reason: RateLimitReason;
  retryAfterMs: number | null;
}

export function parseRateLimitReason(response: Response): RateLimitReason {
  const errorHeader = response.headers.get("x-error-code");
  if (errorHeader) {
    const upper = errorHeader.toUpperCase();
    if (upper.includes("QUOTA")) return "QUOTA_EXHAUSTED";
    if (upper.includes("RATE")) return "RATE_LIMIT_EXCEEDED";
    if (upper.includes("SERVER") || upper.includes("CAPACITY"))
      return "SERVER_ERROR";
  }
  if (response.status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

export function extractRetryAfterMs(response: Response): number | null {
  const retryAfterMs = response.headers.get("retry-after-ms");
  if (retryAfterMs) {
    const value = Number.parseInt(retryAfterMs, 10);
    if (!Number.isNaN(value) && value > 0) {
      return value;
    }
  }

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const value = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(value) && value > 0) {
      return value * 1000;
    }
  }

  return null;
}

export function getBackoffMs(
  reason: RateLimitReason,
  consecutiveFailures: number,
): number {
  const tier = BACKOFF_TIERS[reason];
  const index = Math.min(consecutiveFailures, tier.length - 1);
  const value = tier[index];
  if (value !== undefined) return value;
  return tier[0] ?? 60_000;
}

export class RequestQueue {
  private lastRequestTime = 0;
  private readonly MIN_INTERVAL = 1000;
  private readonly JITTER_MIN = 500;
  private readonly JITTER_MAX = 1500;
  private globalRetryAfterMs: number | null = null;

  /**
   * Get random jitter between JITTER_MIN and JITTER_MAX
   */
  private getJitter(): number {
    return (
      Math.random() * (this.JITTER_MAX - this.JITTER_MIN) + this.JITTER_MIN
    );
  }

  /**
   * Set global rate limit - applies to all subsequent requests
   */
  setGlobalRateLimit(retryAfterMs: number): void {
    this.globalRetryAfterMs = retryAfterMs;
    debugLogger.info(`Global rate limit set: ${retryAfterMs}ms`);
  }

  /**
   * Clear global rate limit
   */
  clearGlobalRateLimit(): void {
    this.globalRetryAfterMs = null;
  }

  /**
   * Execute a function with throttling
   * Ensures minimum interval between requests + random jitter
   */
  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.globalRetryAfterMs) {
      const waitMs = this.globalRetryAfterMs;
      debugLogger.info(
        `Global rate limit active, waiting ${waitMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.globalRetryAfterMs = null;
    }

    const elapsed = Date.now() - this.lastRequestTime;
    const waitTime = Math.max(0, this.MIN_INTERVAL - elapsed);

    if (waitTime > 0) {
      const jitter = this.getJitter();
      const totalWait = waitTime + jitter;

      debugLogger.debug(
        `Throttling: waiting ${totalWait.toFixed(0)}ms (${waitTime.toFixed(0)}ms + ${jitter.toFixed(0)}ms jitter)`,
      );

      await new Promise((resolve) => setTimeout(resolve, totalWait));
    }

    this.lastRequestTime = Date.now();
    return fn();
  }
}
