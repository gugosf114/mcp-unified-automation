import type { ApprovalRequest } from '../types/task.js';
import type { EvidenceLedger } from '../evidence/evidence-ledger.js';
import type { Page } from 'playwright';

export interface PolicyRule {
  pattern: string;      // regex matched against step name
  action: 'require_approval' | 'require_evidence' | 'allow';
  description: string;
}

// Word-boundary (\b) anchors prevent substring false-positives:
//   "pre_submit_snapshot" does NOT match \bsubmit\b because _ is a \w char.
//   "submit" alone DOES match because start/end are word boundaries.
const DEFAULT_RULES: PolicyRule[] = [
  { pattern: '\\bsubmit\\b',                 action: 'require_approval', description: 'Form submission' },
  { pattern: '\\bsend\\b',                   action: 'require_approval', description: 'Message sending' },
  { pattern: '\\bapply\\b',                  action: 'require_approval', description: 'Application submission' },
  { pattern: '\\bdispute\\b',                action: 'require_approval', description: 'Dispute filing' },
  { pattern: '\\b(?:payment|pay|purchase)\\b', action: 'require_approval', description: 'Financial action' },
  { pattern: '\\b(?:delete|remove)\\b',      action: 'require_approval', description: 'Destructive action' },
  { pattern: '\\bapproval_gate\\b',          action: 'require_approval', description: 'Explicit approval checkpoint' },
];

/**
 * PolicyGate — rule engine for "needs human confirmation" actions.
 *
 * Before executing gated steps, the task runner calls requiresApproval().
 * If true, it calls requestApproval() which captures a pre-action screenshot
 * and creates a pending approval. The task pauses until task.commit() is called.
 */
export class PolicyGate {
  private rules: PolicyRule[];
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

  constructor(rules?: PolicyRule[]) {
    this.rules = rules || DEFAULT_RULES;
  }

  requiresApproval(stepName: string): boolean {
    return this.rules.some(rule =>
      rule.action === 'require_approval' && new RegExp(rule.pattern, 'i').test(stepName)
    );
  }

  getMatchingRule(stepName: string): PolicyRule | undefined {
    return this.rules.find(rule =>
      rule.action === 'require_approval' && new RegExp(rule.pattern, 'i').test(stepName)
    );
  }

  async requestApproval(
    taskId: string,
    stepIndex: number,
    stepName: string,
    evidenceLedger: EvidenceLedger,
    page: Page,
  ): Promise<ApprovalRequest> {
    // Capture pre-action evidence
    const evidence = await evidenceLedger.captureScreenshot(taskId, stepIndex, stepName, page);
    const rule = this.getMatchingRule(stepName);

    const request: ApprovalRequest = {
      taskId,
      stepIndex,
      stepName,
      action: stepName,
      description: rule?.description || `Step "${stepName}" requires approval`,
      snapshotPath: evidence.artifactPath,
      timestamp: Date.now(),
      status: 'pending',
    };

    this.pendingApprovals.set(taskId, request);
    return request;
  }

  approve(taskId: string): ApprovalRequest | null {
    const request = this.pendingApprovals.get(taskId);
    if (!request || request.status !== 'pending') return null;
    request.status = 'approved';
    this.pendingApprovals.delete(taskId);
    return request;
  }

  reject(taskId: string): ApprovalRequest | null {
    const request = this.pendingApprovals.get(taskId);
    if (!request || request.status !== 'pending') return null;
    request.status = 'rejected';
    this.pendingApprovals.delete(taskId);
    return request;
  }

  getPending(taskId: string): ApprovalRequest | null {
    return this.pendingApprovals.get(taskId) || null;
  }

  listPending(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values());
  }
}
