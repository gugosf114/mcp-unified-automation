# CDP Helpers

Chrome DevTools Protocol automation — one helper module, works on any Windows machine.

## Files

- **`cdp.js`** — Helper module with 17 commands. Usable as both a Node module and a CLI.
- **`cdp-bootstrap.ps1`** — One-shot setup script for new machines.
- **`package.json`** — Declares playwright-core dependency.
- **`node_modules/playwright-core/`** — Installed dependency.

## Quick install on a new Windows machine

```powershell
# From PowerShell:
cd $env:USERPROFILE\.cdp
.\cdp-bootstrap.ps1
```

This will:
1. Verify Node.js is installed
2. Install playwright-core locally
3. Auto-detect Chrome (or Edge)
4. Kill existing Chrome
5. Launch Chrome with `--remote-debugging-port=9222`
6. Verify CDP is up
7. Take a test screenshot

## Usage as CLI

```bash
# Check CDP is responding
node %USERPROFILE%\.cdp\cdp.js ping

# Screenshot
node %USERPROFILE%\.cdp\cdp.js screenshot https://example.com out.png

# Full-page screenshot (stitched)
node %USERPROFILE%\.cdp\cdp.js fullpage https://example.com fullpage.png

# Screenshot N URLs in parallel (write urls to file first, one per line)
node %USERPROFILE%\.cdp\cdp.js parallel urls.txt ./screenshots/

# Extract text from a selector
node %USERPROFILE%\.cdp\cdp.js extract https://example.com h1

# Extract all matching elements
node %USERPROFILE%\.cdp\cdp.js extractall https://example.com "a[href]"

# Dump accessibility tree (cleaner than DOM for LLM reasoning)
node %USERPROFILE%\.cdp\cdp.js a11y https://example.com

# Save as PDF
node %USERPROFILE%\.cdp\cdp.js pdf https://example.com out.pdf

# Run arbitrary JS in page context
node %USERPROFILE%\.cdp\cdp.js evaluate https://example.com "document.title"

# Get cookies for a URL
node %USERPROFILE%\.cdp\cdp.js cookies https://example.com

# Click a selector
node %USERPROFILE%\.cdp\cdp.js click https://example.com "a"

# Check if element exists
node %USERPROFILE%\.cdp\cdp.js exists https://example.com "h1"

# Get full page text / HTML / title
node %USERPROFILE%\.cdp\cdp.js text https://example.com
node %USERPROFILE%\.cdp\cdp.js html https://example.com
node %USERPROFILE%\.cdp\cdp.js title https://example.com

# Just open a URL (leaves tab open)
node %USERPROFILE%\.cdp\cdp.js open https://example.com
```

## Usage as Node module

```js
const cdp = require('C:/Users/georg/.cdp/cdp.js');

// Screenshot
await cdp.screenshot('https://example.com', 'out.png');

// Parallel screenshots
await cdp.parallel([
  'https://mybakingcreations.com',
  'https://baycomply.com',
  'https://github.com/gugosf114'
], './screenshots/');

// Extract structured data
const headings = await cdp.extractAll('https://news.ycombinator.com', '.storylink');
console.log(headings);

// Run custom JS
const data = await cdp.evaluate('https://example.com',
  '() => Array.from(document.querySelectorAll("a")).map(a => a.href)'
);
```

## Why 127.0.0.1 and not localhost?

Windows has an IPv6 resolution bug: `localhost` can resolve to `::1` instead of `127.0.0.1`,
and Chrome's CDP server only listens on IPv4. **Always use `127.0.0.1`**.

## Customizing

- **Port**: set `CDP_PORT=9223` env var before running cdp.js (default 9222)
- **playwright-core location**: set `PWCORE_PATH` env var to override auto-detection

## Troubleshooting

- **"No browser contexts found"** → Chrome is running but WITHOUT the CDP flag.
  Kill Chrome, run `launch-chrome-cdp.ps1` from Desktop, try again.
- **"ECONNREFUSED 127.0.0.1:9222"** → Chrome isn't running with CDP enabled.
  Same fix: run the Desktop launcher.
- **playwright-core not found** → Set `PWCORE_PATH` env var, or run `cdp-bootstrap.ps1`.
- **Timeout on navigation** → The target site might be slow or blocking automation.
  Try `{ timeout: 60000 }` or use stealth plugins.
