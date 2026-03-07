import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NetworkOrchestrator } from "../network/network-orchestrator.js";
import type { CDPBridge } from "../cdp/cdp-bridge.js";
import type { SessionManager } from "../session/session-manager.js";

export function registerNetworkTools(
  server: McpServer,
  network: NetworkOrchestrator,
  cdpBridge: CDPBridge,
  session: SessionManager,
) {

  server.tool(
    "network_learn",
    "Discover JSON API endpoints from captured network traffic on a page. " +
    "First attaches CDP if not already attached, then returns discovered endpoints.",
    {
      context_name: z.string().describe("Session name to analyze"),
    },
    async ({ context_name }) => {
      try {
        // Ensure CDP is attached
        const page = await session.getPage(context_name);
        const ctx = session.getBrowserContext();
        if (ctx && !cdpBridge.getSession(context_name)) {
          await cdpBridge.attach(context_name, page, ctx);
        }

        const endpoints = await network.learnEndpoints(context_name);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: { endpoints, count: endpoints.length },
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
    "network_block",
    "Apply a network blocking profile. Blocks ads, trackers, fonts, media, etc. " +
    "Profiles: 'none', 'minimal' (ads+trackers+fonts), 'aggressive' (+images+media+chat).",
    {
      profile_name: z.string().describe("Blocking profile: 'none', 'minimal', or 'aggressive'"),
    },
    async ({ profile_name }) => {
      try {
        // Apply globally (blocking is at the BrowserContext level)
        await network.applyProfile('global', profile_name);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: {
                profile: profile_name,
                available: network.getBuiltinProfiles(),
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
