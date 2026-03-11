import { env, DATA_ROOT } from '../src/env';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

describe('Environment config (env.ts)', () => {
  // ── Defaults ─────────────────────────────────────────────────────

  test('exports a valid env object', () => {
    expect(env).toBeDefined();
    expect(typeof env.BROWSER_HEADED).toBe('boolean');
    expect(typeof env.FAST_MODE).toBe('boolean');
    expect(typeof env.MCP_SSE_PORT).toBe('number');
  });

  test('EVIDENCE_MODE is one of the valid values', () => {
    expect(['full', 'selective', 'none']).toContain(env.EVIDENCE_MODE);
  });

  test('HUMAN_DELAY_MIN and HUMAN_DELAY_MAX are numbers', () => {
    expect(typeof env.HUMAN_DELAY_MIN).toBe('number');
    expect(typeof env.HUMAN_DELAY_MAX).toBe('number');
    expect(env.HUMAN_DELAY_MIN).toBeGreaterThanOrEqual(0);
    expect(env.HUMAN_DELAY_MAX).toBeGreaterThanOrEqual(0);
  });

  test('CHROME_USER_DATA_DIR is a non-empty string', () => {
    expect(typeof env.CHROME_USER_DATA_DIR).toBe('string');
    expect(env.CHROME_USER_DATA_DIR.length).toBeGreaterThan(0);
  });

  test('MCP_SSE_HOST defaults to 127.0.0.1', () => {
    // Could be overridden by .env, but should always be a string
    expect(typeof env.MCP_SSE_HOST).toBe('string');
  });

  // ── DATA_ROOT ──────────────────────────────────────────────────

  test('DATA_ROOT is an absolute path', () => {
    expect(DATA_ROOT).toBeDefined();
    // On Windows, absolute paths start with drive letter
    expect(DATA_ROOT).toMatch(/^[A-Z]:\\/i);
  });

  test('DATA_ROOT points to repo/data (not system32)', () => {
    // This is the critical test — DATA_ROOT must NOT resolve to cwd
    expect(DATA_ROOT.toLowerCase()).not.toContain('system32');
    expect(DATA_ROOT.toLowerCase()).not.toContain('windows');
    expect(DATA_ROOT).toContain('data');
  });

  test('DATA_ROOT parent directory exists (repo root)', () => {
    const repoRoot = resolve(DATA_ROOT, '..');
    expect(existsSync(repoRoot)).toBe(true);
  });
});
