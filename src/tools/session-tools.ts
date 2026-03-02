import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";

export function registerSessionTools(server: McpServer, session: SessionManager) {

  server.tool(
    "session.open",
    "Open or reuse a named browser session (tab). All sessions share the same " +
    "Chrome profile and cookies. Named sessions: 'linkedin', 'credit', 'court', etc.",
    {
      context_name: z.string().describe("Session name (e.g., 'linkedin', 'credit', 'court')"),
    },
    async ({ context_name }) => {
      try {
        const handle = await session.open(context_name);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: {
                contextName: handle.contextName,
                url: handle.page.url(),
                createdAt: handle.createdAt,
              },
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", error: error.message }, null, 2),
          }],
        };
      }
    }
  );

  server.tool(
    "session.warm",
    "Open a named session AND navigate to its home URL (configured via " +
    "CONTEXT_{NAME}_HOME env var). Use to pre-warm authenticated sessions.",
    {
      context_name: z.string().describe("Session name to warm up"),
    },
    async ({ context_name }) => {
      try {
        const handle = await session.warm(context_name);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: {
                contextName: handle.contextName,
                url: handle.page.url(),
                homeUrl: handle.homeUrl,
              },
            }, null, 2),
          }],
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "error", error: error.message }, null, 2),
          }],
        };
      }
    }
  );
}
