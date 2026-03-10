import { withRetry } from '../src/action/retry';
import type { ToolResult } from '../src/types/common';

describe('withRetry', () => {
  test('returns immediately on success', async () => {
    let callCount = 0;
    const fn = async (): Promise<ToolResult> => {
      callCount++;
      return { status: 'success', data: 'ok' };
    };

    const result = await withRetry(fn);
    expect(result.status).toBe('success');
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  test('retries on error and succeeds on 2nd attempt', async () => {
    let callCount = 0;
    const fn = async (): Promise<ToolResult> => {
      callCount++;
      if (callCount < 2) return { status: 'error', error: 'transient' };
      return { status: 'success', data: 'recovered' };
    };

    const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1, maxBackoffMs: 10 });
    expect(result.status).toBe('success');
    expect(result.attempts).toBe(2);
    expect(callCount).toBe(2);
  });

  test('exhausts all attempts and returns last error', async () => {
    let callCount = 0;
    const fn = async (): Promise<ToolResult> => {
      callCount++;
      return { status: 'error', error: `fail-${callCount}` };
    };

    const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10, backoffMultiplier: 1, maxBackoffMs: 10 });
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(3);
    expect(callCount).toBe(3);
    expect(result.error).toBe('fail-3');
  });

  test('respects custom retryOn predicate', async () => {
    let callCount = 0;
    const fn = async (): Promise<ToolResult> => {
      callCount++;
      // Returns "success" status but with a special data flag
      return { status: 'success', data: { needsRetry: callCount < 3 } };
    };

    const result = await withRetry(fn, {
      maxAttempts: 5,
      backoffMs: 10,
      backoffMultiplier: 1,
      maxBackoffMs: 10,
      retryOn: (r) => r.data?.needsRetry === true,
    });

    expect(result.status).toBe('success');
    expect(result.attempts).toBe(3);
    expect(result.data.needsRetry).toBe(false);
  });

  test('maxAttempts = 1 means no retry', async () => {
    let callCount = 0;
    const fn = async (): Promise<ToolResult> => {
      callCount++;
      return { status: 'error', error: 'always fails' };
    };

    const result = await withRetry(fn, { maxAttempts: 1, backoffMs: 10, backoffMultiplier: 1, maxBackoffMs: 10 });
    expect(result.status).toBe('error');
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });

  test('backoff increases exponentially', async () => {
    const timestamps: number[] = [];
    let callCount = 0;

    const fn = async (): Promise<ToolResult> => {
      callCount++;
      timestamps.push(Date.now());
      if (callCount < 3) return { status: 'error', error: 'fail' };
      return { status: 'success' };
    };

    await withRetry(fn, { maxAttempts: 3, backoffMs: 50, backoffMultiplier: 2, maxBackoffMs: 500 });

    // Second call should be ~50ms after first, third ~100ms after second
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap1).toBeGreaterThanOrEqual(40);  // ~50ms with tolerance
    expect(gap2).toBeGreaterThanOrEqual(80);  // ~100ms with tolerance
  });
});
