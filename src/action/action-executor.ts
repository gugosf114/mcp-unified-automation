import type { ToolResult, ContextName } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { MetricsEngine } from '../metrics/metrics-engine.js';
import { homedir } from 'os';
import { join } from 'path';

/**
 * ActionExecutor — deterministic browser primitives.
 *
 * Every method is context-aware (takes a ContextName) and uses
 * state-based waits only (waitForSelector, waitForLoadState) —
 * never blind setTimeout sleeps.
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

      if (opts?.waitFor) {
        await page.waitForSelector(opts.waitFor, { state: 'visible', timeout: 10000 });
      } else {
        await page.waitForLoadState('networkidle').catch(() => {});
      }

      const title = await page.title();
      return {
        status: "success",
        data: { title, url: page.url() },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async click(contextName: ContextName, selector: string, opts?: {
    waitForNav?: boolean;
    timeout?: number;
  }): Promise<ToolResult> {
    const start = Date.now();
    try {
      const page = await this.sessionManager.getPage(contextName);
      await this.sessionManager.humanDelay();

      if (opts?.waitForNav !== false) {
        await Promise.all([
          page.waitForNavigation({ timeout: opts?.timeout || 10000 }).catch(() => {}),
          page.click(selector),
        ]);
      } else {
        await page.click(selector);
      }

      return {
        status: "success",
        data: { clicked: selector, url: page.url() },
        duration_ms: Date.now() - start,
      };
    } catch (error: any) {
      return { status: "error", error: error.message, duration_ms: Date.now() - start };
    }
  }

  async type(contextName: ContextName, selector: string, value: string, opts?: {
    clearFirst?: boolean;
    delay?: number;
  }): Promise<ToolResult> {
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
  }

  async select(contextName: ContextName, selector: string, value: string): Promise<ToolResult> {
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
  }

  async upload(contextName: ContextName, selector: string, filePath: string): Promise<ToolResult> {
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
}
