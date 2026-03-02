import type { Page } from 'playwright';

// Extended from original ToolResult — adds task-aware fields
export interface ToolResult {
  status: "success" | "error" | "partial" | "pending_approval";
  data?: any;
  error?: string;
  details?: string;
  duration_ms?: number;
  taskId?: string;
  stepIndex?: number;
  approvalRequired?: {
    action: string;
    description: string;
    snapshotPath?: string;
  };
}

// Named session label — logical grouping within single persistent context
export type ContextName = string;

// One labeled page within the persistent BrowserContext
export interface PageHandle {
  contextName: ContextName;
  page: Page;
  createdAt: number;
  lastUsedAt: number;
  homeUrl?: string;  // warm URL for this context (e.g., https://www.linkedin.com)
}

// Helper: wrap any async op into a ToolResult with timing
export async function withTiming<T>(
  fn: () => Promise<T>,
  extract: (value: T) => Partial<ToolResult> = () => ({})
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const value = await fn();
    return {
      status: "success",
      duration_ms: Date.now() - start,
      ...extract(value),
    };
  } catch (error: any) {
    return {
      status: "error",
      error: error.message,
      duration_ms: Date.now() - start,
    };
  }
}
