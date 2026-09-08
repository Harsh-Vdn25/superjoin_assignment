// Thrown (not returned) so pRetry's bail mechanism can stop immediately —
// retrying a daily-quota 429 just burns more of an already-exhausted quota
// and produces misleading log noise.
export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

/**
 * Distinguishes a daily-quota 429 (retrying is pointless until tomorrow)
 * from a per-minute rate limit or generic 429 (worth retrying with backoff).
 * Gemini's quota-exceeded message mentions "quota" alongside a per-day limit.
 */
export function isDailyQuotaError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err);
  return /429/.test(message) && /quota/i.test(message) && /per\s*day|daily|PerDay/i.test(message);
}

/**
 * A 503 "high demand" error is Google's shared capacity being overloaded —
 * distinct from a 429 (which is *your* quota/rate limit). Retrying the same
 * model harder doesn't help much here; switching to a different model
 * (a separate capacity pool) is usually more effective.
 */
export function isOverloadedError(err: unknown): boolean {
  const message = String((err as any)?.message ?? err);
  return /503/.test(message) && /high demand|overloaded|unavailable/i.test(message);
}