import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObserverBus } from "../observer/observer-bus.js";
import type { SessionManager } from "../session/session-manager.js";

const OBSERVE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerObserveTool(server: McpServer, observer: ObserverBus, session: SessionManager) {

  server.tool(
    "observe",
    "Start or stop observing DOM mutations and form changes on a named session's page. " +
    "Injects MutationObserver and event listeners. Events are logged internally and can drive task decisions.",
    {
      command: z.enum(["start", "stop"]).describe("Start or stop observing"),
      context_name: z.string().describe("Session name to observe"),
    },
    OBSERVE_ANNOTATIONS,
    async ({ command, context_name }) => {
      try {
        if (command === "start") {
          const page = await session.getPage(context_name);
          await observer.startObserving(context_name, page);
          return ok({ command: "start", observing: context_name, url: page.url() });
        } else {
          let page;
          try { page = await session.getPage(context_name); } catch { /* page may be closed */ }
          await observer.stopObserving(context_name, page);
          return ok({ command: "stop", stopped: context_name });
        }
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ status: "error", error: error.message }, null, 2) }] };
      }
    }
  );
}

function ok(data: Record<string, any>) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ status: "success", data }, null, 2) }] };
}
