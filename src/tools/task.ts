import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskEngine } from "../task/task-engine.js";
import type { CheckpointStore } from "../checkpoint/checkpoint-store.js";

const TASK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerTaskTool(
  server: McpServer,
  engine: TaskEngine,
  checkpointStore: CheckpointStore,
) {

  server.tool(
    "task",
    "Manage automated tasks. Commands: plan (validate spec), run (execute), " +
    "resume (from checkpoint), pause, commit (approve gate), status, list, cancel. " +
    "Tasks process entities through step sequences with approval gates and crash recovery.",
    {
      command: z.enum(["plan", "run", "resume", "pause", "commit", "status", "list", "cancel"])
        .describe("Task operation"),
      spec: z.string().optional()
        .describe("JSON task specification (required for plan/run)"),
      task_id: z.string().optional()
        .describe("Task ID (required for resume/pause/commit/status/cancel)"),
      delete_checkpoint: z.boolean().optional()
        .describe("Also delete checkpoint on cancel (prevents resume)"),
    },
    TASK_ANNOTATIONS,
    async ({ command, spec, task_id, delete_checkpoint }) => {
      try {
        switch (command) {
          case "plan": {
            if (!spec) return err("'spec' is required for command 'plan'");
            const result = await engine.plan(spec);
            return json(result);
          }
          case "run": {
            if (!spec) return err("'spec' is required for command 'run'");
            const result = await engine.run(spec);
            return json(result);
          }
          case "resume": {
            if (!task_id) return err("'task_id' is required for command 'resume'");
            const result = await engine.resume(task_id);
            return json(result);
          }
          case "pause": {
            if (!task_id) return err("'task_id' is required for command 'pause'");
            const result = await engine.pause(task_id);
            return json(result);
          }
          case "commit": {
            if (!task_id) return err("'task_id' is required for command 'commit'");
            const result = await engine.commit(task_id);
            return json(result);
          }
          case "status": {
            if (!task_id) return err("'task_id' is required for command 'status'");
            const result = engine.getStatus(task_id);
            // If not in memory, check checkpoints
            if (result.status === 'error') {
              const checkpoint = await checkpointStore.load(task_id);
              if (checkpoint) {
                return ok({
                  taskId: task_id,
                  state: 'dormant',
                  lastCheckpoint: {
                    stepIndex: checkpoint.stepIndex,
                    stepName: checkpoint.stepName,
                    entityIndex: checkpoint.entityIndex,
                    timestamp: checkpoint.timestamp,
                    pageUrl: checkpoint.pageUrl,
                    processedEntities: checkpoint.processedEntities.length,
                  },
                  note: 'Task is not in memory. Use task command "resume" to continue.',
                });
              }
            }
            return json(result);
          }
          case "list": {
            const active = engine.listTasks();
            const checkpointed = await checkpointStore.list();
            const activeIds = new Set(active.map(t => t.taskId));
            const dormant = checkpointed.filter(id => !activeIds.has(id));
            return ok({
              active,
              dormant,
              totalActive: active.length,
              totalDormant: dormant.length,
            });
          }
          case "cancel": {
            if (!task_id) return err("'task_id' is required for command 'cancel'");
            const result = engine.cancel(task_id);
            if (delete_checkpoint) {
              await checkpointStore.delete(task_id);
            }
            return json({ ...result, checkpointDeleted: !!delete_checkpoint });
          }
        }
      } catch (error: any) {
        return err(error.message);
      }
    }
  );
}

function ok(data: Record<string, any>) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ status: "success", data }, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ status: "error", error: message }, null, 2) }] };
}

function json(result: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}
