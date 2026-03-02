export interface BlockRule {
  type: 'domain' | 'url_pattern' | 'resource_type';
  pattern: string;
  action: 'block' | 'allow';
}

export interface BlockProfile {
  name: string;
  rules: BlockRule[];
}

/**
 * Built-in network blocking profiles.
 *
 * These are applied via Playwright's context.route() — not CDP Fetch —
 * for reliability and simplicity.
 */
export const BUILTIN_PROFILES: Record<string, BlockProfile> = {
  none: {
    name: 'none',
    rules: [],
  },

  minimal: {
    name: 'minimal',
    rules: [
      { type: 'domain', pattern: '*google-analytics*',  action: 'block' },
      { type: 'domain', pattern: '*googletagmanager*',   action: 'block' },
      { type: 'domain', pattern: '*facebook*',           action: 'block' },
      { type: 'domain', pattern: '*doubleclick*',        action: 'block' },
      { type: 'domain', pattern: '*hotjar*',             action: 'block' },
      { type: 'resource_type', pattern: 'font',          action: 'block' },
    ],
  },

  aggressive: {
    name: 'aggressive',
    rules: [
      // All of minimal
      { type: 'domain', pattern: '*google-analytics*',  action: 'block' },
      { type: 'domain', pattern: '*googletagmanager*',   action: 'block' },
      { type: 'domain', pattern: '*facebook*',           action: 'block' },
      { type: 'domain', pattern: '*doubleclick*',        action: 'block' },
      { type: 'domain', pattern: '*hotjar*',             action: 'block' },
      { type: 'resource_type', pattern: 'font',          action: 'block' },
      // Plus images, media, chat widgets
      { type: 'resource_type', pattern: 'image',         action: 'block' },
      { type: 'resource_type', pattern: 'media',         action: 'block' },
      { type: 'domain', pattern: '*intercom*',           action: 'block' },
      { type: 'domain', pattern: '*drift*',              action: 'block' },
      { type: 'domain', pattern: '*zendesk*',            action: 'block' },
      { type: 'domain', pattern: '*crisp*',              action: 'block' },
      { type: 'domain', pattern: '*optimizely*',         action: 'block' },
      { type: 'domain', pattern: '*segment*',            action: 'block' },
    ],
  },
};
