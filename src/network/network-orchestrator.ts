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

    // Apply each blocking rule via Playwright route interception
    for (const rule of profile.rules) {
      if (rule.action !== 'block') continue;

      if (rule.type === 'domain') {
        await ctx.route(`**/${rule.pattern}/**`, route => route.abort());
      } else if (rule.type === 'url_pattern') {
        await ctx.route(rule.pattern, route => route.abort());
      } else if (rule.type === 'resource_type') {
        // Resource type blocking uses a broader pattern
        // and filters by resource type in the handler
        // Note: Playwright routes don't directly filter by resource type
        // at the route level, so we use known file extensions
        const extMap: Record<string, string> = {
          'font': '**/*.{woff,woff2,ttf,eot,otf}',
          'image': '**/*.{png,jpg,jpeg,gif,svg,ico,webp,avif}',
          'media': '**/*.{mp4,webm,ogg,mp3,wav,flac}',
        };
        const pattern = extMap[rule.pattern];
        if (pattern) {
          await ctx.route(pattern, route => route.abort());
        }
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

  getActiveProfile(contextName: ContextName): string | undefined {
    return this.activeProfiles.get(contextName);
  }

  getBuiltinProfiles(): string[] {
    return Object.keys(BUILTIN_PROFILES);
  }
}
