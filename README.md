# mcp-unified-automation

Custom MCP server â€” Playwright browser automation + system control, 25 tools, stdio transport.

Launched via `RUN_MCP_FAST.bat` on George's Desktop. Connects to Claude Code as a local MCP server.

---

## What it does

Runs a headed Chrome instance using George's actual Chrome profile (`User Data` dir), so the browser has real auth cookies â€” logged into Google, Search Console, Gmail, everything. Claude operates it through 25 registered MCP tools.

**Tool groups:**

| Group | Count | What it covers |
|---|---|---|
| `browser_*` | 7 | Backward-compatible Playwright tools (navigate, click, type, screenshot, etc.) |
| `system_*` | 6 | Shell commands, file read/write, process control |
| `session_*` | 2 | Named browser session management (multiple tabs/contexts) |
| `task_*` | 5 | Task DSL engine â€” plan, run, resume, pause, commit |
| `observe_*` | 1 | DOM observation / mutation watching |
| `network_*` | 2 | Request blocking + API endpoint discovery |
| `evidence_*` | 1 | Export + hash-chain verification of browser actions |
| `metrics_*` | 1 | Step-level timing and performance reporting |

---

## Setup

```bash
git clone https://github.com/gugosf114/mcp-unified-automation
cd mcp-unified-automation
npm install
cp .env.example .env
# Edit .env if your Chrome User Data path differs
npm run build
```

Then double-click `RUN_MCP_FAST.bat` (or right-click â†’ Run as administrator if system tools need elevation).

---

## .env config

```
BROWSER_HEADED=true            # Show the browser window
BROWSER_BLOCK_MEDIA=false      # Block images/video to speed up crawls
HUMAN_DELAY_MIN=50             # ms â€” min delay between actions
HUMAN_DELAY_MAX=200            # ms â€” max delay (human-like pacing)
CHROME_USER_DATA_DIR=C:\Users\georg\AppData\Local\Google\Chrome\User Data
```

`CHROME_USER_DATA_DIR` is the key one â€” points to the real Chrome profile so sessions, cookies, and logins carry over.

---

## Claude Code config

Add to your Claude Code MCP config (`claude_desktop_config.json` or equivalent):

```json
{
  "mcpServers": {
    "unified-automation": {
      "command": "node",
      "args": ["C:\\path\\to\\mcp-unified-automation\\dist\\index.js"]
    }
  }
}
```

Or just run the BAT â€” it handles the node invocation.

---

## Architecture

```
src/
  index.ts        â€” server entry, registers all tool groups
  kernel.ts       â€” wires up shared managers (session, task, observer, network, evidence, metrics)
  tools/          â€” one file per tool group
  cdp/            â€” Chrome DevTools Protocol bridge
  session/        â€” named session + page slot management
  task/           â€” task DSL (plan/run/resume/pause/commit)
  observer/       â€” DOM mutation bus
  network/        â€” request interceptor + API discovery
  evidence/       â€” action ledger + hash chain
  metrics/        â€” step timing engine
  checkpoint/     â€” mid-task state snapshots
  recovery/       â€” resume after crash/disconnect
  policy/         â€” action policy enforcement
  types/          â€” shared TypeScript types
```

---

## Stack

- Node.js (ESM)
- TypeScript 5.7
- Playwright 1.52
- `@modelcontextprotocol/sdk` 1.12
- Zod (schema validation)

---

## Notes

- `browser_*` tools use a `"default"` page slot for backward compatibility â€” existing Claude prompts that call `browser_navigate` etc. still work unchanged.
- The task engine supports mid-run pause/resume â€” useful for long multi-step jobs that might hit context limits.
- Evidence ledger produces a hash-chained audit trail of every browser action. Useful for compliance work.
- Recovery module handles reconnect after Claude Code crashes or context resets.

---

## Execution Policy

This server runs in **operator-first mode**.

Reversible automation and read/write navigation steps are allowed by default — no approval gate required. Human approval is required only for:

- **Financial actions** (payments, subscriptions, transactions)
- **Destructive actions** (deletes, overwrites, sends that cannot be undone)
- **Explicit pproval_gate checkpoints** defined in the task DSL

The operator, not the client UI, is the final authority over execution policy. Approval prompts are task-level constructs, not UI-level guardrails.

