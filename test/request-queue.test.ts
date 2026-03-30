import { describe, test, expect, beforeEach } from "bun:test";
import {
  RequestQueue,
  parseRateLimitReason,
  extractRetryAfterMs,
  getBackoffMs,
} from "../src/plugin/request-queue.js";

describe("RequestQueue", () => {
  let queue: RequestQueue;

  beforeEach(() => {
    queue = new RequestQueue();
  });

  test("enqueues requests and maintains minimum interval", async () => {
    const callTimes: number[] = [];

    for (let i = 0; i < 3; i++) {
      await queue.enqueue(() => {
        callTimes.push(Date.now());
        return Promise.resolve();
      });
    }

    expect(callTimes.length).toBe(3);
    const interval1 = callTimes[1]! - callTimes[0]!;
    const interval2 = callTimes[2]! - callTimes[1]!;
    expect(interval1).toBeGreaterThanOrEqual(1000);
    expect(interval2).toBeGreaterThanOrEqual(1000);
  });

  test("respects global rate limit", async () => {
    queue.setGlobalRateLimit(50);
    const start = Date.now();

    await queue.enqueue(() => Promise.resolve());

    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  test("clears global rate limit after use", async () => {
    queue.setGlobalRateLimit(50);
    await queue.enqueue(() => Promise.resolve());

    // After using global rate limit, should fall back to normal throttling
    // which is around 1s + jitter, so it should be > 500ms but < 3000ms
    const start = Date.now();
    await queue.enqueue(() => Promise.resolve());
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThan(500);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe("parseRateLimitReason", () => {
  test("parses QUOTA from x-error-code header", () => {
    const response = new Response(null, {
      status: 429,
      headers: { "x-error-code": "QUOTA_EXCEEDED" },
    });
    expect(parseRateLimitReason(response)).toBe("QUOTA_EXHAUSTED");
  });

  test("parses RATE from x-error-code header", () => {
    const response = new Response(null, {
      status: 429,
      headers: { "x-error-code": "RATE_LIMIT" },
    });
    expect(parseRateLimitReason(response)).toBe("RATE_LIMIT_EXCEEDED");
  });

  test("returns SERVER_ERROR for 5xx", () => {
    const response = new Response(null, { status: 503 });
    expect(parseRateLimitReason(response)).toBe("SERVER_ERROR");
  });

  test("returns UNKNOWN for 429 without header", () => {
    const response = new Response(null, { status: 429 });
    expect(parseRateLimitReason(response)).toBe("UNKNOWN");
  });
});

describe("extractRetryAfterMs", () => {
  test("extracts retry-after-ms header", () => {
    const response = new Response(null, {
      headers: { "retry-after-ms": "5000" },
    });
    expect(extractRetryAfterMs(response)).toBe(5000);
  });

  test("extracts retry-after header as seconds", () => {
    const response = new Response(null, {
      headers: { "retry-after": "10" },
    });
    expect(extractRetryAfterMs(response)).toBe(10000);
  });

  test("returns null when no header", () => {
    const response = new Response(null);
    expect(extractRetryAfterMs(response)).toBeNull();
  });

  test("returns null for invalid values", () => {
    const response = new Response(null, {
      headers: { "retry-after-ms": "invalid" },
    });
    expect(extractRetryAfterMs(response)).toBeNull();
  });
});

describe("getBackoffMs", () => {
  test("returns tiered backoff for QUOTA_EXHAUSTED", () => {
    expect(getBackoffMs("QUOTA_EXHAUSTED", 0)).toBe(60000);
    expect(getBackoffMs("QUOTA_EXHAUSTED", 1)).toBe(300000);
    expect(getBackoffMs("QUOTA_EXHAUSTED", 5)).toBe(1800000);
  });

  test("returns tiered backoff for RATE_LIMIT_EXCEEDED", () => {
    expect(getBackoffMs("RATE_LIMIT_EXCEEDED", 0)).toBe(30000);
    expect(getBackoffMs("RATE_LIMIT_EXCEEDED", 1)).toBe(60000);
    expect(getBackoffMs("RATE_LIMIT_EXCEEDED", 5)).toBe(60000);
  });

  test("returns tiered backoff for SERVER_ERROR", () => {
    expect(getBackoffMs("SERVER_ERROR", 0)).toBe(20000);
    expect(getBackoffMs("SERVER_ERROR", 1)).toBe(40000);
    expect(getBackoffMs("SERVER_ERROR", 5)).toBe(40000);
  });
});
