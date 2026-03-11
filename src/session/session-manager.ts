import { chromium, type BrowserContext, type Page } from 'playwright';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { ToolResult, ContextName, PageHandle } from '../types/common.js';
import { env } from '../env.js';
import { waitForReadiness } from '../readiness.js';

/**
 * SessionManager — single persistent BrowserContext, multiple named page slots.
 *
 * Hard invariant: launchPersistentContext returns ONE BrowserContext and locks
 * the Chrome profile directory. Named "contexts" (linkedin, credit, court) are
 * logical page groupings — all pages share the same cookie jar. This is
 * intentional: authenticated sessions (LinkedIn login, bank cookies) are
 * available to every named page.
 */
export class SessionManager {
  private context: BrowserContext | null = null;
  private pages: Map<ContextName, PageHandle> = new Map();
  private defaultContext: ContextName = 'default';

  // Configuration (from environment)
  private headed: boolean;
  private chromeChannel: string | undefined;
  private chromeUserDataDir: string;
  private blockMedia: boolean;
  private humanDelayMin: number;
  private humanDelayMax: number;

  constructor() {
    // All env parsing and validation happens in src/env.ts via Zod.
    // HEADLESS vs BROWSER_HEADED priority is resolved there.
    this.headed = env.BROWSER_HEADED;
    this.chromeChannel = env.CHROME_CHANNEL || undefined;
    this.blockMedia = env.BROWSER_BLOCK_MEDIA;
    this.humanDelayMin = env.FAST_MODE ? 0 : env.HUMAN_DELAY_MIN;
    this.humanDelayMax = env.FAST_MODE ? 0 : env.HUMAN_DELAY_MAX;
    this.chromeUserDataDir = env.CHROME_USER_DATA_DIR;
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

      return this.context;
    } catch (error: any) {
      if (error.message?.includes('lock') || error.message?.includes('already in use') ||
          error.message?.includes('non-default data directory')) {
        throw new Error(
          'Chrome profile launch failed — the user-data-dir may be locked by another Chrome ' +
          'instance, or it is Chrome\'s default profile (which blocks DevTools remote debugging). ' +
          'Use a dedicated automation directory via CHROME_USER_DATA_DIR in .env. ' +
          `Original: ${error.message.slice(0, 200)}`
        );
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
      this.pages.clear();
    }
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
    // For "default", reuse an existing blank page if available
    let page: Page;
    if (name === this.defaultContext) {
      const allPages = ctx.pages();
      page = allPages.length > 0 ? allPages[allPages.length - 1] : await ctx.newPage();
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
   * Useful for pre-warming sessions (e.g., navigating to linkedin.com to
   * trigger cookie refresh before a task runs).
   */
  async warm(name: ContextName): Promise<PageHandle> {
    const handle = await this.open(name);
    const homeUrl = handle.homeUrl;
    if (homeUrl && handle.page.url() !== homeUrl) {
      await handle.page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Try domain-specific readiness first; fall back to networkidle only if no profile
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

  // ── Context home URLs (from env) ──────────────────────────────────

  private getHomeUrl(name: ContextName): string | undefined {
    // Check for CONTEXT_{NAME}_HOME environment variable
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
        // Try domain-specific readiness; fall back to networkidle only if no profile
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
