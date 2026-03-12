/**
 * orchestrator-cli.ts — CLI entry point for API mode.
 *
 * Usage:
 *   npm run api -- "Navigate to LinkedIn and scrape 5 profiles"
 *   npm run api -- --file task-prompt.txt
 *   npm run api                          (interactive single-prompt mode)
 *
 * Environment:
 *   ANTHROPIC_API_KEY=sk-...            (required)
 *   ANTHROPIC_MODEL=claude-sonnet-4-6   (optional, default: claude-sonnet-4-6)
 *   ORCHESTRATOR_MAX_TURNS=50           (optional)
 */

import { Orchestrator } from './orchestrator.js';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';

async function main() {
  const args = process.argv.slice(2);

  let prompt: string | undefined;

  // Parse arguments
  if (args.includes('--file')) {
    const fileIdx = args.indexOf('--file');
    const filePath = args[fileIdx + 1];
    if (!filePath) {
      console.error('Error: --file requires a path argument');
      process.exit(1);
    }
    prompt = readFileSync(filePath, 'utf-8').trim();
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    // Join all non-flag args as the prompt
    prompt = args.join(' ');
  }

  // If no prompt provided, read from stdin
  if (!prompt) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    prompt = await new Promise<string>((resolve) => {
      process.stderr.write('Enter task prompt: ');
      rl.once('line', (line) => {
        rl.close();
        resolve(line.trim());
      });
    });
  }

  if (!prompt) {
    console.error('Error: No prompt provided');
    process.exit(1);
  }

  console.error('╔══════════════════════════════════════════════════╗');
  console.error('║  Unified Automation — API Orchestrator          ║');
  console.error('╚══════════════════════════════════════════════════╝');
  console.error(`  Model:     ${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'}`);
  console.error(`  Max turns: ${process.env.ORCHESTRATOR_MAX_TURNS || '50'}`);
  console.error(`  Prompt:    ${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}`);
  console.error('');

  const orchestrator = new Orchestrator({
    onToolCall: (name, input, result) => {
      const status = (result as any)?.status ?? 'ok';
      console.error(`  ✓ ${name} → ${status}`);
    },
  });

  try {
    const result = await orchestrator.run(prompt);

    // Output the final response to stdout (pipeable)
    console.log(result.response);

    // Stats to stderr
    console.error('');
    console.error('── Run complete ──────────────────────────────────');
    console.error(`  Turns:       ${result.turns}`);
    console.error(`  Tool calls:  ${result.toolCalls.length}`);
    console.error(`  Tokens in:   ${result.inputTokens.toLocaleString()}`);
    console.error(`  Tokens out:  ${result.outputTokens.toLocaleString()}`);
    console.error(`  Duration:    ${(result.durationMs / 1000).toFixed(1)}s`);
    console.error(`  Est. cost:   $${((result.inputTokens * 3 + result.outputTokens * 15) / 1_000_000).toFixed(4)}`);

  } catch (err: any) {
    console.error(`\nFatal error: ${err.message}`);
    if (err.status === 401) {
      console.error('Check your ANTHROPIC_API_KEY — it may be invalid or expired.');
    }
    process.exit(1);
  } finally {
    await orchestrator.shutdown();
  }
}

main().catch((err) => {
  console.error(`Unhandled error: ${err.message}`);
  process.exit(1);
});
