import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import type { Page } from 'playwright';

export interface EvidenceRecord {
  id: string;
  taskId: string;
  stepIndex: number;
  stepName: string;
  timestamp: number;
  type: 'screenshot' | 'dom_snapshot' | 'network_request' | 'network_response' | 'action_log';
  artifactPath?: string;     // relative to task evidence dir
  data?: any;                // inline data for small records
  prevHash: string;
  hash: string;
}

/**
 * EvidenceLedger — append-only artifacts with SHA-256 hash chain.
 *
 * Storage layout:
 *   data/evidence/{taskId}/
 *     ledger.ndjson          — one EvidenceRecord per line
 *     artifacts/
 *       screenshot-001.png
 *       dom-001.html
 *
 * Each record's `hash` = SHA-256 of (record contents + prevHash).
 * The genesis record uses prevHash = '0'.repeat(64).
 */
export class EvidenceLedger {
  private baseDir: string;
  // Per-task last hash (in-memory cache, rebuilt on first write)
  private lastHash: Map<string, string> = new Map();
  private counters: Map<string, number> = new Map();

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(process.cwd(), 'data', 'evidence');
    mkdirSync(this.baseDir, { recursive: true });
  }

  private taskDir(taskId: string): string {
    const safe = taskId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    return join(this.baseDir, safe);
  }

  private artifactsDir(taskId: string): string {
    return join(this.taskDir(taskId), 'artifacts');
  }

  private ledgerPath(taskId: string): string {
    return join(this.taskDir(taskId), 'ledger.ndjson');
  }

  private nextCounter(taskId: string): number {
    const current = this.counters.get(taskId) || 0;
    const next = current + 1;
    this.counters.set(taskId, next);
    return next;
  }

  private getLastHash(taskId: string): string {
    if (this.lastHash.has(taskId)) return this.lastHash.get(taskId)!;

    // Rebuild from existing ledger
    const path = this.ledgerPath(taskId);
    if (existsSync(path)) {
      const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(l => l.length > 0);
      if (lines.length > 0) {
        try {
          const last: EvidenceRecord = JSON.parse(lines[lines.length - 1]);
          this.lastHash.set(taskId, last.hash);
          this.counters.set(taskId, lines.length);
          return last.hash;
        } catch { /* fall through */ }
      }
    }

    const genesis = '0'.repeat(64);
    this.lastHash.set(taskId, genesis);
    return genesis;
  }

  private computeHash(record: Omit<EvidenceRecord, 'hash'>): string {
    const payload = JSON.stringify(record);
    return createHash('sha256').update(payload).digest('hex');
  }

  // ── Core recording ────────────────────────────────────────────────

  async record(entry: Omit<EvidenceRecord, 'id' | 'prevHash' | 'hash'>): Promise<EvidenceRecord> {
    const dir = this.taskDir(entry.taskId);
    mkdirSync(dir, { recursive: true });

    const prevHash = this.getLastHash(entry.taskId);
    const partial = {
      id: randomUUID(),
      ...entry,
      prevHash,
    };
    const hash = this.computeHash(partial);
    const record: EvidenceRecord = { ...partial, hash };

    this.lastHash.set(entry.taskId, hash);

    const line = JSON.stringify(record) + '\n';
    appendFileSync(this.ledgerPath(entry.taskId), line, 'utf-8');

    return record;
  }

  // ── Convenience capture methods ───────────────────────────────────

  async captureScreenshot(
    taskId: string, stepIndex: number, stepName: string, page: Page
  ): Promise<EvidenceRecord> {
    const artDir = this.artifactsDir(taskId);
    mkdirSync(artDir, { recursive: true });

    const counter = this.nextCounter(taskId);
    const filename = `screenshot-${String(counter).padStart(3, '0')}.png`;
    const fullPath = join(artDir, filename);
    await page.screenshot({ path: fullPath });

    return this.record({
      taskId,
      stepIndex,
      stepName,
      timestamp: Date.now(),
      type: 'screenshot',
      artifactPath: `artifacts/${filename}`,
    });
  }

  async captureDomSnapshot(
    taskId: string, stepIndex: number, stepName: string, page: Page
  ): Promise<EvidenceRecord> {
    const artDir = this.artifactsDir(taskId);
    mkdirSync(artDir, { recursive: true });

    const counter = this.nextCounter(taskId);
    const filename = `dom-${String(counter).padStart(3, '0')}.html`;
    const fullPath = join(artDir, filename);
    const html = await page.content();
    writeFileSync(fullPath, html, 'utf-8');

    return this.record({
      taskId,
      stepIndex,
      stepName,
      timestamp: Date.now(),
      type: 'dom_snapshot',
      artifactPath: `artifacts/${filename}`,
    });
  }

  async recordAction(
    taskId: string, stepIndex: number, stepName: string, actionData: any
  ): Promise<EvidenceRecord> {
    return this.record({
      taskId,
      stepIndex,
      stepName,
      timestamp: Date.now(),
      type: 'action_log',
      data: actionData,
    });
  }

  // ── Export & verification ─────────────────────────────────────────

  async export(taskId: string, format: 'json'): Promise<{ path: string; records: number }> {
    const ledgerFile = this.ledgerPath(taskId);
    if (!existsSync(ledgerFile)) {
      return { path: '', records: 0 };
    }

    const content = readFileSync(ledgerFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    const records = lines.map(l => JSON.parse(l));

    const exportPath = join(this.taskDir(taskId), `export-${Date.now()}.json`);
    writeFileSync(exportPath, JSON.stringify({
      taskId,
      exportedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    }, null, 2), 'utf-8');

    return { path: exportPath, records: records.length };
  }

  async verify(taskId: string): Promise<{ valid: boolean; totalRecords: number; brokenAt?: number }> {
    const ledgerFile = this.ledgerPath(taskId);
    if (!existsSync(ledgerFile)) {
      return { valid: true, totalRecords: 0 };
    }

    const content = readFileSync(ledgerFile, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.length > 0);
    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < lines.length; i++) {
      const record: EvidenceRecord = JSON.parse(lines[i]);

      if (record.prevHash !== expectedPrevHash) {
        return { valid: false, totalRecords: lines.length, brokenAt: i };
      }

      // Recompute hash
      const { hash: _storedHash, ...rest } = record;
      const computed = this.computeHash(rest);
      if (computed !== record.hash) {
        return { valid: false, totalRecords: lines.length, brokenAt: i };
      }

      expectedPrevHash = record.hash;
    }

    return { valid: true, totalRecords: lines.length };
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}
