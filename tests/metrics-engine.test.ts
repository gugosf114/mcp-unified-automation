import { MetricsEngine, type StepMetric } from '../src/metrics/metrics-engine';
import { mkdtempSync, rmSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MetricsEngine', () => {
  let engine: MetricsEngine;
  let tempDir: string;

  function makeMetric(overrides?: Partial<StepMetric>): StepMetric {
    const now = Date.now();
    return {
      taskId: 'task-1',
      stepIndex: 0,
      stepName: 'navigate',
      startedAt: now,
      completedAt: now + 100,
      duration_ms: 100,
      status: 'success',
      retryCount: 0,
      manualIntervention: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'metrics-test-'));
    engine = new MetricsEngine(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('records and reports a single metric', async () => {
    await engine.recordStep(makeMetric());
    const report = await engine.report();

    expect(report.totalSteps).toBe(1);
    expect(report.successCount).toBe(1);
    expect(report.errorCount).toBe(0);
    expect(report.successRate).toBe(1);
  });

  test('aggregates multiple metrics', async () => {
    await engine.recordStep(makeMetric({ status: 'success', duration_ms: 100 }));
    await engine.recordStep(makeMetric({ status: 'success', duration_ms: 200 }));
    await engine.recordStep(makeMetric({ status: 'error', duration_ms: 50 }));

    const report = await engine.report();
    expect(report.totalSteps).toBe(3);
    expect(report.successCount).toBe(2);
    expect(report.errorCount).toBe(1);
    expect(report.successRate).toBeCloseTo(0.667, 2);
  });

  test('reports per-task breakdown', async () => {
    await engine.recordStep(makeMetric({ taskId: 'task-a', status: 'success' }));
    await engine.recordStep(makeMetric({ taskId: 'task-a', status: 'error' }));
    await engine.recordStep(makeMetric({ taskId: 'task-b', status: 'success' }));

    const report = await engine.report();
    expect(report.taskBreakdown['task-a'].steps).toBe(2);
    expect(report.taskBreakdown['task-a'].errors).toBe(1);
    expect(report.taskBreakdown['task-b'].steps).toBe(1);
  });

  test('reportForTask filters by taskId', async () => {
    await engine.recordStep(makeMetric({ taskId: 'task-a' }));
    await engine.recordStep(makeMetric({ taskId: 'task-b' }));
    await engine.recordStep(makeMetric({ taskId: 'task-a' }));

    const report = await engine.reportForTask('task-a');
    expect(report.totalSteps).toBe(2);
  });

  test('empty report has zeroed stats', async () => {
    const report = await engine.report();
    expect(report.totalSteps).toBe(0);
    expect(report.successRate).toBe(0);
    expect(report.avgStepDuration_ms).toBe(0);
  });

  test('p95 calculation works', async () => {
    // 20 metrics with durations 1..20
    for (let i = 1; i <= 20; i++) {
      await engine.recordStep(makeMetric({ duration_ms: i * 10, stepIndex: i }));
    }

    const report = await engine.report();
    expect(report.totalSteps).toBe(20);
    expect(report.p95StepDuration_ms).toBe(200); // 95th percentile of 10-200
  });

  // ── Rotation ──────────────────────────────────────────────────────

  test('rotates file when it exceeds max size', async () => {
    // Create engine with tiny max size (100 bytes)
    const tinyEngine = new MetricsEngine(tempDir, 0.0001); // ~100 bytes

    // Write enough data to trigger rotation
    for (let i = 0; i < 5; i++) {
      await tinyEngine.recordStep(makeMetric({ stepIndex: i }));
    }

    // Should have rotated — check for rotated files
    const { readdirSync } = await import('fs');
    const files = readdirSync(tempDir).filter(f => f.endsWith('.ndjson'));
    expect(files.length).toBeGreaterThanOrEqual(2); // current + at least 1 rotated
  });
});
