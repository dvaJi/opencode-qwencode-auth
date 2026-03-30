export type RotationStrategy = "round-robin" | "sequential" | "hybrid";

export interface HealthScoreConfig {
  initial: number;
  successReward: number;
  rateLimitPenalty: number;
  failurePenalty: number;
  recoveryRatePerHour: number;
  minUsable: number;
  maxScore: number;
}

export const DEFAULT_HEALTH_SCORE_CONFIG: HealthScoreConfig = {
  initial: 70,
  successReward: 1,
  rateLimitPenalty: -10,
  failurePenalty: -20,
  recoveryRatePerHour: 2,
  minUsable: 50,
  maxScore: 100,
};

export interface HealthScoreState {
  score: number;
  lastUpdated: number;
  lastSuccess: number;
  consecutiveFailures: number;
}

export class HealthScoreTracker {
  private readonly scores = new Map<number, HealthScoreState>();
  readonly config: HealthScoreConfig;

  constructor(config: Partial<HealthScoreConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_SCORE_CONFIG, ...config };
  }

  getScore(accountIndex: number): number {
    const state = this.scores.get(accountIndex);
    if (!state) {
      return this.config.initial;
    }

    const now = Date.now();
    const hoursSinceUpdate = (now - state.lastUpdated) / (1000 * 60 * 60);
    const recoveredPoints = Math.floor(
      hoursSinceUpdate * this.config.recoveryRatePerHour,
    );

    return Math.min(this.config.maxScore, state.score + recoveredPoints);
  }

  recordSuccess(accountIndex: number): void {
    const now = Date.now();
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.min(
        this.config.maxScore,
        current + this.config.successReward,
      ),
      lastUpdated: now,
      lastSuccess: now,
      consecutiveFailures: 0,
    });
  }

  recordRateLimit(accountIndex: number): void {
    const now = Date.now();
    const state = this.scores.get(accountIndex);
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.rateLimitPenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    });
  }

  recordFailure(accountIndex: number): void {
    const now = Date.now();
    const state = this.scores.get(accountIndex);
    const current = this.getScore(accountIndex);

    this.scores.set(accountIndex, {
      score: Math.max(0, current + this.config.failurePenalty),
      lastUpdated: now,
      lastSuccess: state?.lastSuccess ?? 0,
      consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
    });
  }

  isUsable(accountIndex: number): boolean {
    return this.getScore(accountIndex) >= this.config.minUsable;
  }

  getConsecutiveFailures(accountIndex: number): number {
    return this.scores.get(accountIndex)?.consecutiveFailures ?? 0;
  }

  reset(accountIndex: number): void {
    this.scores.delete(accountIndex);
  }

  toJSON(): Record<string, HealthScoreState> {
    const result: Record<string, HealthScoreState> = {};
    for (const [index, state] of this.scores) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  loadFromJSON(data: Record<string, HealthScoreState>): void {
    this.scores.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.scores.set(index, { ...state });
      }
    }
  }

  getSnapshot(): Map<number, { score: number; consecutiveFailures: number }> {
    const result = new Map<
      number,
      { score: number; consecutiveFailures: number }
    >();
    for (const [index] of this.scores) {
      result.set(index, {
        score: this.getScore(index),
        consecutiveFailures: this.getConsecutiveFailures(index),
      });
    }
    return result;
  }
}

export interface TokenBucketConfig {
  maxTokens: number;
  regenerationRatePerMinute: number;
  initialTokens: number;
}

export const DEFAULT_TOKEN_BUCKET_CONFIG: TokenBucketConfig = {
  maxTokens: 50,
  regenerationRatePerMinute: 6,
  initialTokens: 50,
};

export interface TokenBucketState {
  tokens: number;
  lastUpdated: number;
}

export class TokenBucketTracker {
  private readonly buckets = new Map<number, TokenBucketState>();
  private readonly config: TokenBucketConfig;

  constructor(config: Partial<TokenBucketConfig> = {}) {
    this.config = { ...DEFAULT_TOKEN_BUCKET_CONFIG, ...config };
  }

  getTokens(accountIndex: number): number {
    const state = this.buckets.get(accountIndex);
    if (!state) {
      return this.config.initialTokens;
    }

    const now = Date.now();
    const minutesSinceUpdate = (now - state.lastUpdated) / (1000 * 60);
    const recoveredTokens =
      minutesSinceUpdate * this.config.regenerationRatePerMinute;

    return Math.min(this.config.maxTokens, state.tokens + recoveredTokens);
  }

  hasTokens(accountIndex: number, cost = 1): boolean {
    return this.getTokens(accountIndex) >= cost;
  }

  consume(accountIndex: number, cost = 1): boolean {
    const current = this.getTokens(accountIndex);
    if (current < cost) {
      return false;
    }

    this.buckets.set(accountIndex, {
      tokens: current - cost,
      lastUpdated: Date.now(),
    });
    return true;
  }

  refund(accountIndex: number, amount = 1): void {
    const current = this.getTokens(accountIndex);
    this.buckets.set(accountIndex, {
      tokens: Math.min(this.config.maxTokens, current + amount),
      lastUpdated: Date.now(),
    });
  }

  getMaxTokens(): number {
    return this.config.maxTokens;
  }

  toJSON(): Record<string, TokenBucketState> {
    const result: Record<string, TokenBucketState> = {};
    for (const [index, state] of this.buckets) {
      result[String(index)] = { ...state };
    }
    return result;
  }

  loadFromJSON(data: Record<string, TokenBucketState>): void {
    this.buckets.clear();
    for (const [key, state] of Object.entries(data)) {
      const index = Number.parseInt(key, 10);
      if (!Number.isNaN(index) && state) {
        this.buckets.set(index, { ...state });
      }
    }
  }
}

export interface AccountWithMetrics {
  index: number;
  lastUsed: number;
  healthScore: number;
  tokens: number;
  isRateLimited: boolean;
}

export interface ScoreBreakdown {
  health: number;
  tokens: number;
  freshness: number;
}

export interface HybridSelectionResult {
  index: number;
  score: number;
  breakdown: ScoreBreakdown;
}

export function calculateHybridScore(
  account: AccountWithMetrics,
  maxTokens: number,
): { score: number; breakdown: ScoreBreakdown } {
  const healthComponent = account.healthScore * 2;
  const tokenComponent = (account.tokens / maxTokens) * 100 * 5;
  const secondsSinceUsed = Math.max(0, (Date.now() - account.lastUsed) / 1000);
  const freshnessComponent = Math.min(secondsSinceUsed, 3600) * 0.1;

  const score = Math.max(
    0,
    healthComponent + tokenComponent + freshnessComponent,
  );

  return {
    score,
    breakdown: {
      health: healthComponent,
      tokens: tokenComponent,
      freshness: freshnessComponent,
    },
  };
}

export function selectHybridAccount(
  accounts: AccountWithMetrics[],
  minHealthScore = 50,
  maxTokens = 50,
): HybridSelectionResult | null {
  const nonRateLimited = accounts.filter((acc) => !acc.isRateLimited);
  if (nonRateLimited.length === 0) {
    return null;
  }

  const idealCandidates = nonRateLimited.filter(
    (acc) => acc.healthScore >= minHealthScore && acc.tokens >= 1,
  );

  const candidatesToScore =
    idealCandidates.length > 0 ? idealCandidates : nonRateLimited;

  const scored = candidatesToScore
    .map((acc) => {
      const { score, breakdown } = calculateHybridScore(acc, maxTokens);
      return {
        index: acc.index,
        score,
        breakdown,
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0] ?? null;
}

let globalHealthTracker: HealthScoreTracker | null = null;
let globalTokenTracker: TokenBucketTracker | null = null;

export function getHealthTracker(): HealthScoreTracker {
  if (!globalHealthTracker) {
    globalHealthTracker = new HealthScoreTracker();
  }
  return globalHealthTracker;
}

export function initHealthTracker(
  config?: Partial<HealthScoreConfig>,
): HealthScoreTracker {
  globalHealthTracker = new HealthScoreTracker(config);
  return globalHealthTracker;
}

export function getTokenTracker(): TokenBucketTracker {
  if (!globalTokenTracker) {
    globalTokenTracker = new TokenBucketTracker();
  }
  return globalTokenTracker;
}

export function initTokenTracker(
  config?: Partial<TokenBucketConfig>,
): TokenBucketTracker {
  globalTokenTracker = new TokenBucketTracker(config);
  return globalTokenTracker;
}

export function resetTrackers(): void {
  globalHealthTracker = null;
  globalTokenTracker = null;
}
