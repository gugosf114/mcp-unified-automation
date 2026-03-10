import { EvidenceLedger } from '../src/evidence/evidence-ledger';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EvidenceLedger', () => {
  let ledger: EvidenceLedger;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'evidence-test-'));
    ledger = new EvidenceLedger(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Core recording ────────────────────────────────────────────────

  test('records an action with hash chain', async () => {
    const record = await ledger.recordAction('task-1', 0, 'navigate', { url: 'https://example.com' });

    expect(record.taskId).toBe('task-1');
    expect(record.stepName).toBe('navigate');
    expect(record.type).toBe('action_log');
    expect(record.hash).toBeTruthy();
    expect(record.prevHash).toBe('0'.repeat(64)); // genesis
    expect(record.id).toBeTruthy(); // UUID
  });

  test('hash chain links records sequentially', async () => {
    const r1 = await ledger.recordAction('task-1', 0, 'step-a', { data: 'first' });
    const r2 = await ledger.recordAction('task-1', 1, 'step-b', { data: 'second' });
    const r3 = await ledger.recordAction('task-1', 2, 'step-c', { data: 'third' });

    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.prevHash).toBe(r2.hash);
  });

  test('different tasks have independent hash chains', async () => {
    const a1 = await ledger.recordAction('task-a', 0, 'step-1', {});
    const b1 = await ledger.recordAction('task-b', 0, 'step-1', {});

    // Both should start from genesis
    expect(a1.prevHash).toBe('0'.repeat(64));
    expect(b1.prevHash).toBe('0'.repeat(64));
  });

  // ── Verification ──────────────────────────────────────────────────

  test('verify returns valid for correct chain', async () => {
    await ledger.recordAction('task-1', 0, 'a', {});
    await ledger.recordAction('task-1', 1, 'b', {});
    await ledger.recordAction('task-1', 2, 'c', {});

    const result = await ledger.verify('task-1');
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(3);
  });

  test('verify returns valid for nonexistent task', async () => {
    const result = await ledger.verify('no-such-task');
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(0);
  });

  // ── Export ────────────────────────────────────────────────────────

  test('export produces JSON file with all records', async () => {
    await ledger.recordAction('task-1', 0, 'a', {});
    await ledger.recordAction('task-1', 1, 'b', {});

    const exported = await ledger.export('task-1', 'json');
    expect(exported.records).toBe(2);
    expect(exported.path).toContain('export-');
  });

  test('export returns 0 records for nonexistent task', async () => {
    const exported = await ledger.export('nope', 'json');
    expect(exported.records).toBe(0);
    expect(exported.path).toBe('');
  });

  // ── Archive ───────────────────────────────────────────────────────

  test('archive moves task directory', async () => {
    await ledger.recordAction('task-1', 0, 'a', {});

    const archivePath = await ledger.archive('task-1');
    expect(archivePath).toBeTruthy();
    expect(archivePath).toContain('archived');

    // Original task should no longer have records
    const result = await ledger.verify('task-1');
    expect(result.totalRecords).toBe(0);
  });

  test('archive returns null for nonexistent task', async () => {
    const result = await ledger.archive('nope');
    expect(result).toBeNull();
  });

  // ── List ──────────────────────────────────────────────────────────

  test('listTasks returns task IDs', async () => {
    await ledger.recordAction('task-a', 0, 'step', {});
    await ledger.recordAction('task-b', 0, 'step', {});

    const tasks = ledger.listTasks();
    expect(tasks.sort()).toEqual(['task-a', 'task-b']);
  });
});
