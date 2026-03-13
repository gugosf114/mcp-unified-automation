import type { ToolResult, ContextName } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { MetricsEngine } from '../metrics/metrics-engine.js';
import { withRetry } from './retry.js';
import { env } from '../env.js';
import { waitForReadiness } from '../readiness.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';

/**
 * ActionExecutor — deterministic browser primitives with optional retry.
 *
 * Every method is context-aware (takes a ContextName) and uses
 * state-based waits only (waitForSelector, waitForLoadState) —
 * never blind setTimeout sleeps.
 *
 * Key methods support withRetry() for transient failures (overlay
 * blocking click, element not yet visible, etc.).
 */
export class ActionExecutor {
  constructor(
    private sessionManager: SessionManager,
    private metricsEngine: MetricsEngine,
  ) {}

  async goto(contextName: ContextName, url: string, opts?: {
    waitFor?: string;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
    timeout?: number;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      await page.goto(url, {
        waitUntil: opts?.waitUntil || 'domcontentloaded',
        timeout: opts?.timeout || 30000,
      });

      let readinessResult: { profileMatched: boolean; selectorFound: boolean; domain?: string } = { profileMatched: false, selectorFound: false };
      if (opts?.waitFor) {
        await page.waitForSelector(opts.waitFor, { state: 'visible', timeout: 10000 });
      } else {
        readinessResult = await waitForReadiness(page, url);
        if (!readinessResult.profileMatched && !env.FAST_MODE) {
          await page.waitForLoadState('networkidle').catch(() => {});
        }
      }

      const title = await page.title();
      const readyState = await page.evaluate(() => document.readyState);
      return {
        status: "success",
        data: {
          title, url: page.url(), readyState,
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

  async click(contextName: ContextName, selector: string, opts?: {
    waitForNav?: boolean;
    timeout?: number;
    retry?: boolean;
  }): Promise<ToolResult> {
    const action = async (): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const page = await this.sessionManager.getPage(contextName);
        const urlBefore = page.url();
        await this.sessionManager.humanDelay();

        const shouldWaitForNav = opts?.waitForNav ?? !env.FAST_MODE;
        if (shouldWaitForNav) {
          await Promise.all([
            page.waitForNavigation({ timeout: opts?.timeout || 10000 }).catch(() => {}),
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
    };

    if (opts?.retry !== false) {
      return withRetry(action, { maxAttempts: 3, backoffMs: 500 });
    }
    return action();
  }

  async fill(contextName: ContextName, selector: string, value: string, opts?: {
    retry?: boolean;
  }): Promise<ToolResult> {
    const action = async (): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const page = await this.sessionManager.getPage(contextName);
        await this.sessionManager.humanDelay();
        await page.fill(selector, value);
        return {
          status: "success",
          data: { filled: selector, length: value.length },
          duration_ms: Date.now() - start,
        };
      } catch (error: any) {
        return { status: "error", error: error.message, duration_ms: Date.now() - start };
      }
    };
    if (opts?.retry !== false) {
      return withRetry(action, { maxAttempts: 3, backoffMs: 500 });
    }
    return action();
  }

  async type(contextName: ContextName, selector: string, value: string, opts?: {
    clearFirst?: boolean;
    delay?: number;
    retry?: boolean;
  }): Promise<ToolResult> {
    const action = async (): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const page = await this.sessionManager.getPage(contextName);
        await this.sessionManager.humanDelay();

        if (opts?.clearFirst !== false) {
          await page.fill(selector, '');
        }
        await page.type(selector, value, { delay: opts?.delay || 0 });

        return {
          status: "success",
          data: { typed: selector, length: value.length },
          duration_ms: Date.now() - start,
        };
      } catch (error: any) {
        return { status: "error", error: error.message, duration_ms: Date.now() - start };
      }
    };

    if (opts?.retry !== false) {
      return withRetry(action, { maxAttempts: 3, backoffMs: 500 });
    }
    return action();
  }

  async select(contextName: ContextName, selector: string, value: string, opts?: {
    retry?: boolean;
  }): Promise<ToolResult> {
    const action = async (): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const page = await this.sessionManager.getPage(contextName);
        await page.selectOption(selector, value);

        return {
          status: "success",
          data: { selected: selector, value },
          duration_ms: Date.now() - start,
        };
      } catch (error: any) {
        return { status: "error", error: error.message, duration_ms: Date.now() - start };
      }
    };

    if (opts?.retry !== false) {
      return withRetry(action, { maxAttempts: 3, backoffMs: 500 });
    }
    return action();
  }

  async upload(contextName: ContextName, selector: string, filePath: string, opts?: {
    retry?: boolean;
  }): Promise<ToolResult> {
    const action = async (): Promise<ToolResult> => {
      const start = Date.now();
      try {
        const page = await this.sessionManager.getPage(contextName);
        await page.setInputFiles(selector, filePath);

        return {
          status: "success",
          data: { uploaded: filePath, selector },
          duration_ms: Date.now() - start,
        };
      } catch (error: any) {
        return { status: "error", error: error.message, duration_ms: Date.now() - start };
      }
    };

    if (opts?.retry !== false) {
      return withRetry(action, { maxAttempts: 2, backoffMs: 1000 });
    }
    return action();
  }

  async waitForState(contextName: ContextName, opts: {
    selector?: string;
    state?: 'visible' | 'hidden' | 'attached' | 'detached';
    url?: string;
    timeout?: number;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);

      if (opts.selector) {
        await page.waitForSelector(opts.selector, {
          state: opts.state || 'visible',
          timeout: opts.timeout || 10000,
        });
      }

      if (opts.url) {
        await page.waitForURL(opts.url, { timeout: opts.timeout || 10000 });
      }

      return {
        status: "success",
        data: { waited: opts.selector || opts.url, url: page.url() },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async extractContent(contextName: ContextName, selector: string, extract: string, attribute?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const elements = await page.$$(selector);

      if (elements.length === 0) {
        return {
          status: "error",
          error: `No elements found matching: ${selector}`,
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
            if (attribute) results.push(await el.getAttribute(attribute));
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

  async screenshot(contextName: ContextName, path?: string, fullPage?: boolean): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const screenshotPath = path || join(homedir(), 'Desktop', `screenshot-${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: fullPage || false });

      return {
        status: "success",
        data: { path: screenshotPath },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async evaluate(contextName: ContextName, script: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
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

  async getPageInfo(contextName: ContextName): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const title = await page.title();
      const url = page.url();

      const summary = await page.evaluate(() => {
        return {
          forms: document.querySelectorAll('form').length,
          links: document.querySelectorAll('a').length,
          buttons: document.querySelectorAll('button').length,
          inputs: document.querySelectorAll('input, textarea, select').length,
          iframes: document.querySelectorAll('iframe').length,
        };
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

  // ── Extended primitives ─────────────────────────────────────────────

  async scroll(contextName: ContextName, opts?: {
    direction?: 'down' | 'up' | 'left' | 'right';
    amount?: number;
    selector?: string;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const direction = opts?.direction || 'down';
      const amount = opts?.amount || 500;

      if (opts?.selector) {
        const el = await page.$(opts.selector);
        if (!el) return { status: "error", error: `Element not found: ${opts.selector}`, duration_ms: Date.now() - start };
        await el.scrollIntoViewIfNeeded();
        return { status: "success", data: { scrolledTo: opts.selector }, duration_ms: Date.now() - start };
      }

      const deltaX = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
      const deltaY = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
      await page.mouse.wheel(deltaX, deltaY);

      const scrollPos = await page.evaluate(() => ({
        x: window.scrollX, y: window.scrollY,
        maxX: document.documentElement.scrollWidth - window.innerWidth,
        maxY: document.documentElement.scrollHeight - window.innerHeight,
      }));

      return { status: "success", data: { direction, amount, scroll: scrollPos }, duration_ms: Date.now() - start };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async hover(contextName: ContextName, selector: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      await this.sessionManager.humanDelay();
      await page.hover(selector);
      return { status: "success", data: { hovered: selector }, duration_ms: Date.now() - start };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async keyboard(contextName: ContextName, key: string, opts?: {
    modifiers?: Array<'Control' | 'Shift' | 'Alt' | 'Meta'>;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      await this.sessionManager.humanDelay();

      if (opts?.modifiers && opts.modifiers.length > 0) {
        const combo = [...opts.modifiers, key].join('+');
        await page.keyboard.press(combo);
        return { status: "success", data: { pressed: combo }, duration_ms: Date.now() - start };
      }

      await page.keyboard.press(key);
      return { status: "success", data: { pressed: key }, duration_ms: Date.now() - start };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async drag(contextName: ContextName, sourceSelector: string, targetSelector: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      await this.sessionManager.humanDelay();
      await page.dragAndDrop(sourceSelector, targetSelector);
      return {
        status: "success",
        data: { from: sourceSelector, to: targetSelector },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async switchToFrame(contextName: ContextName, frameSelector: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const frame = page.frameLocator(frameSelector);
      // Verify the frame exists by checking for the body element
      await frame.locator('body').waitFor({ state: 'attached', timeout: 5000 });
      return {
        status: "success",
        data: { frame: frameSelector, note: 'Use frameLocator in subsequent calls' },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async waitForText(contextName: ContextName, text: string, opts?: {
    timeout?: number;
    selector?: string;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const container = opts?.selector || 'body';
      await page.locator(`${container}:has-text("${text.replace(/"/g, '\\"')}")`).waitFor({
        state: 'visible',
        timeout: opts?.timeout || 10000,
      });
      return {
        status: "success",
        data: { foundText: text, in: container, url: page.url() },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async pdf(contextName: ContextName, path?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const pdfDir = join(homedir(), 'Desktop');
      mkdirSync(pdfDir, { recursive: true });
      const pdfPath = path || join(pdfDir, `page-${Date.now()}.pdf`);
      await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
      return { status: "success", data: { path: pdfPath }, duration_ms: Date.now() - start };
    } catch (error: any) {
      // PDF requires headless mode — provide a clear error
      const msg = error.message?.includes('headless')
        ? 'PDF generation requires headless mode (BROWSER_HEADED=false)'
        : error.message;
      return { status: "error", error: msg, duration_ms: Date.now() - start };
    }
  }

  async download(contextName: ContextName, triggerSelector: string, downloadDir?: string): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      const dir = downloadDir || join(homedir(), 'Downloads');
      mkdirSync(dir, { recursive: true });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        page.click(triggerSelector),
      ]);

      const suggestedName = download.suggestedFilename();
      const savePath = join(dir, suggestedName);
      await download.saveAs(savePath);

      return {
        status: "success",
        data: { path: savePath, filename: suggestedName, url: download.url() },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async accessibilityTree(contextName: ContextName): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      // Playwright ≥1.48 deprecated page.accessibility.snapshot().
      // Use aria-snapshot via locator instead, falling back to a DOM walk.
      const snapshot = await page.evaluate(() => {
        function walk(el: Element, depth: number = 0): any {
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const name = el.getAttribute('aria-label') || el.getAttribute('alt') ||
            (el as HTMLElement).innerText?.slice(0, 80) || '';
          const node: any = { role, name: name.trim() };
          if (el.getAttribute('aria-expanded')) node.expanded = el.getAttribute('aria-expanded') === 'true';
          if (el.getAttribute('aria-checked')) node.checked = el.getAttribute('aria-checked') === 'true';
          if (el.getAttribute('aria-disabled')) node.disabled = el.getAttribute('aria-disabled') === 'true';
          if ((el as HTMLInputElement).value) node.value = (el as HTMLInputElement).value;
          const children: any[] = [];
          if (depth < 5) {
            for (const child of el.children) {
              children.push(walk(child, depth + 1));
            }
          }
          if (children.length > 0) node.children = children;
          return node;
        }
        return walk(document.body);
      });
      return {
        status: "success",
        data: snapshot,
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }
}
