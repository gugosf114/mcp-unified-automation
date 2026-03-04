# mcp-unified-automation

Custom MCP server — Playwright browser automation + system control, 25 tools, stdio transport.

Launched via `RUN_MCP_FAST.bat` on George's Desktop. Connects to Claude Code as a local MCP server.

---

## What it does

Runs a headed Chrome instance using George's actual Chrome profile (`User Data` dir), so the browser has real auth cookies — logged into Google, Search Console, Gmail, everything. Claude operates it through 25 registered MCP tools.

**Tool groups:**

| Group | Count | What it covers |
|---|---|---|
| `browser_*` | 7 | Backward-compatible Playwright tools (navigate, click, type, screenshot, etc.) |
| `system_*` | 6 | Shell commands, file read/write, process control |
| `session_*` | 2 | Named browser session management (multiple tabs/contexts) |
| `task_*` | 5 | Task DSL engine — plan, run, resume, pause, commit |
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

Then double-click `RUN_MCP_FAST.bat` (or right-click → Run as administrator if system tools need elevation).

---

## .env config

```
BROWSER_HEADED=true            # Show the browser window
BROWSER_BLOCK_MEDIA=false      # Block images/video to speed up crawls
HUMAN_DELAY_MIN=50             # ms — min delay between actions
HUMAN_DELAY_MAX=200            # ms — max delay (human-like pacing)
CHROME_USER_DATA_DIR=C:\Users\georg\AppData\Local\Google\Chrome\User Data
```

`CHROME_USER_DATA_DIR` is the key one — points to the real Chrome profile so sessions, cookies, and logins carry over.

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

Or just run the BAT — it handles the node invocation.

---

## Architecture

```
src/
  index.ts        — server entry, registers all tool groups
  kernel.ts       — wires up shared managers (session, task, observer, network, evidence, metrics)
  tools/          — one file per tool group
  cdp/            — Chrome DevTools Protocol bridge
  session/        — named session + page slot management
  task/           — task DSL (plan/run/resume/pause/commit)
  observer/       — DOM mutation bus
  network/        — request interceptor + API discovery
  evidence/       — action ledger + hash chain
  metrics/        — step timing engine
  checkpoint/     — mid-task state snapshots
  recovery/       — resume after crash/disconnect
  policy/         — action policy enforcement
  types/          — shared TypeScript types
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

- `browser_*` tools use a `"default"` page slot for backward compatibility — existing Claude prompts that call `browser_navigate` etc. still work unchanged.
- The task engine supports mid-run pause/resume — useful for long multi-step jobs that might hit context limits.
- Evidence ledger produces a hash-chained audit trail of every browser action. Useful for compliance work.
- Recovery module handles reconnect after Claude Code crashes or context resets.
