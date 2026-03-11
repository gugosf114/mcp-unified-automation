import type { ContextName } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { CDPBridge } from '../cdp/cdp-bridge.js';
import { BUILTIN_PROFILES, type BlockProfile } from './block-profiles.js';

/**
 * NetworkOrchestrator — domain/type blocking, header normalization,
 * and JSON endpoint discovery.
 *
 * Uses Playwright context.route() for blocking (not CDP Fetch).
 * Uses CDPBridge's captured responses for endpoint discovery.
 */
export class NetworkOrchestrator {
  private activeProfiles: Map<ContextName, string> = new Map();
  private routeHandlers: Array<{ pattern: string; handler: (route: any) => void }> = [];

  constructor(
    private sessionManager: SessionManager,
    private cdpBridge: CDPBridge,
  ) {}

  async applyProfile(contextName: ContextName, profileName: string): Promise<void> {
    const profile = BUILTIN_PROFILES[profileName];
    if (!profile) {
      throw new Error(`Unknown block profile: ${profileName}. Available: ${Object.keys(BUILTIN_PROFILES).join(', ')}`);
    }

    const ctx = this.sessionManager.getBrowserContext();
    if (!ctx) {
      throw new Error('Browser not launched yet');
    }

    // Clear previous route handlers to prevent leaking stacked handlers
    await this.clearRoutes(ctx);

    // Apply each blocking rule via Playwright route interception
    for (const rule of profile.rules) {
      if (rule.action !== 'block') continue;

      let routePattern: string | undefined;

      if (rule.type === 'domain') {
        routePattern = `**/${rule.pattern}/**`;
      } else if (rule.type === 'url_pattern') {
        routePattern = rule.pattern;
      } else if (rule.type === 'resource_type') {
        const extMap: Record<string, string> = {
          'font': '**/*.{woff,woff2,ttf,eot,otf}',
          'image': '**/*.{png,jpg,jpeg,gif,svg,ico,webp,avif}',
          'media': '**/*.{mp4,webm,ogg,mp3,wav,flac}',
        };
        routePattern = extMap[rule.pattern];
      }

      if (routePattern) {
        const handler = (route: any) => route.abort();
        await ctx.route(routePattern, handler);
        this.routeHandlers.push({ pattern: routePattern, handler });
      }
    }

    this.activeProfiles.set(contextName, profileName);
  }

  /**
   * Discover JSON API endpoints by analyzing CDPBridge's captured responses.
   */
  async learnEndpoints(contextName: ContextName): Promise<Array<{
    url: string;
    method: string;
    contentType: string;
  }>> {
    return this.cdpBridge.getApiEndpoints();
  }

  /**
   * Remove all previously registered route handlers to prevent leaks.
   */
  private async clearRoutes(ctx: any): Promise<void> {
    for (const { pattern, handler } of this.routeHandlers) {
      try {
        await ctx.unroute(pattern, handler);
      } catch { /* handler may already be gone */ }
    }
    this.routeHandlers = [];
  }

  getActiveProfile(contextName: ContextName): string | undefined {
    return this.activeProfiles.get(contextName);
  }

  getBuiltinProfiles(): string[] {
    return Object.keys(BUILTIN_PROFILES);
  }
}
