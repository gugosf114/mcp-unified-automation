import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ContextName } from '../types/common.js';
import { DATA_ROOT } from '../env.js';

export interface Checkpoint {
  taskId: string;
  stepIndex: number;
  stepName: string;
  entityIndex: number;
  timestamp: number;
  contextName: ContextName;
  pageUrl: string;
  formState: Record<string, string>;
  processedEntities: string[];          // idempotency keys already done
  cookiesHash: string;
  customData?: Record<string, any>;
}

/**
 * CheckpointStore — JSON file persistence for crash-safe task resume.
 *
 * Each task gets one file: data/checkpoints/{taskId}.json
 * The file contains the latest checkpoint plus an idempotency log
 * of all entity keys already processed.
 */
export class CheckpointStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || join(DATA_ROOT, 'checkpoints');
    mkdirSync(this.baseDir, { recursive: true });
  }

  private filePath(taskId: string): string {
    // Sanitize taskId for filesystem
    const safe = taskId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    return join(this.baseDir, `${safe}.json`);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    const path = this.filePath(checkpoint.taskId);
    writeFileSync(path, JSON.stringify(checkpoint, null, 2), 'utf-8');
  }

  async load(taskId: string): Promise<Checkpoint | null> {
    const path = this.filePath(taskId);
    if (!existsSync(path)) return null;

    try {
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as Checkpoint;
    } catch {
      return null;
    }
  }

  async exists(taskId: string): Promise<boolean> {
    return existsSync(this.filePath(taskId));
  }

  async delete(taskId: string): Promise<void> {
    const path = this.filePath(taskId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }

  async list(): Promise<string[]> {
    if (!existsSync(this.baseDir)) return [];
    return readdirSync(this.baseDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  async isProcessed(taskId: string, idempotencyKey: string): Promise<boolean> {
    const checkpoint = await this.load(taskId);
    if (!checkpoint) return false;
    return checkpoint.processedEntities.includes(idempotencyKey);
  }

  async markProcessed(taskId: string, idempotencyKey: string): Promise<void> {
    const checkpoint = await this.load(taskId);
    if (!checkpoint) return;
    if (!checkpoint.processedEntities.includes(idempotencyKey)) {
      checkpoint.processedEntities.push(idempotencyKey);
      await this.save(checkpoint);
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }
}
