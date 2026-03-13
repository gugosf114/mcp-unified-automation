import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";

const SESSION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerSessionTool(server: McpServer, session: SessionManager) {

  server.tool(
    "session",
    "Manage named browser sessions (tabs) in the authenticated Chrome browser. " +
    "All sessions share the same real Chrome profile — already logged into all sites. " +
    "Commands: open (create/reuse tab), warm (open + navigate to home URL), list, close.",
    {
      command: z.enum(["open", "warm", "list", "close"])
        .describe("Session operation to perform"),
      name: z.string().optional()
        .describe("Session name (required for open/warm/close). E.g., 'linkedin', 'credit', 'court'"),
    },
    SESSION_ANNOTATIONS,
    async ({ command, name }) => {
      try {
        switch (command) {
          case "open": {
            if (!name) return err("'name' is required for command 'open'");
            const handle = await session.open(name);
            return ok({
              command: "open",
              contextName: handle.contextName,
              url: handle.page.url(),
              createdAt: handle.createdAt,
            });
          }
          case "warm": {
            if (!name) return err("'name' is required for command 'warm'");
            const handle = await session.warm(name);
            return ok({
              command: "warm",
              contextName: handle.contextName,
              url: handle.page.url(),
              homeUrl: handle.homeUrl,
            });
          }
          case "list": {
            const contexts = session.listContexts();
            return ok({ command: "list", sessions: contexts, count: contexts.length });
          }
          case "close": {
            if (!name) return err("'name' is required for command 'close'");
            await session.closePage(name);
            return ok({ command: "close", closed: name });
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
