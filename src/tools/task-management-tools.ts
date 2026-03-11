import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskEngine } from "../task/task-engine.js";
import type { CheckpointStore } from "../checkpoint/checkpoint-store.js";

/**
 * Task management tools — list, status, cancel.
 *
 * Completes the task lifecycle: the original 5 tools (plan/run/resume/pause/commit)
 * handle execution, these handle visibility and cleanup.
 */
export function registerTaskManagementTools(
  server: McpServer,
  engine: TaskEngine,
  checkpointStore: CheckpointStore,
) {

  server.tool(
    "task_list",
    "List all known tasks — both active (in-memory) and checkpointed (on-disk). " +
    "Shows task ID, status, and progress for each.",
    {},
    async () => {
      const active = engine.listTasks();
      const checkpointed = await checkpointStore.list();

      // Merge: active tasks override checkpointed ones
      const activeIds = new Set(active.map(t => t.taskId));
      const dormant = checkpointed.filter(id => !activeIds.has(id));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "success",
            data: {
              active,
              dormant,
              totalActive: active.length,
              totalDormant: dormant.length,
            },
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "task_status",
    "Get detailed status of a specific task: current step, entity progress, " +
    "whether it's paused/running/awaiting approval, etc.",
    {
      task_id: z.string().describe("Task ID to check"),
    },
    async ({ task_id }) => {
      const result = engine.getStatus(task_id);

      // If not in memory, check checkpoints
      if (result.status === 'error') {
        const checkpoint = await checkpointStore.load(task_id);
        if (checkpoint) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status: "success",
                data: {
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
                  note: 'Task is not in memory. Use task_resume to continue.',
                },
              }, null, 2),
            }],
          };
        }
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  server.tool(
    "task_cancel",
    "Cancel a task. Stops execution and cleans up. The checkpoint is preserved " +
    "so the task can be resumed later if needed.",
    {
      task_id: z.string().describe("Task ID to cancel"),
      delete_checkpoint: z.boolean().default(false)
        .describe("Also delete the checkpoint file (prevents resume)"),
    },
    async ({ task_id, delete_checkpoint }) => {
      const result = engine.cancel(task_id);

      if (delete_checkpoint) {
        await checkpointStore.delete(task_id);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            ...result,
            checkpointDeleted: delete_checkpoint,
          }, null, 2),
        }],
      };
    }
  );
}
