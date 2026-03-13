import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionExecutor } from "../action/action-executor.js";

const SCRIPT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerWebScriptTool(server: McpServer, executor: ActionExecutor) {

  server.tool(
    "web_script",
    "Execute JavaScript in the authenticated Chrome browser page and return the result. " +
    "Runs in the real page context with full DOM access.",
    {
      script: z.string().describe("JavaScript code to execute in the page context"),
      session: z.string().default("default").describe("Named session to execute in"),
    },
    SCRIPT_ANNOTATIONS,
    async ({ script, session }) => {
      const result = await executor.evaluate(session, script);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
