import type { ToolResult, ContextName } from '../types/common.js';
import type { TaskSpec, TaskStatus, StepContext } from '../types/task.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ActionExecutor } from '../action/action-executor.js';
import type { CheckpointStore, Checkpoint } from '../checkpoint/checkpoint-store.js';
import type { EvidenceLedger } from '../evidence/evidence-ledger.js';
import type { PolicyGate } from '../policy/policy-gate.js';
import type { RecoveryDaemon } from '../recovery/recovery-daemon.js';
import type { MetricsEngine, StepMetric } from '../metrics/metrics-engine.js';
import type { StepRegistry } from './step-registry.js';
import { createHash } from 'crypto';

/**
 * TaskRunner — per-task state machine.
 *
 * Lifecycle: created → running → (paused | awaiting_approval | completed | failed)
 *
 * The runner iterates: for each entity × for each step.
 * It checkpoints after every step, records evidence, checks policy gates,
 * and runs recovery detection. If an approval gate is hit, it returns
 * immediately with status "pending_approval" — the MCP client must call
 * task.commit(taskId) to resume.
 */
export class TaskRunner {
  readonly taskId: string;
  private spec: TaskSpec;
  private _status: TaskStatus = 'created';
  private currentEntityIndex: number = 0;
  private currentStepIndex: number = 0;
  private entities: Record<string, any>[] = [];
  private formState: Record<string, string> = {};
  private processedKeys: string[] = [];
  private pauseRequested: boolean = false;

  constructor(
    spec: TaskSpec,
    private sessionManager: SessionManager,
    private actionExecutor: ActionExecutor,
    private checkpointStore: CheckpointStore,
    private evidenceLedger: EvidenceLedger,
    private policyGate: PolicyGate,
    private recoveryDaemon: RecoveryDaemon,
    private metricsEngine: MetricsEngine,
    private stepRegistry: StepRegistry,
  ) {
    this.spec = spec;
    this.taskId = spec.taskId;
  }

  get status(): TaskStatus { return this._status; }

  getStatus() {
    return {
      taskId: this.taskId,
      status: this._status,
      entityIndex: this.currentEntityIndex,
      stepIndex: this.currentStepIndex,
      totalEntities: this.entities.length,
      totalSteps: this.spec.steps.length,
    };
  }

  // ── Main execution ────────────────────────────────────────────────

  async run(): Promise<ToolResult> {
    this._status = 'running';

    // Open/warm the named session
    await this.sessionManager.open(this.spec.context);

    // Resolve entities
    this.entities = this.resolveEntities();
    if (this.entities.length === 0) {
      this._status = 'completed';
      return {
        status: 'success',
        taskId: this.taskId,
        data: { message: 'No entities to process', status: 'completed' },
      };
    }

    return this.executeLoop();
  }

  async resume(): Promise<ToolResult> {
    const checkpoint = await this.checkpointStore.load(this.taskId);
    if (!checkpoint) {
      return {
        status: 'error',
        taskId: this.taskId,
        error: `No checkpoint found for task ${this.taskId}`,
      };
    }

    // Restore state from checkpoint
    this.currentEntityIndex = checkpoint.entityIndex;
    this.currentStepIndex = checkpoint.stepIndex + 1; // resume AFTER the checkpointed step
    this.formState = checkpoint.formState;
    this.processedKeys = checkpoint.processedEntities;
    this._status = 'running';

    await this.sessionManager.open(this.spec.context);
    this.entities = this.resolveEntities();

    return this.executeLoop();
  }

  async pause(): Promise<ToolResult> {
    this.pauseRequested = true;
    return {
      status: 'success',
      taskId: this.taskId,
      data: { message: 'Pause requested, will take effect after current step' },
    };
  }

  cancel(): void {
    this._status = 'cancelled';
    this.pauseRequested = true;
  }

  async onApproval(): Promise<ToolResult> {
    if (this._status !== 'awaiting_approval') {
      return {
        status: 'error',
        taskId: this.taskId,
        error: `Task is ${this._status}, not awaiting_approval`,
      };
    }

    // Advance past the approval gate step
    this.currentStepIndex++;
    this._status = 'running';

    return this.executeLoop();
  }

  // ── Core loop ─────────────────────────────────────────────────────

  private async executeLoop(): Promise<ToolResult> {
    const results: any[] = [];

    for (let ei = this.currentEntityIndex; ei < this.entities.length; ei++) {
      this.currentEntityIndex = ei;
      const entity = this.entities[ei];

      // Idempotency check
      const idemKey = this.computeIdempotencyKey(entity);
      if (idemKey && this.processedKeys.includes(idemKey)) {
        continue; // skip already-processed entity
      }

      for (let si = this.currentStepIndex; si < this.spec.steps.length; si++) {
        this.currentStepIndex = si;
        const stepName = this.spec.steps[si];

        // Check pause request
        if (this.pauseRequested) {
          this.pauseRequested = false;
          this._status = 'paused';
          await this.saveCheckpoint();
          return {
            status: 'partial',
            taskId: this.taskId,
            data: { message: 'Task paused', ...this.getStatus() },
          };
        }

        // Recovery check (detect stalls/captcha/etc.)
        try {
          await this.recoveryDaemon.checkAndRecover(this.spec.context);
        } catch { /* recovery is best-effort */ }

        // Policy gate check
        if (this.policyGate.requiresApproval(stepName)) {
          this._status = 'awaiting_approval';
          const page = await this.sessionManager.getPage(this.spec.context);
          const approval = await this.policyGate.requestApproval(
            this.taskId, si, stepName, this.evidenceLedger, page
          );

          await this.saveCheckpoint();

          return {
            status: 'pending_approval',
            taskId: this.taskId,
            stepIndex: si,
            data: { ...this.getStatus(), approval },
            approvalRequired: {
              action: stepName,
              description: approval.description,
              snapshotPath: approval.snapshotPath,
            },
          };
        }

        // Execute the step
        const stepResult = await this.executeStep(entity, stepName, si);
        results.push({ entity: ei, step: stepName, result: stepResult });

        if (stepResult.status === 'error') {
          await this.handleError(stepName, si, entity);
          // If onError includes checkpoint_and_continue, keep going
          if (this.spec.onError.includes('checkpoint_and_continue')) {
            continue;
          } else {
            this._status = 'failed';
            return {
              status: 'error',
              taskId: this.taskId,
              error: `Step "${stepName}" failed: ${stepResult.error}`,
              data: { ...this.getStatus(), results },
            };
          }
        }

        // Merge form state if step returned updates
        if (stepResult.formState) {
          this.formState = { ...this.formState, ...stepResult.formState };
        }

        // Checkpoint after each successful step
        await this.saveCheckpoint();
      }

      // All steps done for this entity — mark processed
      if (idemKey) {
        this.processedKeys.push(idemKey);
        await this.checkpointStore.markProcessed(this.taskId, idemKey);
      }

      // Reset step index for next entity
      this.currentStepIndex = 0;
      this.formState = {};
    }

    this._status = 'completed';
    const finalCheckpointDir = this.checkpointStore.getBaseDir();
    const finalEvidenceDir = this.evidenceLedger.getBaseDir();

    return {
      status: 'success',
      taskId: this.taskId,
      data: {
        message: 'Task completed',
        ...this.getStatus(),
        processedCount: this.processedKeys.length,
        artifactPaths: {
          checkpoints: finalCheckpointDir,
          evidence: finalEvidenceDir,
        },
        results,
      },
    };
  }

  // ── Step execution ────────────────────────────────────────────────

  private async executeStep(
    entity: Record<string, any>,
    stepName: string,
    stepIndex: number,
  ): Promise<{ status: 'success' | 'error' | 'skip'; data?: any; error?: string; formState?: Record<string, string> }> {
    const stepFn = this.stepRegistry.get(stepName);
    if (!stepFn) {
      return { status: 'error', error: `Unknown step: ${stepName}` };
    }

    const ctx: StepContext = {
      contextName: this.spec.context,
      entity,
      entityIndex: this.currentEntityIndex,
      formState: this.formState,
      taskSpec: this.spec,
      taskId: this.taskId,
    };

    const metricStart = Date.now();
    let retryCount = 0;

    try {
      const result = await stepFn(ctx, this.actionExecutor, this.sessionManager);

      // Record evidence for each step
      await this.evidenceLedger.recordAction(this.taskId, stepIndex, stepName, {
        status: result.status,
        entityIndex: this.currentEntityIndex,
        data: result.data,
      });

      // Record metrics
      const metric: StepMetric = {
        taskId: this.taskId,
        stepIndex,
        stepName,
        startedAt: metricStart,
        completedAt: Date.now(),
        duration_ms: Date.now() - metricStart,
        status: result.status === 'skip' ? 'skipped' : result.status,
        retryCount,
        manualIntervention: false,
      };
      await this.metricsEngine.recordStep(metric);

      return result;
    } catch (error: any) {
      const metric: StepMetric = {
        taskId: this.taskId,
        stepIndex,
        stepName,
        startedAt: metricStart,
        completedAt: Date.now(),
        duration_ms: Date.now() - metricStart,
        status: 'error',
        retryCount,
        manualIntervention: false,
      };
      await this.metricsEngine.recordStep(metric);

      return { status: 'error', error: error.message };
    }
  }

  // ── Error handling ────────────────────────────────────────────────

  private async handleError(stepName: string, stepIndex: number, entity: Record<string, any>): Promise<void> {
    for (const handler of this.spec.onError) {
      try {
        if (handler === 'screenshot') {
          const page = await this.sessionManager.getPage(this.spec.context);
          await this.evidenceLedger.captureScreenshot(this.taskId, stepIndex, `error_${stepName}`, page);
        } else if (handler === 'dom_dump') {
          const page = await this.sessionManager.getPage(this.spec.context);
          await this.evidenceLedger.captureDomSnapshot(this.taskId, stepIndex, `error_${stepName}`, page);
        } else if (handler === 'checkpoint_and_continue') {
          await this.saveCheckpoint();
        }
      } catch { /* error handlers are best-effort */ }
    }
  }

  // ── Checkpoint ────────────────────────────────────────────────────

  private async saveCheckpoint(): Promise<void> {
    let pageUrl = 'unknown';
    try {
      const page = await this.sessionManager.getPage(this.spec.context);
      pageUrl = page.url();
    } catch { /* best-effort */ }

    const checkpoint: Checkpoint = {
      taskId: this.taskId,
      stepIndex: this.currentStepIndex,
      stepName: this.spec.steps[this.currentStepIndex] || 'unknown',
      entityIndex: this.currentEntityIndex,
      timestamp: Date.now(),
      contextName: this.spec.context,
      pageUrl,
      formState: this.formState,
      processedEntities: this.processedKeys,
      cookiesHash: await this.computeCookiesHash(),
      customData: { spec: this.spec },
    };

    await this.checkpointStore.save(checkpoint);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private resolveEntities(): Record<string, any>[] {
    if (this.spec.entities.source === 'provided' && this.spec.entities.items) {
      const items = this.spec.entities.items;
      return this.spec.entities.limit ? items.slice(0, this.spec.entities.limit) : items;
    }
    // For other sources, return a single placeholder entity.
    // Domain-specific step implementations will discover entities at runtime.
    return [{ source: this.spec.entities.source, index: 0 }];
  }

  private computeIdempotencyKey(entity: Record<string, any>): string | null {
    if (!this.spec.idempotency?.key) return null;

    let key = this.spec.idempotency.key;
    // Replace {{field}} placeholders with entity values
    key = key.replace(/\{\{(\w+)\}\}/g, (_match, field) => {
      return String(entity[field] || 'unknown');
    });
    return key;
  }

  private async computeCookiesHash(): Promise<string> {
    try {
      const ctx = this.sessionManager.getBrowserContext();
      if (!ctx) return 'no-context';
      const cookies = await ctx.cookies();
      const cookieStr = JSON.stringify(cookies.map(c => `${c.name}=${c.domain}`).sort());
      return createHash('sha256').update(cookieStr).digest('hex').slice(0, 16);
    } catch {
      return 'unknown';
    }
  }
}
