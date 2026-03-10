import { CheckpointStore, type Checkpoint } from '../src/checkpoint/checkpoint-store';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('CheckpointStore', () => {
  let store: CheckpointStore;
  let tempDir: string;

  function makeCheckpoint(overrides?: Partial<Checkpoint>): Checkpoint {
    return {
      taskId: 'test-task-1',
      stepIndex: 0,
      stepName: 'navigate',
      entityIndex: 0,
      timestamp: Date.now(),
      contextName: 'default',
      pageUrl: 'https://example.com',
      formState: {},
      processedEntities: [],
      cookiesHash: 'abc123',
      ...overrides,
    };
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'checkpoint-test-'));
    store = new CheckpointStore(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Basic CRUD ──────────────────────────────────────────────────

  test('save and load checkpoint', async () => {
    const cp = makeCheckpoint();
    await store.save(cp);
    const loaded = await store.load('test-task-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe('test-task-1');
    expect(loaded!.pageUrl).toBe('https://example.com');
  });

  test('load returns null for nonexistent task', async () => {
    const loaded = await store.load('does-not-exist');
    expect(loaded).toBeNull();
  });

  test('exists returns true after save', async () => {
    await store.save(makeCheckpoint());
    expect(await store.exists('test-task-1')).toBe(true);
  });

  test('exists returns false for nonexistent task', async () => {
    expect(await store.exists('nope')).toBe(false);
  });

  test('delete removes checkpoint', async () => {
    await store.save(makeCheckpoint());
    await store.delete('test-task-1');
    expect(await store.exists('test-task-1')).toBe(false);
    expect(await store.load('test-task-1')).toBeNull();
  });

  test('delete is safe on nonexistent task', async () => {
    await expect(store.delete('nope')).resolves.not.toThrow();
  });

  // ── Listing ─────────────────────────────────────────────────────

  test('list returns all saved task IDs', async () => {
    await store.save(makeCheckpoint({ taskId: 'task-a' }));
    await store.save(makeCheckpoint({ taskId: 'task-b' }));
    await store.save(makeCheckpoint({ taskId: 'task-c' }));
    const ids = await store.list();
    expect(ids.sort()).toEqual(['task-a', 'task-b', 'task-c']);
  });

  test('list returns empty array when no checkpoints', async () => {
    expect(await store.list()).toEqual([]);
  });

  // ── Idempotency tracking ────────────────────────────────────────

  test('isProcessed returns false initially', async () => {
    await store.save(makeCheckpoint());
    expect(await store.isProcessed('test-task-1', 'entity-42')).toBe(false);
  });

  test('markProcessed then isProcessed returns true', async () => {
    await store.save(makeCheckpoint());
    await store.markProcessed('test-task-1', 'entity-42');
    expect(await store.isProcessed('test-task-1', 'entity-42')).toBe(true);
  });

  test('markProcessed is idempotent — no duplicates', async () => {
    await store.save(makeCheckpoint());
    await store.markProcessed('test-task-1', 'entity-42');
    await store.markProcessed('test-task-1', 'entity-42');
    const cp = await store.load('test-task-1');
    const count = cp!.processedEntities.filter(e => e === 'entity-42').length;
    expect(count).toBe(1);
  });

  test('markProcessed on nonexistent task is safe', async () => {
    await expect(store.markProcessed('nope', 'key')).resolves.not.toThrow();
  });

  // ── TaskId sanitization ─────────────────────────────────────────

  test('handles special characters in taskId', async () => {
    const cp = makeCheckpoint({ taskId: 'task/with:special<chars>' });
    await store.save(cp);
    const loaded = await store.load('task/with:special<chars>');
    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe('task/with:special<chars>');
  });

  // ── Overwrite ───────────────────────────────────────────────────

  test('save overwrites previous checkpoint', async () => {
    await store.save(makeCheckpoint({ stepIndex: 0 }));
    await store.save(makeCheckpoint({ stepIndex: 5 }));
    const loaded = await store.load('test-task-1');
    expect(loaded!.stepIndex).toBe(5);
  });
});
