import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObserverBus } from "../observer/observer-bus.js";
import type { SessionManager } from "../session/session-manager.js";

export function registerObserveTools(server: McpServer, observer: ObserverBus, session: SessionManager) {

  server.tool(
    "observe_start",
    "Start observing DOM mutations and form changes on a named session's page. " +
    "Injects MutationObserver and event listeners. Events are logged internally " +
    "and can drive task decisions.",
    {
      context_name: z.string().describe("Session name to observe"),
    },
    async ({ context_name }) => {
      try {
        const page = await session.getPage(context_name);
        await observer.startObserving(context_name, page);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: { observing: context_name, url: page.url() },
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
