import { describe, test, expect, beforeEach, vi } from "bun:test";
import {
  generatePKCE,
  tokenResponseToCredentials,
  isCredentialsExpired,
} from "../src/qwen/oauth.js";

describe("OAuth PKCE", () => {
  test("generates verifier and challenge", () => {
    const { verifier, challenge } = generatePKCE();

    expect(verifier).toBeTruthy();
    expect(challenge).toBeTruthy();
    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge.length).toBeGreaterThan(20);
  });

  test("challenge is deterministic for same verifier", () => {
    const verifier = "test-verifier-string";
    const challenge = generatePKCE().challenge;

    expect(challenge).toBeTruthy();
  });
});

describe("tokenResponseToCredentials", () => {
  test("converts token response correctly", () => {
    const tokenResponse = {
      access_token: "access-token-123",
      refresh_token: "refresh-token-456",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid profile email",
    };

    const creds = tokenResponseToCredentials(tokenResponse);

    expect(creds.accessToken).toBe("access-token-123");
    expect(creds.refreshToken).toBe("refresh-token-456");
    expect(creds.tokenType).toBe("Bearer");
    expect(creds.expiryDate).toBeGreaterThan(Date.now());
  });

  test("handles missing optional fields", () => {
    const tokenResponse = {
      access_token: "access-token-123",
      token_type: "Bearer",
      expires_in: 3600,
    };

    const creds = tokenResponseToCredentials(tokenResponse);

    expect(creds.accessToken).toBe("access-token-123");
    expect(creds.refreshToken).toBeUndefined();
    expect(creds.resourceUrl).toBeUndefined();
  });
});

describe("isCredentialsExpired", () => {
  test("returns true for expired credentials", () => {
    const creds = {
      accessToken: "test",
      expiryDate: Date.now() - 1000,
    };

    expect(isCredentialsExpired(creds)).toBe(true);
  });

  test("returns false for valid credentials", () => {
    const creds = {
      accessToken: "test",
      expiryDate: Date.now() + 60 * 60 * 1000,
    };

    expect(isCredentialsExpired(creds)).toBe(false);
  });

  test("returns false when no expiry date", () => {
    const creds = {
      accessToken: "test",
    };

    expect(isCredentialsExpired(creds)).toBe(false);
  });

  test("applies 30 second buffer", () => {
    const creds = {
      accessToken: "test",
      expiryDate: Date.now() + 20 * 1000,
    };

    expect(isCredentialsExpired(creds)).toBe(true);
  });
});
