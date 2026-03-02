import type { ContextName, ToolResult } from './common.js';
import type { ActionExecutor } from '../action/action-executor.js';
import type { SessionManager } from '../session/session-manager.js';

// ── Task DSL specification ──────────────────────────────────────────

export interface TaskSpec {
  taskId: string;
  context: ContextName;
  mode: 'auto' | 'semi_auto' | 'manual';
  entities: {
    source: string;        // e.g., "saved_jobs", "provided" (inline list)
    items?: any[];         // inline entity list (when source === "provided")
    limit?: number;
  };
  steps: string[];
  idempotency?: {
    key: string;           // template: "{{jobId}}:{{profileHash}}"
  };
  onError: string[];       // e.g., ["screenshot", "dom_dump", "checkpoint_and_continue"]
}

// ── Task execution types ────────────────────────────────────────────

export type TaskStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StepContext {
  contextName: ContextName;
  entity: Record<string, any>;
  entityIndex: number;
  formState: Record<string, string>;
  taskSpec: TaskSpec;
  taskId: string;
}

export interface StepResult {
  status: 'success' | 'error' | 'skip';
  formState?: Record<string, string>;
  data?: any;
  error?: string;
}

export type StepFunction = (
  ctx: StepContext,
  executor: ActionExecutor,
  sessionManager: SessionManager,
) => Promise<StepResult>;

// ── Approval types ──────────────────────────────────────────────────

export interface ApprovalRequest {
  taskId: string;
  stepIndex: number;
  stepName: string;
  action: string;
  description: string;
  snapshotPath?: string;
  timestamp: number;
  status: 'pending' | 'approved' | 'rejected';
}
