import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface StepMetric {
  taskId: string;
  stepIndex: number;
  stepName: string;
  startedAt: number;
  completedAt: number;
  duration_ms: number;
  status: 'success' | 'error' | 'retry' | 'skipped';
  retryCount: number;
  manualIntervention: boolean;
}

export interface MetricsReport {
  window: { from: number; to: number };
  totalSteps: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  manualInterventionCount: number;
  avgStepDuration_ms: number;
  p95StepDuration_ms: number;
  successRate: number;
  taskBreakdown: Record<string, {
    steps: number;
    successes: number;
    errors: number;
    avgDuration_ms: number;
  }>;
}

/**
 * MetricsEngine — NDJSON append-only step metrics with aggregation.
 *
 * Each step execution appends one line to data/metrics/metrics.ndjson.
 * The report() method reads and aggregates over a time window.
 */
export class MetricsEngine {
  private logFile: string;

  constructor(baseDir?: string) {
    const dir = baseDir || join(process.cwd(), 'data', 'metrics');
    mkdirSync(dir, { recursive: true });
    this.logFile = join(dir, 'metrics.ndjson');
  }

  async recordStep(metric: StepMetric): Promise<void> {
    const line = JSON.stringify(metric) + '\n';
    appendFileSync(this.logFile, line, 'utf-8');
  }

  async report(windowMs?: number): Promise<MetricsReport> {
    const now = Date.now();
    const from = windowMs ? now - windowMs : 0;
    const metrics = this.readMetrics(from, now);
    return this.aggregate(metrics, from, now);
  }

  async reportForTask(taskId: string): Promise<MetricsReport> {
    const allMetrics = this.readMetrics(0, Date.now());
    const filtered = allMetrics.filter(m => m.taskId === taskId);
    const from = filtered.length > 0 ? Math.min(...filtered.map(m => m.startedAt)) : 0;
    const to = filtered.length > 0 ? Math.max(...filtered.map(m => m.completedAt)) : Date.now();
    return this.aggregate(filtered, from, to);
  }

  private readMetrics(from: number, to: number): StepMetric[] {
    if (!existsSync(this.logFile)) return [];

    const content = readFileSync(this.logFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const metrics: StepMetric[] = [];

    for (const line of lines) {
      try {
        const m: StepMetric = JSON.parse(line);
        if (m.startedAt >= from && m.startedAt <= to) {
          metrics.push(m);
        }
      } catch {
        // skip malformed lines
      }
    }

    return metrics;
  }

  private aggregate(metrics: StepMetric[], from: number, to: number): MetricsReport {
    if (metrics.length === 0) {
      return {
        window: { from, to },
        totalSteps: 0,
        successCount: 0,
        errorCount: 0,
        retryCount: 0,
        manualInterventionCount: 0,
        avgStepDuration_ms: 0,
        p95StepDuration_ms: 0,
        successRate: 0,
        taskBreakdown: {},
      };
    }

    const successes = metrics.filter(m => m.status === 'success').length;
    const errors = metrics.filter(m => m.status === 'error').length;
    const retries = metrics.reduce((sum, m) => sum + m.retryCount, 0);
    const interventions = metrics.filter(m => m.manualIntervention).length;
    const durations = metrics.map(m => m.duration_ms).sort((a, b) => a - b);
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const p95Index = Math.floor(durations.length * 0.95);
    const p95 = durations[Math.min(p95Index, durations.length - 1)];

    // Per-task breakdown
    const taskBreakdown: MetricsReport['taskBreakdown'] = {};
    for (const m of metrics) {
      if (!taskBreakdown[m.taskId]) {
        taskBreakdown[m.taskId] = { steps: 0, successes: 0, errors: 0, avgDuration_ms: 0 };
      }
      const t = taskBreakdown[m.taskId];
      t.steps++;
      if (m.status === 'success') t.successes++;
      if (m.status === 'error') t.errors++;
      t.avgDuration_ms += m.duration_ms;
    }
    for (const t of Object.values(taskBreakdown)) {
      t.avgDuration_ms = Math.round(t.avgDuration_ms / t.steps);
    }

    return {
      window: { from, to },
      totalSteps: metrics.length,
      successCount: successes,
      errorCount: errors,
      retryCount: retries,
      manualInterventionCount: interventions,
      avgStepDuration_ms: Math.round(avg),
      p95StepDuration_ms: p95,
      successRate: Math.round((successes / metrics.length) * 1000) / 1000,
      taskBreakdown,
    };
  }
}
