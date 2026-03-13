import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionExecutor } from "../action/action-executor.js";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerWebWatchTool(server: McpServer, executor: ActionExecutor) {

  server.tool(
    "web_watch",
    "Observe the current page state in the authenticated Chrome browser. " +
    "Returns any combination of: screenshot, accessibility tree, and page info " +
    "(title, URL, DOM summary). One call replaces three separate tool calls.",
    {
      include: z.array(z.enum(["screenshot", "accessibility_tree", "page_info"]))
        .default(["screenshot", "page_info"])
        .describe("What to include in the observation"),
      screenshot_path: z.string().optional().describe("Save screenshot to this path"),
      full_page: z.boolean().default(false).describe("Full-page screenshot"),
      session: z.string().default("default").describe("Named session to observe"),
    },
    READ_ANNOTATIONS,
    async ({ include, screenshot_path, full_page, session }) => {
      const start = Date.now();
      const result: Record<string, any> = { status: "success" };

      try {
        if (include.includes("page_info")) {
          const info = await executor.getPageInfo(session);
          result.page = info.data;
        }

        if (include.includes("screenshot")) {
          const shot = await executor.screenshot(session, screenshot_path, full_page);
          result.screenshot = shot.data;
        }

        if (include.includes("accessibility_tree")) {
          const tree = await executor.accessibilityTree(session);
          result.accessibility_tree = tree.data;
        }

        result.duration_ms = Date.now() - start;
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", error: error.message, duration_ms: Date.now() - start }, null, 2),
          }],
        };
      }
    }
  );
}
