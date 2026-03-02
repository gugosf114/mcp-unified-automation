import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { TaskEngine } from "../task/task-engine.js";

export function registerTaskTools(server: McpServer, engine: TaskEngine) {

  server.tool(
    "task.plan",
    "Parse and validate a task spec (JSON) without executing. Returns the parsed " +
    "spec and reports any unknown steps. Use to review before task.run.",
    {
      spec: z.string().describe("JSON task specification string"),
    },
    async ({ spec }) => {
      const result = await engine.plan(spec);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "task.run",
    "Execute a task from a JSON spec. Processes entities through steps sequentially. " +
    "Returns immediately if an approval gate is hit (status: pending_approval). " +
    "Use task.commit(taskId) to approve and continue.",
    {
      spec: z.string().describe("JSON task specification string"),
    },
    async ({ spec }) => {
      const result = await engine.run(spec);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "task.resume",
    "Resume a paused or interrupted task from its last checkpoint.",
    {
      task_id: z.string().describe("Task ID to resume"),
    },
    async ({ task_id }) => {
      const result = await engine.resume(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "task.pause",
    "Pause a running task. Takes effect after the current step completes.",
    {
      task_id: z.string().describe("Task ID to pause"),
    },
    async ({ task_id }) => {
      const result = await engine.pause(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "task.commit",
    "Approve a pending approval gate and continue task execution. " +
    "This is the human-in-the-loop confirmation step. Only works when " +
    "task status is 'awaiting_approval'.",
    {
      task_id: z.string().describe("Task ID to approve"),
    },
    async ({ task_id }) => {
      const result = await engine.commit(task_id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
