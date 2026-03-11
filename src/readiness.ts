import type { Page } from 'playwright';

/**
 * Domain-specific readiness profiles.
 *
 * Instead of waiting for generic browser signals (networkidle, load),
 * wait for the CSS selector that actually indicates the page is usable.
 * Falls back to no extra wait if the domain has no profile.
 *
 * Add entries as you calibrate against live sites.
 */

interface ReadinessProfile {
  /** CSS selector that indicates the page is functionally ready */
  selector: string;
  /** Max ms to wait for the selector (default: 8000) */
  timeout?: number;
  /** Human-readable note for debugging */
  note?: string;
}

/**
 * Domain → readiness selector map.
 * Keys are matched via endsWith against the URL hostname,
 * so 'linkedin.com' matches 'www.linkedin.com' too.
 */
const profiles: Record<string, ReadinessProfile> = {
  'linkedin.com': {
    selector: '.scaffold-layout__main, .authentication-outlet, .search-results-container, .jobs-search-results-list',
    timeout: 10000,
    note: 'Main app shell or auth page',
  },
  'mail.google.com': {
    selector: '[role="navigation"], .aeH, .z0 .L3',
    timeout: 10000,
    note: 'Gmail nav bar or compose button area',
  },
  'search.google.com': {
    selector: '#search, #rso, .g',
    timeout: 8000,
    note: 'Search results container',
  },
  'google.com': {
    selector: 'input[name="q"], textarea[name="q"], #search, #rso',
    timeout: 5000,
    note: 'Search box or results',
  },
  'github.com': {
    selector: '[data-turbo-body], .application-main, .js-repo-root',
    timeout: 8000,
    note: 'Turbo body or main content',
  },
  'yelp.com': {
    selector: '#wrap, .main-content-wrap, .search-results',
    timeout: 8000,
    note: 'Main content wrapper',
  },
  'facebook.com': {
    selector: '[role="main"], [data-pagelet="root"]',
    timeout: 10000,
    note: 'Main feed or page root',
  },
  'instagram.com': {
    selector: 'main[role="main"], article',
    timeout: 10000,
    note: 'Main content area',
  },
};

/**
 * Find a readiness profile for a URL.
 * Returns null if no profile matches.
 */
function findProfile(url: string): ReadinessProfile | null {
  try {
    const hostname = new URL(url).hostname;
    for (const [domain, profile] of Object.entries(profiles)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return profile;
      }
    }
  } catch {
    // Invalid URL — no profile
  }
  return null;
}

/**
 * Wait for domain-specific readiness after navigation.
 *
 * @returns Object with whether a profile matched and if the selector was found.
 *          Never throws — readiness is best-effort enhancement.
 */
export async function waitForReadiness(
  page: Page,
  url: string,
): Promise<{ profileMatched: boolean; selectorFound: boolean; domain?: string }> {
  const profile = findProfile(url);
  if (!profile) {
    return { profileMatched: false, selectorFound: false };
  }

  const domain = new URL(url).hostname;
  try {
    await page.waitForSelector(profile.selector, {
      state: 'attached',
      timeout: profile.timeout ?? 8000,
    });
    return { profileMatched: true, selectorFound: true, domain };
  } catch {
    // Selector didn't appear within timeout — page may still be usable
    return { profileMatched: true, selectorFound: false, domain };
  }
}

/**
 * Check if a URL has a readiness profile registered.
 */
export function hasReadinessProfile(url: string): boolean {
  return findProfile(url) !== null;
}
