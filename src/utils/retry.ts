/**
 * Retry utility for Gemini API calls.
 *
 * Automatically retries on quota/capacity errors by parsing the wait time
 * from the error message (e.g. "Your quota will reset after 1s").
 *
 * Only retries on transient errors (429, 503, quota exhaustion).
 * Permanent errors (400, 401, 404) are thrown immediately.
 */

const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 30000;

/**
 * Check if an error is retryable (quota, rate limit, service unavailable).
 */
function isRetryable(error: Error): boolean {
  const msg = error.message.toLowerCase();
  const responseStatus = (error as any).response?.status;

  // Quota exhaustion (the exact error you see)
  if (msg.includes('exhausted your capacity')) return true;
  if (msg.includes('quota')) return true;
  if (msg.includes('rate limit')) return true;
  if (msg.includes('resource_exhausted')) return true;

  // Service temporarily unavailable
  if (msg.includes('unavailable')) return true;
  if (msg.includes('overloaded')) return true;

  // HTTP status codes
  if (responseStatus === 429 || responseStatus === 503) return true;
  if (msg.includes('429') || msg.includes('503')) return true;

  return false;
}

/**
 * Extract the retry delay from an error message.
 * Looks for patterns like "reset after 1s", "retry after 30s", etc.
 */
function extractRetryDelay(error: Error): number {
  const msg = error.message;

  // "Your quota will reset after 1s"
  const resetMatch = msg.match(/reset after (\d+)s/i);
  if (resetMatch) {
    return Math.min(parseInt(resetMatch[1], 10) * 1000 + 500, MAX_RETRY_DELAY_MS);
  }

  // "Retry after X seconds"
  const retryMatch = msg.match(/retry after (\d+)/i);
  if (retryMatch) {
    return Math.min(parseInt(retryMatch[1], 10) * 1000 + 500, MAX_RETRY_DELAY_MS);
  }

  // Check Retry-After header in GaxiosError response
  const retryAfter = (error as any).response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      return Math.min(seconds * 1000 + 500, MAX_RETRY_DELAY_MS);
    }
  }

  return DEFAULT_RETRY_DELAY_MS;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper for async functions that may fail with quota errors.
 *
 * Usage:
 *   const result = await withRetry(() => someApiCall());
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string = 'API call',
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(lastError) || attempt === MAX_RETRIES) {
        throw lastError;
      }

      const delay = extractRetryDelay(lastError);
      console.warn(
        `⚠ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message.slice(0, 100)}`,
      );
      console.warn(`  Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError!;
}

/**
 * Retry wrapper for async generators (streaming).
 *
 * On quota errors, waits and retries the entire stream from scratch.
 * The caller must be prepared to receive a fresh stream on retry.
 */
export async function* withRetryStream<T>(
  fn: () => AsyncGenerator<T>,
  label: string = 'stream',
): AsyncGenerator<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      yield* fn();
      return; // Successfully completed
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isRetryable(lastError) || attempt === MAX_RETRIES) {
        throw lastError;
      }

      const delay = extractRetryDelay(lastError);
      console.warn(
        `⚠ ${label} failed (attempt ${attempt}/${MAX_RETRIES}): ${lastError.message.slice(0, 100)}`,
      );
      console.warn(`  Retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError!;
}
