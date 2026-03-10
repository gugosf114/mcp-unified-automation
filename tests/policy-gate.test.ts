import { PolicyGate } from '../src/policy/policy-gate';

describe('PolicyGate', () => {
  let gate: PolicyGate;

  beforeEach(() => {
    gate = new PolicyGate();
  });

  // ── requiresApproval: positive matches ──────────────────────────

  // \b treats _ as a word character (\w = [a-zA-Z0-9_]).
  // So "submit" matches \bsubmit\b, but "submit_application" does NOT
  // because _ connects them into one "word". This is intentional —
  // compound step names like "pre_submit_snapshot" must not trigger approval.

  test.each([
    ['submit', 'exact match'],
    ['Submit', 'case insensitive'],
    ['send', 'send action'],
    ['apply', 'apply action'],
    ['delete', 'delete action'],
    ['remove', 'remove action'],
    ['payment', 'payment action'],
    ['pay', 'pay action'],
    ['purchase', 'purchase action'],
    ['approval_gate', 'explicit gate checkpoint'],
  ])('requires approval for "%s" (%s)', (stepName) => {
    expect(gate.requiresApproval(stepName)).toBe(true);
  });

  // ── requiresApproval: negative matches (word boundary prevents false positives) ──
  // _ is a \w char, so compound names with underscore do NOT match \bword\b.
  // This prevents "pre_submit_snapshot" from triggering the "submit" gate.

  test.each([
    ['submit_application', 'underscore connects into one word — no \\b match'],
    ['final_submit', 'underscore connects — no match'],
    ['send_message', 'underscore connects — no match'],
    ['apply_now', 'underscore connects — no match'],
    ['pre_submit_snapshot', 'compound step — no match'],
    ['navigate', 'unrelated step'],
    ['click_button', 'generic action'],
    ['fill_form', 'fill is not gated'],
    ['screenshot', 'read-only action'],
    ['resubmit', 'submit substring but no word boundary'],
    ['disapprove', 'approve substring but no word boundary'],
  ])('does NOT require approval for "%s" (%s)', (stepName) => {
    expect(gate.requiresApproval(stepName)).toBe(false);
  });

  // ── getMatchingRule ─────────────────────────────────────────────

  test('returns matching rule with description', () => {
    const rule = gate.getMatchingRule('submit');
    expect(rule).toBeDefined();
    expect(rule!.action).toBe('require_approval');
    expect(rule!.description).toBe('Form submission');
  });

  test('returns undefined for non-matching step', () => {
    expect(gate.getMatchingRule('navigate')).toBeUndefined();
  });

  // ── Approval lifecycle ──────────────────────────────────────────

  test('approve returns null when no pending request', () => {
    expect(gate.approve('nonexistent-task')).toBeNull();
  });

  test('reject returns null when no pending request', () => {
    expect(gate.reject('nonexistent-task')).toBeNull();
  });

  test('listPending returns empty array initially', () => {
    expect(gate.listPending()).toEqual([]);
  });

  test('getPending returns null for unknown task', () => {
    expect(gate.getPending('unknown')).toBeNull();
  });

  // ── Custom rules ────────────────────────────────────────────────

  test('accepts custom rules in constructor', () => {
    const custom = new PolicyGate([
      { pattern: '\\bdeploy\\b', action: 'require_approval', description: 'Deployment' },
    ]);
    expect(custom.requiresApproval('deploy')).toBe(true);
    expect(custom.requiresApproval('submit')).toBe(false); // default rules not loaded
  });
});
