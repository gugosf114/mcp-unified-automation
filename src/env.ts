import { z } from 'zod';
import { homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// Stable repo root derived from module location, not cwd.
// dist/env.js -> one level up -> repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

/** Writable data directory — override via env var or defaults to {repo}/data */
export const DATA_ROOT =
  process.env.UNIFIED_AUTOMATION_DATA_DIR ??
  join(REPO_ROOT, 'data');

/**
 * Centralized environment validation via Zod.
 *
 * All env vars are strings at the process.env boundary.
 * This module coerces them to proper types with sensible defaults.
 * Import `env` anywhere instead of reading process.env directly.
 *
 * Node 22 loads .env via --env-file=.env (no dotenv needed).
 */

// Helpers for env coercion — process.env values are always strings
const boolStr = (fallback: boolean) =>
  z.string()
    .transform(v => v.toLowerCase() === 'true')
    .optional()
    .default(fallback ? 'true' : 'false');

const numStr = (fallback: number) =>
  z.string()
    .transform(v => {
      const n = Number(v);
      if (isNaN(n)) throw new Error(`Expected number, got "${v}"`);
      return n;
    })
    .optional()
    .default(String(fallback));

const envSchema = z.object({
  // ── Browser ──────────────────────────────────────────────────────
  BROWSER_HEADED: boolStr(true),
  HEADLESS: z.string().optional(),              // legacy override (inverted logic)
  BROWSER_BLOCK_MEDIA: boolStr(false),
  HUMAN_DELAY_MIN: numStr(0),
  HUMAN_DELAY_MAX: numStr(0),
  CHROME_USER_DATA_DIR: z.string().min(1).default(
    join(homedir(), 'AppData', 'Local', 'mcp-unified-automation', 'chrome-profile')
  ),
  CHROME_CHANNEL: z.string().optional(),

  // ── Performance ─────────────────────────────────────────────────
  FAST_MODE: boolStr(false),

  // ── Evidence recording ────────────────────────────────────────
  // full: every step (default), selective: errors/approvals/first/last only, none: skip all
  EVIDENCE_MODE: z.enum(['full', 'selective', 'none']).default('full'),

  // ── SSE transport ────────────────────────────────────────────────
  MCP_USE_SSE: boolStr(true),
  MCP_SSE_PORT: numStr(3456),
  MCP_SSE_HOST: z.string().default('127.0.0.1'),
  MCP_SSE_BEARER_TOKEN: z.string().optional(),
  MCP_PUBLIC_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment. Throws ZodError with details if invalid.
 * Called once at startup — the result is the single source of truth.
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${issues}`);
  }
  const parsed = result.data;

  // Resolve HEADLESS vs BROWSER_HEADED (HEADLESS takes priority)
  if (parsed.HEADLESS !== undefined) {
    parsed.BROWSER_HEADED = parsed.HEADLESS.toLowerCase() === 'false'; // HEADLESS=false → headed=true
  }

  return parsed;
}

/** Validated environment — import this instead of reading process.env */
export const env = parseEnv();
