import type { ToolResult } from '../types/common.js';
import type { SessionManager } from '../session/session-manager.js';
import type { ActionExecutor } from '../action/action-executor.js';
import type { CheckpointStore } from '../checkpoint/checkpoint-store.js';
import type { EvidenceLedger } from '../evidence/evidence-ledger.js';
import type { PolicyGate } from '../policy/policy-gate.js';
import type { RecoveryDaemon } from '../recovery/recovery-daemon.js';
import type { MetricsEngine } from '../metrics/metrics-engine.js';
import type { StepRegistry } from './step-registry.js';
import { parseTaskSpec } from './dsl-parser.js';
import { TaskRunner } from './task-runner.js';

/**
 * TaskEngine — top-level lifecycle manager for tasks.
 *
 * Maintains a Map of active TaskRunners keyed by taskId.
 * MCP tools delegate to this: task.plan, task.run, task.resume,
 * task.pause, task.commit.
 */
export class TaskEngine {
  private runners: Map<string, TaskRunner> = new Map();

  constructor(
    private sessionManager: SessionManager,
    private actionExecutor: ActionExecutor,
    private checkpointStore: CheckpointStore,
    private evidenceLedger: EvidenceLedger,
    private policyGate: PolicyGate,
    private recoveryDaemon: RecoveryDaemon,
    private metricsEngine: MetricsEngine,
    private stepRegistry: StepRegistry,
  ) {}

  /**
   * Parse and validate a task spec without executing.
   * Returns the parsed spec so Claude can review it before calling run().
   */
  async plan(specString: string): Promise<ToolResult> {
    try {
      const spec = parseTaskSpec(specString);

      // Validate that all steps are registered
      const unknownSteps = spec.steps.filter(s => !this.stepRegistry.has(s));
      const unknownErrorHandlers = spec.onError.filter(s => !this.stepRegistry.has(s));

      return {
        status: 'success',
        data: {
          spec,
          validation: {
            stepsFound: spec.steps.filter(s => this.stepRegistry.has(s)),
            unknownSteps,
            unknownErrorHandlers,
            registeredSteps: this.stepRegistry.listSteps(),
          },
        },
      };
    } catch (error: any) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Create a TaskRunner and start execution.
   * Returns immediately if an approval gate is hit.
   */
  async run(specString: string): Promise<ToolResult> {
    try {
      const spec = parseTaskSpec(specString);

      // Don't allow duplicate taskIds
      if (this.runners.has(spec.taskId)) {
        const existing = this.runners.get(spec.taskId)!;
        return {
          status: 'error',
          taskId: spec.taskId,
          error: `Task ${spec.taskId} already exists with status: ${existing.status}`,
        };
      }

      const runner = new TaskRunner(
        spec,
        this.sessionManager,
        this.actionExecutor,
        this.checkpointStore,
        this.evidenceLedger,
        this.policyGate,
        this.recoveryDaemon,
        this.metricsEngine,
        this.stepRegistry,
      );

      this.runners.set(spec.taskId, runner);
      return runner.run();
    } catch (error: any) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Resume a task from its last checkpoint.
   */
  async resume(taskId: string): Promise<ToolResult> {
    try {
      // Check if runner still exists in memory
      let runner = this.runners.get(taskId);

      if (!runner) {
        // Recreate runner from checkpoint (server may have crashed/restarted)
        const checkpoint = await this.checkpointStore.load(taskId);
        if (!checkpoint) {
          return { status: 'error', taskId, error: `No checkpoint found for task ${taskId}` };
        }

        const spec = checkpoint.customData?.spec;
        if (!spec) {
          return {
            status: 'error',
            taskId,
            error: 'Checkpoint exists but does not contain the task spec. Cannot reconstruct.',
          };
        }

        runner = new TaskRunner(
          spec,
          this.sessionManager,
          this.actionExecutor,
          this.checkpointStore,
          this.evidenceLedger,
          this.policyGate,
          this.recoveryDaemon,
          this.metricsEngine,
          this.stepRegistry,
        );
        this.runners.set(taskId, runner);
      }

      return runner.resume();
    } catch (error: any) {
      return { status: 'error', taskId, error: error.message };
    }
  }

  /**
   * Pause a running task. Takes effect after the current step completes.
   */
  async pause(taskId: string): Promise<ToolResult> {
    const runner = this.runners.get(taskId);
    if (!runner) {
      return { status: 'error', taskId, error: `No active task ${taskId}` };
    }
    return runner.pause();
  }

  /**
   * Approve a pending approval gate and continue execution.
   * This is the "human commit" — requires explicit invocation.
   */
  async commit(taskId: string): Promise<ToolResult> {
    const runner = this.runners.get(taskId);
    if (!runner) {
      return { status: 'error', taskId, error: `No active task ${taskId}` };
    }

    if (runner.status !== 'awaiting_approval') {
      return {
        status: 'error',
        taskId,
        error: `Task is ${runner.status}, not awaiting_approval`,
      };
    }

    // Approve in policy gate
    const approval = this.policyGate.approve(taskId);
    if (!approval) {
      return { status: 'error', taskId, error: 'No pending approval found' };
    }

    // Resume the runner
    return runner.onApproval();
  }

  /**
   * Get status of a task.
   */
  getStatus(taskId: string): ToolResult {
    const runner = this.runners.get(taskId);
    if (!runner) {
      return { status: 'error', taskId, error: `No active task ${taskId}` };
    }
    return { status: 'success', taskId, data: runner.getStatus() };
  }

  /**
   * List all active tasks with their current status.
   */
  listTasks(): Array<{ taskId: string; status: string; [key: string]: any }> {
    const tasks: Array<{ taskId: string; status: string; [key: string]: any }> = [];
    for (const [_taskId, runner] of this.runners) {
      tasks.push(runner.getStatus());
    }
    return tasks;
  }

  /**
   * Cancel a task and remove from active runners.
   */
  cancel(taskId: string): ToolResult {
    const runner = this.runners.get(taskId);
    if (!runner) {
      return { status: 'error', taskId, error: `No active task ${taskId}` };
    }
    runner.cancel();
    this.runners.delete(taskId);
    return { status: 'success', taskId, data: { message: `Task ${taskId} cancelled` } };
  }
}
