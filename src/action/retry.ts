import type { ToolResult } from '../types/common.js';

export interface RetryOptions {
  maxAttempts: number;
  backoffMs: number;       // initial backoff
  backoffMultiplier: number;
  maxBackoffMs: number;
  retryOn?: (result: ToolResult) => boolean;
}

const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  backoffMs: 500,
  backoffMultiplier: 2,
  maxBackoffMs: 5000,
  retryOn: (result) => result.status === 'error',
};

/**
 * withRetry — wraps an async action with exponential backoff.
 *
 * Returns the first successful result, or the last failed result
 * after all attempts are exhausted. Tracks attempt count in the result.
 */
export async function withRetry(
  fn: () => Promise<ToolResult>,
  opts?: Partial<RetryOptions>,
): Promise<ToolResult & { attempts: number }> {
  const config = { ...DEFAULT_RETRY, ...opts };
  let lastResult: ToolResult | null = null;
  let backoff = config.backoffMs;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    lastResult = await fn();

    if (!config.retryOn!(lastResult)) {
      return { ...lastResult, attempts: attempt };
    }

    if (attempt < config.maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * config.backoffMultiplier, config.maxBackoffMs);
    }
  }

  return { ...lastResult!, attempts: config.maxAttempts };
}
