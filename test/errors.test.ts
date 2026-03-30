import { describe, test, expect } from "bun:test";
import {
  QwenApiError,
  QwenAuthError,
  CredentialsClearRequiredError,
  QwenNetworkError,
  classifyError,
} from "../src/errors.js";

describe("QwenApiError", () => {
  test("classifies 429 as rate_limit", () => {
    const error = new QwenApiError(429);
    expect(error.kind).toBe("rate_limit");
    expect(error.reason).toBe("RATE_LIMIT_EXCEEDED");
  });

  test("classifies 429 with QUOTA error code", () => {
    const error = new QwenApiError(429, { errorCode: "QUOTA_EXCEEDED" });
    expect(error.kind).toBe("quota_exhausted");
    expect(error.reason).toBe("QUOTA_EXHAUSTED");
  });

  test("classifies 401 as unauthorized", () => {
    const error = new QwenApiError(401);
    expect(error.kind).toBe("unauthorized");
  });

  test("classifies 503 as server_error", () => {
    const error = new QwenApiError(503);
    expect(error.kind).toBe("server_error");
    expect(error.reason).toBe("SERVER_ERROR");
  });

  test("extracts retry-after-ms", () => {
    const error = new QwenApiError(429, { retryAfterMs: 5000 });
    expect(error.retryAfterMs).toBe(5000);
  });
});

describe("classifyError", () => {
  test("classifies CredentialsClearRequiredError", () => {
    const error = new CredentialsClearRequiredError();
    const result = classifyError(error);

    expect(result.kind).toBe("auth");
    expect(result.isRetryable).toBe(false);
    expect(result.shouldClearCache).toBe(true);
  });

  test("classifies QwenAuthError (refresh_failed)", () => {
    const error = new QwenAuthError("refresh_failed");
    const result = classifyError(error);

    expect(result.kind).toBe("auth");
    expect(result.isRetryable).toBe(true);
  });

  test("classifies QwenApiError (rate_limit)", () => {
    const error = new QwenApiError(429);
    const result = classifyError(error);

    expect(result.kind).toBe("api");
    expect(result.isRetryable).toBe(true);
  });

  test("classifies QwenApiError (quota_exhausted)", () => {
    const error = new QwenApiError(429, { errorCode: "QUOTA_EXCEEDED" });
    const result = classifyError(error);

    expect(result.kind).toBe("api");
    expect(result.isRetryable).toBe(true);
    expect(result.reason).toBe("QUOTA_EXHAUSTED");
  });

  test("classifies QwenNetworkError", () => {
    const error = new QwenNetworkError("Connection failed");
    const result = classifyError(error);

    expect(result.kind).toBe("network");
    expect(result.isRetryable).toBe(true);
  });

  test("classifies AbortError as timeout", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    const result = classifyError(error);

    expect(result.kind).toBe("timeout");
    expect(result.isRetryable).toBe(true);
  });
});
