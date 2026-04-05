/**
 * cdp.js — Playwright CDP helper module
 *
 * Usage as module:
 *   const cdp = require('C:/Users/georg/.cdp/cdp.js');
 *   await cdp.screenshot('https://example.com', 'out.png');
 *
 * Usage as CLI:
 *   node cdp.js screenshot <url> [outPath]
 *   node cdp.js fullpage <url> <outPath>
 *   node cdp.js parallel <urls.txt> <outDir>
 *   node cdp.js extract <url> <selector>
 *   node cdp.js extractAll <url> <selector>
 *   node cdp.js a11y <url>
 *   node cdp.js pdf <url> <outPath>
 *   node cdp.js evaluate <url> <jsCode>
 *   node cdp.js cookies <url>
 *   node cdp.js click <url> <selector>
 *   node cdp.js fill <url> <selector> <text>
 *   node cdp.js exists <url> <selector>
 *   node cdp.js text <url>                    # innerText of whole page
 *   node cdp.js html <url>                    # full HTML
 *   node cdp.js title <url>                   # page title
 *   node cdp.js open <url>                    # just navigate, leave open
 *   node cdp.js ping                          # check CDP is up
 */

const fs = require('fs');
const path = require('path');

// --- Config ---
// playwright-core path: uses env var if set, otherwise falls back to the
// mcp-unified-automation location. On new machines, cdp-bootstrap.ps1 can
// install playwright-core to %USERPROFILE%/.cdp/node_modules/playwright-core
// and set PWCORE_PATH accordingly.
const PWCORE_PATH = process.env.PWCORE_PATH || (() => {
  const candidates = [
    path.join(process.env.USERPROFILE || '', '.cdp', 'node_modules', 'playwright-core'),
    'C:/Users/georg/Documents/GitHub/mcp-unified-automation/node_modules/playwright-core',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'package.json'))) return c;
  }
  throw new Error(
    'playwright-core not found. Set PWCORE_PATH env var or run cdp-bootstrap.ps1.'
  );
})();

const CDP_PORT = process.env.CDP_PORT || '9222';
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;  // ALWAYS 127.0.0.1, NEVER localhost (Windows IPv6 bug)

const pw = require(PWCORE_PATH);

// --- Core connect/disconnect ---

/**
 * Connect to the running Chrome/Edge instance via CDP.
 * Returns { browser, context, page } where page is the first existing tab.
 */
async function connect() {
  const browser = await pw.chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser contexts found — is Chrome running with --remote-debugging-port=' + CDP_PORT + '?');
  }
  const context = contexts[0];
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  return { browser, context, page };
}

/**
 * Disconnect — closes the Playwright connection but does NOT close Chrome.
 */
async function disconnect(browser) {
  try { await browser.close(); } catch (_) {}
}

// --- Helpers ---

/** Check if CDP is responsive. */
async function ping() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, browser: data.Browser, port: CDP_PORT };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Screenshot a URL (viewport). */
async function screenshot(url, outPath = 'screenshot.png', options = {}) {
  const { browser, context, page } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await p.screenshot({ path: outPath, ...options });
    await p.close();
    return outPath;
  } finally {
    await disconnect(browser);
  }
}

/** Full-page stitched screenshot. */
async function fullPageScreenshot(url, outPath) {
  return screenshot(url, outPath, { fullPage: true });
}

/** Screenshot multiple URLs concurrently. */
async function parallel(urls, outDir, options = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const { browser, context } = await connect();
  try {
    const results = await Promise.all(urls.map(async (url, i) => {
      const p = await context.newPage();
      try {
        await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const safe = url.replace(/[^a-z0-9]/gi, '_').slice(0, 80);
        const out = path.join(outDir, `${String(i).padStart(3, '0')}_${safe}.png`);
        await p.screenshot({ path: out, fullPage: options.fullPage || false });
        return { url, out, ok: true };
      } catch (e) {
        return { url, ok: false, error: e.message };
      } finally {
        await p.close();
      }
    }));
    return results;
  } finally {
    await disconnect(browser);
  }
}

/** Get text content of first matching selector. */
async function extract(url, selector) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const text = await p.textContent(selector);
    await p.close();
    return text;
  } finally {
    await disconnect(browser);
  }
}

/** Get text of all matching elements. */
async function extractAll(url, selector) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const texts = await p.$$eval(selector, els => els.map(e => e.textContent?.trim() || ''));
    await p.close();
    return texts;
  } finally {
    await disconnect(browser);
  }
}

/** Dump accessibility tree (cleaner than DOM for LLM reasoning). */
async function a11y(url) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const snapshot = await p.accessibility.snapshot({ interestingOnly: true });
    await p.close();
    return snapshot;
  } finally {
    await disconnect(browser);
  }
}

/** Save page as PDF. */
async function pdf(url, outPath) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await p.pdf({ path: outPath, format: 'Letter', printBackground: true });
    await p.close();
    return outPath;
  } finally {
    await disconnect(browser);
  }
}

/** Run arbitrary JS in the page context, return result. */
async function evaluate(url, jsCode) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // eslint-disable-next-line no-new-func
    const result = await p.evaluate(jsCode);
    await p.close();
    return result;
  } finally {
    await disconnect(browser);
  }
}

/** Get cookies for a URL. */
async function cookies(url) {
  const { browser, context } = await connect();
  try {
    return await context.cookies(url);
  } finally {
    await disconnect(browser);
  }
}

/** Navigate and click a selector. Returns new URL after click. */
async function click(url, selector) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.click(selector);
    await p.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    const result = { url: p.url(), title: await p.title() };
    await p.close();
    return result;
  } finally {
    await disconnect(browser);
  }
}

/** Fill a form field. */
async function fill(url, selector, text) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.fill(selector, text);
    // Keep the page open so user can see/verify, or caller can chain .click() etc.
    return { ok: true };
  } finally {
    await disconnect(browser);
  }
}

/** Check if selector exists on the page. */
async function exists(url, selector) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const el = await p.$(selector);
    const found = el !== null;
    await p.close();
    return found;
  } finally {
    await disconnect(browser);
  }
}

/** innerText of entire page. */
async function text(url) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const t = await p.evaluate(() => document.body.innerText);
    await p.close();
    return t;
  } finally {
    await disconnect(browser);
  }
}

/** Full HTML of the page. */
async function html(url) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const h = await p.content();
    await p.close();
    return h;
  } finally {
    await disconnect(browser);
  }
}

/** Page title. */
async function title(url) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const t = await p.title();
    await p.close();
    return t;
  } finally {
    await disconnect(browser);
  }
}

/** Just open URL in existing browser context — leaves tab open. */
async function open(url) {
  const { browser, context } = await connect();
  try {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return { url: p.url(), title: await p.title() };
  } finally {
    await disconnect(browser);
  }
}

// --- Exports ---

module.exports = {
  connect, disconnect, ping,
  screenshot, fullPageScreenshot, parallel,
  extract, extractAll, a11y, pdf, evaluate, cookies,
  click, fill, exists, text, html, title, open,
  CDP_URL, CDP_PORT, PWCORE_PATH,
};

// --- CLI dispatch ---

if (require.main === module) {
  (async () => {
    const [cmd, ...args] = process.argv.slice(2);
    const commands = {
      ping: async () => console.log(JSON.stringify(await ping(), null, 2)),
      screenshot: async (url, out = 'screenshot.png') =>
        console.log(await screenshot(url, out)),
      fullpage: async (url, out) => console.log(await fullPageScreenshot(url, out)),
      parallel: async (urlsFile, outDir) => {
        const urls = fs.readFileSync(urlsFile, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
        console.log(JSON.stringify(await parallel(urls, outDir), null, 2));
      },
      extract: async (url, sel) => console.log(await extract(url, sel)),
      extractall: async (url, sel) => console.log(JSON.stringify(await extractAll(url, sel), null, 2)),
      a11y: async (url) => console.log(JSON.stringify(await a11y(url), null, 2)),
      pdf: async (url, out) => console.log(await pdf(url, out)),
      evaluate: async (url, code) => console.log(JSON.stringify(await evaluate(url, code), null, 2)),
      cookies: async (url) => console.log(JSON.stringify(await cookies(url), null, 2)),
      click: async (url, sel) => console.log(JSON.stringify(await click(url, sel), null, 2)),
      fill: async (url, sel, text) => console.log(JSON.stringify(await fill(url, sel, text), null, 2)),
      exists: async (url, sel) => console.log(await exists(url, sel)),
      text: async (url) => console.log(await text(url)),
      html: async (url) => console.log(await html(url)),
      title: async (url) => console.log(await title(url)),
      open: async (url) => console.log(JSON.stringify(await open(url), null, 2)),
    };
    const fn = commands[cmd?.toLowerCase()];
    if (!fn) {
      console.error('Usage: node cdp.js <command> [args]');
      console.error('Commands: ' + Object.keys(commands).join(', '));
      process.exit(1);
    }
    try {
      await fn(...args);
    } catch (e) {
      console.error('ERROR:', e.message);
      process.exit(2);
    }
  })();
}
