import type { Page } from 'playwright';
import type { ContextName } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ActionExecutor } from '../action/action-executor.js';
import type { EvidenceLedger } from '../evidence/evidence-ledger.js';
import type { MetricsEngine } from '../metrics/metrics-engine.js';

export interface RecoveryPlaybook {
  name: string;
  detect: (page: Page) => Promise<boolean>;
  recover: (page: Page, executor: ActionExecutor, contextName: ContextName) => Promise<boolean>;
}

/**
 * RecoveryDaemon — detects stalls, captchas, navigation loops,
 * and session expiry. Runs recovery playbooks automatically.
 *
 * Called by TaskRunner before each step (synchronous check),
 * or can run as a background poller via startMonitoring().
 */
export class RecoveryDaemon {
  private playbooks: RecoveryPlaybook[] = [];
  private monitoring: Map<ContextName, ReturnType<typeof setInterval>> = new Map();
  // Track recent URLs for nav loop detection
  private urlHistory: Map<ContextName, Array<{ url: string; time: number }>> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private actionExecutor: ActionExecutor,
    private evidenceLedger: EvidenceLedger,
    private metricsEngine: MetricsEngine,
  ) {
    this.loadDefaultPlaybooks();
  }

  registerPlaybook(playbook: RecoveryPlaybook): void {
    this.playbooks.push(playbook);
  }

  startMonitoring(contextName: ContextName, intervalMs: number = 5000): void {
    this.stopMonitoring(contextName);
    const timer = setInterval(async () => {
      try {
        await this.checkAndRecover(contextName);
      } catch { /* monitoring is best-effort */ }
    }, intervalMs);
    this.monitoring.set(contextName, timer);
  }

  stopMonitoring(contextName: ContextName): void {
    const timer = this.monitoring.get(contextName);
    if (timer) {
      clearInterval(timer);
      this.monitoring.delete(contextName);
    }
  }

  stopAllMonitoring(): void {
    for (const [name] of this.monitoring) {
      this.stopMonitoring(name);
    }
  }

  /**
   * Run all playbooks against the current page state.
   * Returns the first playbook that detected + recovered an issue.
   */
  async checkAndRecover(contextName: ContextName): Promise<{
    detected: string | null;
    recovered: boolean;
  }> {
    let page: Page;
    try {
      page = await this.sessionManager.getPage(contextName);
    } catch {
      return { detected: null, recovered: false };
    }

    // Track URL for nav loop detection
    this.trackUrl(contextName, page.url());

    for (const playbook of this.playbooks) {
      try {
        const detected = await playbook.detect(page);
        if (detected) {
          console.error(`[RecoveryDaemon] Detected: ${playbook.name} on ${contextName}`);
          const recovered = await playbook.recover(page, this.actionExecutor, contextName);
          return { detected: playbook.name, recovered };
        }
      } catch { /* individual playbook failures are non-fatal */ }
    }

    return { detected: null, recovered: false };
  }

  private trackUrl(contextName: ContextName, url: string): void {
    if (!this.urlHistory.has(contextName)) {
      this.urlHistory.set(contextName, []);
    }
    const history = this.urlHistory.get(contextName)!;
    history.push({ url, time: Date.now() });
    // Keep last 20 entries
    if (history.length > 20) history.shift();
  }

  // ── Default playbooks ─────────────────────────────────────────────

  private loadDefaultPlaybooks(): void {

    // 1. Captcha detector
    this.playbooks.push({
      name: 'captcha_detected',
      detect: async (page) => {
        try {
          const hasCaptcha = await page.evaluate(() => {
            return !!(
              document.querySelector('iframe[src*="recaptcha"]') ||
              document.querySelector('iframe[src*="hcaptcha"]') ||
              document.querySelector('#captcha') ||
              document.querySelector('.captcha-container') ||
              document.querySelector('[class*="captcha"]')
            );
          });
          return hasCaptcha;
        } catch { return false; }
      },
      recover: async (_page, _executor, _contextName) => {
        // Cannot auto-solve captchas — just flag it.
        // TaskRunner will see the detection and can pause.
        console.error('[RecoveryDaemon] Captcha detected — manual intervention needed');
        return false; // not auto-recoverable
      },
    });

    // 2. Stall detector (page stuck loading for >30s)
    this.playbooks.push({
      name: 'page_stall',
      detect: async (page) => {
        try {
          const readyState = await page.evaluate(() => document.readyState);
          // If page is still 'loading' and we've been stuck, it's a stall
          return readyState === 'loading';
        } catch { return false; }
      },
      recover: async (page) => {
        try {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
          return true;
        } catch { return false; }
      },
    });

    // 3. Session expiry detector
    this.playbooks.push({
      name: 'session_expired',
      detect: async (page) => {
        try {
          const hasExpiry = await page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || '';
            return (
              text.includes('session expired') ||
              text.includes('session has expired') ||
              text.includes('please log in again') ||
              text.includes('your session has timed out')
            );
          });
          return hasExpiry;
        } catch { return false; }
      },
      recover: async (_page) => {
        // Can't auto-recover — needs re-authentication
        console.error('[RecoveryDaemon] Session expired — re-authentication needed');
        return false;
      },
    });

    // 4. Navigation loop detector
    this.playbooks.push({
      name: 'navigation_loop',
      detect: async (page) => {
        const contextName = 'default'; // simplified — real impl would track per-context
        const history = this.urlHistory.get(contextName) || [];
        if (history.length < 6) return false;

        // Check last 6 entries for a repeating cycle of 2-3 URLs
        const recent = history.slice(-6).map(h => h.url);
        const unique = new Set(recent);
        // If 6 recent URLs only have 2-3 unique values → loop
        return unique.size <= 3 && recent.length >= 6;
      },
      recover: async (page) => {
        try {
          await page.goBack({ timeout: 10000 });
          return true;
        } catch { return false; }
      },
    });
  }
}
