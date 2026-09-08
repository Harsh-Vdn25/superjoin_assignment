/**
 * p-limit only caps how many calls run at once — it does NOT space out when
 * each one starts. Two calls can still fire back-to-back the instant a slot
 * frees up, which is exactly what trips "high demand" 503s on the free tier.
 * This throttle enforces a minimum gap between call starts, independent of
 * concurrency, so we stay under Gemini's ~10-15 RPM free-tier ceiling.
 */
export function createThrottle(minIntervalMs: number) {
  let nextAvailable = Date.now();
  return async function throttle(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, nextAvailable - now);
    nextAvailable = Math.max(now, nextAvailable) + minIntervalMs;
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  };
}
