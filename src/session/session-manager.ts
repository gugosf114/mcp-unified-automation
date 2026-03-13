import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ToolResult, ContextName, PageHandle } from '../types/common.js';
import { env } from '../env.js';
import { waitForReadiness } from '../readiness.js';

/**
 * SessionManager — single persistent BrowserContext, multiple named page slots.
 *
 * Two modes:
 *   1. CDP Connect (BROWSER_CDP_URL set) — attaches to the user's already-running
 *      Chrome via DevTools Protocol. Same tabs, cookies, logins. No new window.
 *      Chrome must be started with --remote-debugging-port=9222.
 *
 *   2. Persistent Launch (fallback) — spawns a new Chrome with a dedicated profile.
 *      Used only when CDP URL is not configured.
 *
 * Named "contexts" (linkedin, credit, court) are logical page groupings —
 * all pages share the same cookie jar.
 */
export class SessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Map<ContextName, PageHandle> = new Map();
  private defaultContext: ContextName = 'default';
  private cdpMode: boolean = false;

  // Configuration (from environment)
  private headed: boolean;
  private chromeChannel: string | undefined;
  private chromeUserDataDir: string;
  private blockMedia: boolean;
  private humanDelayMin: number;
  private humanDelayMax: number;
  private cdpUrl: string | undefined;

  constructor() {
    this.headed = env.BROWSER_HEADED;
    this.chromeChannel = env.CHROME_CHANNEL || undefined;
    this.blockMedia = env.BROWSER_BLOCK_MEDIA;
    this.humanDelayMin = env.FAST_MODE ? 0 : env.HUMAN_DELAY_MIN;
    this.humanDelayMax = env.FAST_MODE ? 0 : env.HUMAN_DELAY_MAX;
    this.chromeUserDataDir = env.CHROME_USER_DATA_DIR;
    this.cdpUrl = env.BROWSER_CDP_URL;
  }

  async humanDelay(): Promise<void> {
    if (this.humanDelayMin > 0 && this.humanDelayMax > 0) {
      const delay = Math.floor(
        Math.random() * (this.humanDelayMax - this.humanDelayMin) + this.humanDelayMin
      );
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  async launch(): Promise<BrowserContext> {
    if (this.context) return this.context;

    // ── CDP Connect mode: attach to user's running Chrome ──────────
    if (this.cdpUrl) {
      return this.connectViaCDP(this.cdpUrl);
    }

    // ── Persistent Launch mode: spawn new Chrome ───────────────────
    return this.launchPersistent();
  }

  private async connectViaCDP(cdpUrl: string): Promise<BrowserContext> {
    try {
      this.browser = await chromium.connectOverCDP(cdpUrl);
      const contexts = this.browser.contexts();
      if (contexts.length === 0) {
        throw new Error('Connected to Chrome via CDP but found no browser contexts');
      }
      this.context = contexts[0]; // Default browser context
      this.cdpMode = true;

      const pageCount = this.context.pages().length;
      console.error(`[SessionManager] CDP connected to ${cdpUrl}`);
      console.error(`[SessionManager]   Existing tabs: ${pageCount}`);
      console.error(`[SessionManager]   Mode: attached to user's browser (no new window)`);

      return this.context;
    } catch (error: any) {
      if (error.message?.includes('ECONNREFUSED') || error.message?.includes('connect')) {
        throw new Error(
          `Could not connect to Chrome at ${cdpUrl}. ` +
          `Make sure Chrome is running with --remote-debugging-port=9222. ` +
          `You can use LAUNCH_CHROME_DEBUG.bat to start it.\n` +
          `Original: ${error.message.slice(0, 200)}`
        );
      }
      throw error;
    }
  }

  private async launchPersistent(): Promise<BrowserContext> {
    if (!existsSync(this.chromeUserDataDir)) {
      throw new Error(
        `Chrome user data directory not found at: ${this.chromeUserDataDir}. ` +
        `Set CHROME_USER_DATA_DIR environment variable to the correct path.`
      );
    }

    try {
      this.context = await chromium.launchPersistentContext(this.chromeUserDataDir, {
        headless: !this.headed,
        channel: this.chromeChannel as any,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--no-restore-state-on-startup',
          '--hide-crash-restore-bubble',
        ],
        viewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        timeout: 60_000,
      });

      // Anti-detection for all new pages
      this.context.on('page', async (page) => {
        await page.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });
      });

      // Block media if configured
      if (this.blockMedia) {
        await this.context.route(
          '**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}',
          route => route.abort()
        );
        await this.context.route('**/*google-analytics*', route => route.abort());
        await this.context.route('**/*facebook*', route => route.abort());
        await this.context.route('**/*doubleclick*', route => route.abort());
      }

      // Handle dialogs automatically
      this.context.on('page', (page) => {
        page.on('dialog', async dialog => {
          await dialog.accept();
        });
      });

      console.error(`[SessionManager] Launched persistent Chrome`);
      console.error(`[SessionManager]   Profile: ${this.chromeUserDataDir}`);

      return this.context;
    } catch (error: any) {
      if (error.message?.includes('lock') || error.message?.includes('already in use') ||
          error.message?.includes('non-default data directory')) {
        throw new Error(
          'Chrome profile launch failed — the user-data-dir may be locked by another Chrome ' +
          'instance, or it is Chrome\'s default profile (which blocks DevTools remote debugging). ' +
          'Consider using CDP Connect mode instead: set BROWSER_CDP_URL=http://localhost:9222 ' +
          'and start Chrome with --remote-debugging-port=9222. ' +
          `Original: ${error.message.slice(0, 200)}`
        );
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.cdpMode) {
      // CDP mode: just disconnect — do NOT close the user's browser
      this.context = null;
      this.browser = null;
      this.pages.clear();
      console.error('[SessionManager] Disconnected from Chrome (browser stays open)');
    } else if (this.context) {
      await this.context.close();
      this.context = null;
      this.pages.clear();
    }
  }

  /**
   * Pick the best reusable page from the context, skipping chrome:// internal tabs.
   */
  private pickReusablePage(ctx: BrowserContext): Page | null {
    const pages = ctx.pages().filter(p => !p.isClosed());
    if (pages.length === 0) return null;
    const realPages = pages.filter(p => !p.url().startsWith('chrome://'));
    return realPages[realPages.length - 1] ?? pages[pages.length - 1];
  }

  // ── Named page management ─────────────────────────────────────────

  /**
   * Open or reuse a labeled page in the persistent context.
   * If the page for this name was already opened and is still alive, return it.
   * Otherwise create a new tab.
   */
  async open(name: ContextName): Promise<PageHandle> {
    const existing = this.pages.get(name);
    if (existing && !existing.page.isClosed()) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    const ctx = await this.launch();
    let page: Page;

    if (name === this.defaultContext) {
      // For "default", reuse the most recent real page (skip chrome:// tabs)
      const reusable = this.pickReusablePage(ctx);
      page = reusable ?? await ctx.newPage();
    } else {
      page = await ctx.newPage();
    }

    const handle: PageHandle = {
      contextName: name,
      page,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      homeUrl: this.getHomeUrl(name),
    };

    this.pages.set(name, handle);
    return handle;
  }

  /**
   * Ensure a page exists for this name AND navigate to its home URL.
   */
  async warm(name: ContextName): Promise<PageHandle> {
    const handle = await this.open(name);
    const homeUrl = handle.homeUrl;
    if (homeUrl && handle.page.url() !== homeUrl) {
      await handle.page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const readiness = await waitForReadiness(handle.page, homeUrl);
      if (!readiness.profileMatched && !env.FAST_MODE) {
        await handle.page.waitForLoadState('networkidle').catch(() => {});
      }
    }
    return handle;
  }

  /**
   * Get the Playwright Page for a named session. Falls back to "default".
   */
  async getPage(name?: ContextName): Promise<Page> {
    const handle = await this.open(name || this.defaultContext);
    return handle.page;
  }

  async closePage(name: ContextName): Promise<void> {
    const handle = this.pages.get(name);
    if (handle && !handle.page.isClosed()) {
      await handle.page.close();
    }
    this.pages.delete(name);
  }

  listContexts(): ContextName[] {
    return Array.from(this.pages.keys()).filter(name => {
      const handle = this.pages.get(name);
      return handle && !handle.page.isClosed();
    });
  }

  getBrowserContext(): BrowserContext | null {
    return this.context;
  }

  isCdpMode(): boolean {
    return this.cdpMode;
  }

  // ── Context home URLs (from env) ──────────────────────────────────

  private getHomeUrl(name: ContextName): string | undefined {
    const envKey = `CONTEXT_${name.toUpperCase()}_HOME`;
    return process.env[envKey];
  }

  // ── Backward-compatible methods (delegate to default page) ────────

  async navigate(url: string, waitFor?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      let readinessResult: { profileMatched: boolean; selectorFound: boolean; domain?: string } = { profileMatched: false, selectorFound: false };
      if (waitFor) {
        await page.waitForSelector(waitFor, { state: 'visible', timeout: 10000 });
      } else {
        readinessResult = await waitForReadiness(page, url);
        if (!readinessResult.profileMatched && !env.FAST_MODE) {
          await page.waitForLoadState('networkidle').catch(() => {});
        }
      }

      const title = await page.title();
      const currentUrl = page.url();
      const readyState = await page.evaluate(() => document.readyState);

      return {
        status: "success",
        data: {
          title, url: currentUrl, readyState,
          readiness: readinessResult.profileMatched
            ? { matched: true, selectorFound: readinessResult.selectorFound, domain: readinessResult.domain }
            : { matched: false },
        },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async extractContent(selector: string, extract: string, attribute?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const elements = await page.$$(selector);

      if (elements.length === 0) {
        return {
          status: "error",
          error: `No elements found matching selector: ${selector} on ${page.url()}`,
          duration_ms: Date.now() - start,
        };
      }

      const results: any[] = [];
      for (const el of elements) {
        switch (extract) {
          case 'text':
            results.push(await el.textContent());
            break;
          case 'html':
            results.push(await el.innerHTML());
            break;
          case 'links': {
            const href = await el.getAttribute('href');
            const text = await el.textContent();
            results.push({ href, text: text?.trim() });
            break;
          }
          case 'attribute':
            if (attribute) {
              results.push(await el.getAttribute(attribute));
            }
            break;
        }
      }

      return {
        status: "success",
        data: results,
        details: `Found ${elements.length} element(s)`,
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async fillForm(fields: Record<string, string>, submitSelector?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const filled: string[] = [];

      for (const [selector, value] of Object.entries(fields)) {
        await this.humanDelay();
        await page.fill(selector, value);
        filled.push(selector);
      }

      if (submitSelector) {
        await this.humanDelay();
        if (!env.FAST_MODE) {
          await Promise.all([
            page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
            page.click(submitSelector),
          ]);
        } else {
          await page.click(submitSelector);
        }
      }

      const currentUrl = (await this.getPage()).url();
      return {
        status: "success",
        data: {
          filled_fields: filled,
          fieldCount: filled.length,
          submitted: !!submitSelector,
          url: currentUrl,
        },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async click(selector: string, waitAfter: boolean = true): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const urlBefore = page.url();
      await this.humanDelay();

      const shouldWaitForNav = waitAfter && !env.FAST_MODE;
      if (shouldWaitForNav) {
        await Promise.all([
          page.waitForNavigation({ timeout: 10000 }).catch(() => {}),
          page.click(selector),
        ]);
      } else {
        await page.click(selector);
      }

      const urlAfter = page.url();
      return {
        status: "success",
        data: {
          clicked: selector,
          url: urlAfter,
          navigationOccurred: urlAfter !== urlBefore,
          selectorMatched: true,
        },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async screenshot(path?: string, fullPage: boolean = false): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const screenshotPath = path || join(homedir(), 'Desktop', `screenshot-${Date.now()}.png`);

      await page.screenshot({ path: screenshotPath, fullPage });

      return {
        status: "success",
        data: { path: screenshotPath },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async executeScript(script: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const result = await page.evaluate(script);

      return {
        status: "success",
        data: result,
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async getPageInfo(): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.getPage();
      const title = await page.title();
      const url = page.url();

      const summary = await page.evaluate(() => {
        const forms = document.querySelectorAll('form').length;
        const links = document.querySelectorAll('a').length;
        const buttons = document.querySelectorAll('button').length;
        const inputs = document.querySelectorAll('input, textarea, select').length;
        const iframes = document.querySelectorAll('iframe').length;
        return { forms, links, buttons, inputs, iframes };
      });

      return {
        status: "success",
        data: { title, url, dom_summary: summary },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }
}
