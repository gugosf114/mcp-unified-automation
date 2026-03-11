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
FAST_MODE=true                 # Skip networkidle waits + nav waits on click (10x faster)
CHROME_USER_DATA_DIR=C:\Users\georg\AppData\Local\mcp-unified-automation\chrome-profile
```

`CHROME_USER_DATA_DIR` points to a dedicated Chrome profile so sessions, cookies, and logins carry over. Must NOT be Chrome's default user-data-dir (Chrome blocks DevTools on it).

`FAST_MODE` skips Playwright's `networkidle` wait after every navigation and click. Modern sites (GA4, Gmail, etc.) never truly go network-idle due to analytics pings and websockets, so the default behavior just burns 10-30 seconds hitting the timeout. With FAST_MODE, pages are interactable as soon as the DOM loads.

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

## What's New (March 2026)

### Features you can use

- **Domain readiness profiles** (`src/readiness.ts`) — The server now knows how to wait for LinkedIn, Gmail, Google Search, GitHub, Yelp, Facebook, and Instagram. Instead of waiting for `networkidle` (which times out on every modern site), it waits for the actual content selector that proves the page loaded. You don't call this directly — it fires automatically on every `navigate`, `goto`, and `warm` call. If you add a new site you automate frequently, add its selector to `readiness.ts`.

- **Selective evidence mode** — New `.env` setting `EVIDENCE_MODE=selective` records screenshots/DOM snapshots only on errors, approval gates, and the first/last step of a task. Set to `full` for audit trails, `none` to skip entirely. Controlled in `.env`, no code changes needed.

- **Semantic tool returns** — `browser_navigate`, `browser_click`, and `session_open` now return richer data: `readyState`, whether navigation occurred, whether the readiness selector matched, the domain profile used. This means Claude doesn't need a follow-up `getPageInfo` call after every action — the info comes back in the tool response. Fewer round trips = faster task execution.

- **Task management tools renamed** — `task.list` → `task_list`, `task.status` → `task_status`, `task.cancel` → `task_cancel`. Claude Desktop rejects dots in tool names. If you had prompts referencing the old names, update them.

### Performance & safety (automatic, no action needed)

- **FAST_MODE** — When `FAST_MODE=true` in `.env`: zero human delays, skip `networkidle` waits, sparse checkpoint writes (every 3rd step instead of every step), evidence recording follows `EVIDENCE_MODE` setting. Already enabled in your `.env`.

- **Stable path resolution** — Data directories (`data/checkpoints/`, `data/evidence/`) now resolve from the module's own location (`import.meta.url`), not `process.cwd()`. This fixed the crash when Claude Desktop spawned the server from `C:\WINDOWS\system32`. Centralized in `src/env.ts` as `DATA_ROOT`.

- **Retry with exponential backoff** (`src/action/retry.ts`) — Network-sensitive actions auto-retry on transient failures.

- **Conditional steps & parallel runner** — Task DSL now supports `condition` fields on steps and a parallel step executor for independent actions.

---

## Notes

- `browser_*` tools use a `”default”` page slot for backward compatibility — existing Claude prompts that call `browser_navigate` etc. still work unchanged.
- The task engine supports mid-run pause/resume — useful for long multi-step jobs that might hit context limits.
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

