import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SessionManager } from "../session/session-manager.js";
import type { EvidenceLedger } from "../evidence/evidence-ledger.js";
import type { MetricsEngine } from "../metrics/metrics-engine.js";
import type { CheckpointStore } from "../checkpoint/checkpoint-store.js";
import type { TaskEngine } from "../task/task-engine.js";
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * MCP Resources — read-only data endpoints the client can pull on demand.
 *
 * Resources don't burn tool calls. Claude can read them as context
 * without the overhead of a tool invocation.
 */
export function registerResources(
  server: McpServer,
  sessionManager: SessionManager,
  evidenceLedger: EvidenceLedger,
  metricsEngine: MetricsEngine,
  checkpointStore: CheckpointStore,
  taskEngine: TaskEngine,
) {

  // ── Sessions resource ───────────────────────────────────────────
  server.resource(
    "sessions",
    "automation://sessions",
    { description: "List of active browser sessions with URLs and timestamps" },
    async () => {
      const contexts = sessionManager.listContexts();
      const sessions: any[] = [];
      for (const name of contexts) {
        try {
          const page = await sessionManager.getPage(name);
          sessions.push({
            name,
            url: page.url(),
            title: await page.title().catch(() => 'unknown'),
          });
        } catch {
          sessions.push({ name, url: 'closed', title: 'closed' });
        }
      }
      return {
        contents: [{
          uri: "automation://sessions",
          mimeType: "application/json",
          text: JSON.stringify(sessions, null, 2),
        }],
      };
    }
  );

  // ── Task list resource ──────────────────────────────────────────
  server.resource(
    "tasks",
    "automation://tasks",
    { description: "All active and dormant tasks with status" },
    async () => {
      const active = taskEngine.listTasks();
      const checkpointed = await checkpointStore.list();
      const activeIds = new Set(active.map(t => t.taskId));
      const dormant = checkpointed.filter(id => !activeIds.has(id));

      return {
        contents: [{
          uri: "automation://tasks",
          mimeType: "application/json",
          text: JSON.stringify({ active, dormant }, null, 2),
        }],
      };
    }
  );

  // ── Evidence for a specific task ────────────────────────────────
  server.resource(
    "evidence",
    new ResourceTemplate("automation://evidence/{taskId}", { list: undefined }),
    { description: "Hash-chained evidence ledger for a specific task" },
    async (uri, params) => {
      const taskId = params.taskId as string;
      const ledgerPath = join(evidenceLedger.getBaseDir(), taskId.replace(/[^a-zA-Z0-9_\-\.]/g, '_'), 'ledger.ndjson');

      if (!existsSync(ledgerPath)) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ taskId, records: [], error: 'No evidence found' }),
          }],
        };
      }

      const content = readFileSync(ledgerPath, 'utf-8');
      const records = content.trim().split('\n').filter(l => l.length > 0).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ taskId, recordCount: records.length, records }, null, 2),
        }],
      };
    }
  );

  // ── Checkpoint for a specific task ──────────────────────────────
  server.resource(
    "checkpoint",
    new ResourceTemplate("automation://checkpoint/{taskId}", { list: undefined }),
    { description: "Latest checkpoint state for a specific task" },
    async (uri, params) => {
      const taskId = params.taskId as string;
      const checkpoint = await checkpointStore.load(taskId);

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            checkpoint || { taskId, error: 'No checkpoint found' },
            null, 2
          ),
        }],
      };
    }
  );

  // ── Metrics report resource ─────────────────────────────────────
  server.resource(
    "metrics",
    "automation://metrics",
    { description: "Aggregated metrics: success rates, latencies, task breakdowns" },
    async () => {
      const report = await metricsEngine.report();
      return {
        contents: [{
          uri: "automation://metrics",
          mimeType: "application/json",
          text: JSON.stringify(report, null, 2),
        }],
      };
    }
  );

  // ── Server info resource ────────────────────────────────────────
  server.resource(
    "server-info",
    "automation://server-info",
    { description: "Server version, tool count, and configuration" },
    async () => {
      const contexts = sessionManager.listContexts();
      return {
        contents: [{
          uri: "automation://server-info",
          mimeType: "application/json",
          text: JSON.stringify({
            name: "unified-automation",
            version: "2.1.0",
            tools: 35,
            activeSessions: contexts.length,
            headed: process.env.BROWSER_HEADED !== 'false',
            chromeProfile: process.env.CHROME_USER_DATA_DIR || 'default',
          }, null, 2),
        }],
      };
    }
  );
}
