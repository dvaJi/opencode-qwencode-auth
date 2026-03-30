import { describe, test, expect, beforeEach } from "bun:test";
import { QwenConfigSchema, HealthScoreConfigSchema, TokenBucketConfigSchema } from "../src/plugin/config/schema.js";

describe("QwenConfigSchema", () => {
  test("parses valid config with defaults", () => {
    const config = QwenConfigSchema.parse({});
    
    expect(config.rotation_strategy).toBe("round-robin");
    expect(config.proactive_refresh).toBe(true);
    expect(config.quiet_mode).toBe(false);
    expect(config.client_id).toBe("f0304373b74a44d2b584a3fb70ca9e56");
  });

  test("parses custom rotation strategy", () => {
    const config = QwenConfigSchema.parse({ rotation_strategy: "hybrid" });
    expect(config.rotation_strategy).toBe("hybrid");
  });

  test("parses custom refresh settings", () => {
    const config = QwenConfigSchema.parse({
      proactive_refresh: false,
      refresh_window_seconds: 600,
    });
    
    expect(config.proactive_refresh).toBe(false);
    expect(config.refresh_window_seconds).toBe(600);
  });

  test("parses health_score config", () => {
    const config = QwenConfigSchema.parse({
      health_score: {
        initial: 80,
        min_usable: 60,
      },
    });
    
    expect(config.health_score).toBeDefined();
    expect(config.health_score!.initial).toBe(80);
    expect(config.health_score!.min_usable).toBe(60);
  });

  test("parses token_bucket config", () => {
    const config = QwenConfigSchema.parse({
      token_bucket: {
        max_tokens: 100,
        regeneration_rate_per_minute: 10,
      },
    });
    
    expect(config.token_bucket).toBeDefined();
    expect(config.token_bucket!.max_tokens).toBe(100);
  });

  test("rejects invalid rotation strategy", () => {
    expect(() => {
      QwenConfigSchema.parse({ rotation_strategy: "invalid" });
    }).toThrow();
  });
});

describe("HealthScoreConfigSchema", () => {
  test("uses defaults when empty", () => {
    const config = HealthScoreConfigSchema.parse({});
    
    expect(config.initial).toBe(70);
    expect(config.min_usable).toBe(50);
    expect(config.success_reward).toBe(1);
  });

  test("validates min_usable range", () => {
    expect(() => {
      HealthScoreConfigSchema.parse({ min_usable: 150 });
    }).toThrow();
  });
});

describe("TokenBucketConfigSchema", () => {
  test("uses defaults when empty", () => {
    const config = TokenBucketConfigSchema.parse({});
    
    expect(config.max_tokens).toBe(50);
    expect(config.regeneration_rate_per_minute).toBe(6);
  });

  test("validates max_tokens minimum", () => {
    expect(() => {
      TokenBucketConfigSchema.parse({ max_tokens: 0 });
    }).toThrow();
  });
});
