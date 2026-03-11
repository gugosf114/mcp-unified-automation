import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";

export function registerSessionTools(server: McpServer, session: SessionManager) {

  server.tool(
    "session_open",
    "Open or reuse a named browser session (tab) in the authenticated Chrome browser. " +
    "All sessions share the same real Chrome profile — already logged into Gmail, Google, " +
    "LinkedIn, GitHub, and all other sites. Named sessions: 'linkedin', 'credit', 'court', etc.",
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
    "session_warm",
    "Open a named session in the authenticated Chrome browser AND navigate to its home URL " +
    "(configured via CONTEXT_{NAME}_HOME env var). The browser is already logged in to all " +
    "sites. Use to pre-warm sessions for Gmail, LinkedIn, Google, etc.",
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
