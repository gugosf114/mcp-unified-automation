import { hasReadinessProfile } from '../src/readiness';

describe('Readiness profiles', () => {
  // ── Profile matching ─────────────────────────────────────────────

  test.each([
    ['https://www.linkedin.com/jobs', 'linkedin.com'],
    ['https://linkedin.com/in/someone', 'linkedin.com'],
    ['https://mail.google.com/mail/u/0/', 'mail.google.com'],
    ['https://www.google.com/search?q=test', 'google.com'],
    ['https://search.google.com/search-console', 'search.google.com'],
    ['https://github.com/some/repo', 'github.com'],
    ['https://www.yelp.com/biz/something', 'yelp.com'],
    ['https://www.facebook.com/page', 'facebook.com'],
    ['https://www.instagram.com/profile', 'instagram.com'],
  ])('has profile for %s (%s)', (url) => {
    expect(hasReadinessProfile(url)).toBe(true);
  });

  test.each([
    ['https://example.com', 'no profile'],
    ['https://reddit.com/r/all', 'no profile'],
    ['https://stackoverflow.com/questions', 'no profile'],
    // Note: docs.google.com DOES match google.com profile (endsWith check)
  ])('no profile for %s (%s)', (url) => {
    expect(hasReadinessProfile(url)).toBe(false);
  });

  // ── Edge cases ───────────────────────────────────────────────────

  test('returns false for invalid URL', () => {
    expect(hasReadinessProfile('not-a-url')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(hasReadinessProfile('')).toBe(false);
  });

  test('subdomain matching works (www.linkedin.com → linkedin.com)', () => {
    expect(hasReadinessProfile('https://www.linkedin.com')).toBe(true);
  });

  test('exact domain matches (linkedin.com without www)', () => {
    expect(hasReadinessProfile('https://linkedin.com')).toBe(true);
  });

  test('does not match partial domain names', () => {
    // "notlinkedin.com" should NOT match "linkedin.com"
    expect(hasReadinessProfile('https://notlinkedin.com')).toBe(false);
  });
});
