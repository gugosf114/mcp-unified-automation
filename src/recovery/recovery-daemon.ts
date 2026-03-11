import type { Page } from 'playwright';
import type { ContextName } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ActionExecutor } from '../action/action-executor.js';
import type { EvidenceLedger } from '../evidence/evidence-ledger.js';
import type { MetricsEngine } from '../metrics/metrics-engine.js';

export interface RecoveryPlaybook {
  name: string;
  detect: (page: Page, contextName: ContextName) => Promise<boolean>;
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
        const detected = await playbook.detect(page, contextName);
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
      detect: async (page, _contextName) => {
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
      detect: async (page, _contextName) => {
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
      detect: async (page, _contextName) => {
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
      detect: async (page, _contextName) => {
        // Find which context owns this page by matching the URL in our history
        let matchedHistory: Array<{ url: string; time: number }> | undefined;
        for (const [_ctxName, history] of this.urlHistory.entries()) {
          const lastEntry = history[history.length - 1];
          if (lastEntry && lastEntry.url === page.url()) {
            matchedHistory = history;
            break;
          }
        }
        if (!matchedHistory || matchedHistory.length < 6) return false;

        // Check last 6 entries for a repeating cycle of 2-3 URLs
        const recent = matchedHistory.slice(-6).map(h => h.url);
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

    // 5. Network error detector (DNS, connection refused, timeout, SSL)
    this.playbooks.push({
      name: 'network_error',
      detect: async (page, _contextName) => {
        try {
          const hasNetError = await page.evaluate(() => {
            const body = document.body?.innerText || '';
            const title = document.title || '';
            const combined = (body + ' ' + title).toLowerCase();
            return (
              combined.includes('err_connection_refused') ||
              combined.includes('err_name_not_resolved') ||
              combined.includes('err_internet_disconnected') ||
              combined.includes('err_network_changed') ||
              combined.includes('err_connection_timed_out') ||
              combined.includes('err_connection_reset') ||
              combined.includes('err_ssl_protocol_error') ||
              combined.includes('dns_probe_finished') ||
              combined.includes('this site can\u2019t be reached') ||
              combined.includes("this site can't be reached") ||
              combined.includes('unable to connect')
            );
          });
          return hasNetError;
        } catch {
          // page.evaluate itself failing often means the page crashed
          return true;
        }
      },
      recover: async (page) => {
        try {
          // Wait 3s then reload — transient network issues often self-resolve
          await new Promise(r => setTimeout(r, 3000));
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
          // Verify we got a real page back
          const stillBroken = await page.evaluate(() => {
            const text = (document.body?.innerText || '').toLowerCase();
            return text.includes('err_') || text.includes("this site can");
          }).catch(() => true);
          if (stillBroken) {
            // Second attempt with longer backoff
            await new Promise(r => setTimeout(r, 5000));
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
          }
          console.error('[RecoveryDaemon] Network error — reload attempted');
          return true;
        } catch {
          console.error('[RecoveryDaemon] Network error — reload failed, network may be down');
          return false;
        }
      },
    });

    // 6. Anti-bot / rate-limit detector (Cloudflare, LinkedIn walls, generic blocks)
    this.playbooks.push({
      name: 'anti_bot',
      detect: async (page, _contextName) => {
        try {
          const blockType = await page.evaluate(() => {
            const body = document.body?.innerText?.toLowerCase() || '';
            const title = document.title?.toLowerCase() || '';
            const combined = body + ' ' + title;

            // Cloudflare challenge
            if (
              combined.includes('checking your browser') ||
              combined.includes('attention required') ||
              (combined.includes('cloudflare') && combined.includes('ray id')) ||
              document.querySelector('#cf-challenge-running') ||
              document.querySelector('.cf-browser-verification')
            ) return 'cloudflare';

            // LinkedIn auth wall / rate limit
            if (
              combined.includes("let's do a quick security check") ||
              combined.includes("we've detected unusual activity") ||
              combined.includes('auth wall') ||
              (document.querySelector('.join-form') && combined.includes('sign in')) ||
              combined.includes('too many requests') ||
              combined.includes('rate limit')
            ) return 'linkedin_block';

            // Generic bot detection / 403 / 429
            if (
              combined.includes('access denied') ||
              (combined.includes('blocked') && combined.includes('automated')) ||
              (combined.includes('robot') && combined.includes('not a robot')) ||
              combined.includes('suspicious activity') ||
              combined.includes('please verify you are human')
            ) return 'generic_block';

            return null;
          });
          return blockType !== null;
        } catch { return false; }
      },
      recover: async (page) => {
        // Anti-bot walls cannot be auto-solved — identify the type and log for intervention
        try {
          const blockType = await page.evaluate(() => {
            const combined = (document.body?.innerText + ' ' + document.title).toLowerCase();
            if (combined.includes('cloudflare')) return 'Cloudflare challenge';
            if (combined.includes('linkedin') || combined.includes('security check')) return 'LinkedIn auth wall';
            if (combined.includes('rate limit') || combined.includes('too many')) return 'Rate limit (429)';
            return 'Generic anti-bot block';
          }).catch(() => 'Unknown block type');
          console.error(`[RecoveryDaemon] Anti-bot detected: ${blockType} — manual intervention required`);
        } catch { /* best effort logging */ }
        return false; // never auto-recoverable
      },
    });

    // 7. Cookie consent auto-dismiss
    this.playbooks.push({
      name: 'cookie_consent',
      detect: async (page, _contextName) => {
        try {
          return await page.evaluate(() => {
            // Common cookie consent frameworks: OneTrust, CookieBot, CookieYes, Osano, etc.
            const selectors = [
              '#onetrust-accept-btn-handler',
              '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
              '[data-cookiefirst-action="accept"]',
              '.cookie-consent-accept',
              '[class*="cookie"] button[class*="accept"]',
              '[class*="cookie"] button[class*="Allow"]',
              '[id*="cookie"] button[class*="accept"]',
              '[aria-label*="cookie" i] button',
              '[aria-label*="consent" i] button',
              'button[data-testid*="cookie-accept"]',
              '.cc-accept',
              '.cc-allow',
              '#accept-cookies',
              '#acceptAllCookies',
              'button[id*="accept"][id*="cookie" i]',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel) as HTMLElement;
              if (el && el.offsetParent !== null) return true;
            }
            return false;
          });
        } catch { return false; }
      },
      recover: async (page) => {
        try {
          const clicked = await page.evaluate(() => {
            const selectors = [
              '#onetrust-accept-btn-handler',
              '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
              '[data-cookiefirst-action="accept"]',
              '.cookie-consent-accept',
              '[class*="cookie"] button[class*="accept"]',
              '[class*="cookie"] button[class*="Allow"]',
              '[id*="cookie"] button[class*="accept"]',
              '.cc-accept',
              '.cc-allow',
              '#accept-cookies',
              '#acceptAllCookies',
              'button[id*="accept"][id*="cookie" i]',
            ];
            for (const sel of selectors) {
              const el = document.querySelector(sel) as HTMLElement;
              if (el && el.offsetParent !== null) {
                el.click();
                return sel;
              }
            }
            return null;
          });
          if (clicked) {
            console.error(`[RecoveryDaemon] Dismissed cookie consent via ${clicked}`);
            return true;
          }
          return false;
        } catch { return false; }
      },
    });
  }
}
