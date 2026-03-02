import type { CDPSession, Page, BrowserContext } from 'playwright';
import type { ContextName } from '../types/common.js';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string;
  resourceType: string;
  timestamp: number;
}

export interface CapturedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  mimeType: string;
  bodySize: number;
  timestamp: number;
}

/**
 * CDPBridge — per-page Chrome DevTools Protocol session.
 *
 * Attaches to pages via Playwright's `context.newCDPSession(page)`.
 * Enables Network, Runtime, Performance, and Log domains.
 * Captures XHR/fetch signatures so the NetworkOrchestrator can
 * discover JSON API endpoints for later direct offload.
 */
export class CDPBridge {
  private sessions: Map<ContextName, CDPSession> = new Map();
  private requestLog: CapturedRequest[] = [];
  private responseLog: CapturedResponse[] = [];

  async attach(contextName: ContextName, page: Page, context: BrowserContext): Promise<CDPSession> {
    // Detach existing session for this context if any
    await this.detach(contextName);

    const session = await context.newCDPSession(page);
    this.sessions.set(contextName, session);

    await this.enableDomains(session);
    this.attachListeners(session);

    return session;
  }

  async detach(contextName: ContextName): Promise<void> {
    const session = this.sessions.get(contextName);
    if (session) {
      try {
        await session.detach();
      } catch { /* may already be detached */ }
      this.sessions.delete(contextName);
    }
  }

  getSession(contextName: ContextName): CDPSession | undefined {
    return this.sessions.get(contextName);
  }

  private async enableDomains(session: CDPSession): Promise<void> {
    await session.send('Network.enable');
    await session.send('Runtime.enable');
    await session.send('Performance.enable');
    await session.send('Log.enable');
  }

  private attachListeners(session: CDPSession): void {
    // Capture outgoing requests
    session.on('Network.requestWillBeSent', (params: any) => {
      this.requestLog.push({
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers || {},
        postData: params.request.postData,
        resourceType: params.type || 'other',
        timestamp: Date.now(),
      });
    });

    // Capture responses (for JSON endpoint discovery)
    session.on('Network.responseReceived', (params: any) => {
      this.responseLog.push({
        url: params.response.url,
        status: params.response.status,
        headers: params.response.headers || {},
        mimeType: params.response.mimeType || '',
        bodySize: params.response.encodedDataLength || 0,
        timestamp: Date.now(),
      });
    });
  }

  // ── Query captured data ───────────────────────────────────────────

  getRequests(filter?: { urlPattern?: string; method?: string }): CapturedRequest[] {
    let results = this.requestLog;
    if (filter?.urlPattern) {
      const re = new RegExp(filter.urlPattern, 'i');
      results = results.filter(r => re.test(r.url));
    }
    if (filter?.method) {
      results = results.filter(r => r.method === filter.method);
    }
    return results;
  }

  getResponses(filter?: { urlPattern?: string; statusRange?: [number, number] }): CapturedResponse[] {
    let results = this.responseLog;
    if (filter?.urlPattern) {
      const re = new RegExp(filter.urlPattern, 'i');
      results = results.filter(r => re.test(r.url));
    }
    if (filter?.statusRange) {
      const [min, max] = filter.statusRange;
      results = results.filter(r => r.status >= min && r.status <= max);
    }
    return results;
  }

  /**
   * Discover JSON API endpoints from captured responses.
   * Looks for responses with application/json content type
   * that aren't static assets.
   */
  getApiEndpoints(): Array<{ url: string; method: string; contentType: string }> {
    const jsonResponses = this.responseLog.filter(r =>
      r.mimeType.includes('json') &&
      !r.url.includes('.json') && // skip static JSON files
      r.status >= 200 && r.status < 300
    );

    // Deduplicate by URL path (strip query params)
    const seen = new Set<string>();
    const endpoints: Array<{ url: string; method: string; contentType: string }> = [];

    for (const resp of jsonResponses) {
      const urlObj = new URL(resp.url);
      const key = `${urlObj.origin}${urlObj.pathname}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Find matching request to get the method
      const matchingReq = this.requestLog.find(r => r.url.startsWith(key));

      endpoints.push({
        url: key,
        method: matchingReq?.method || 'GET',
        contentType: resp.mimeType,
      });
    }

    return endpoints;
  }

  clearLog(): void {
    this.requestLog = [];
    this.responseLog = [];
  }
}
