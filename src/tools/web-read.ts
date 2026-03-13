import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionExecutor } from "../action/action-executor.js";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

export function registerWebReadTool(server: McpServer, executor: ActionExecutor) {

  server.tool(
    "web_read",
    "Navigate to a URL (or read the current page) and extract content in one call. " +
    "Returns page title, URL, DOM summary (form/link/button/input counts), and extracted content. " +
    "Operates in the user's authenticated Chrome browser with real login sessions.",
    {
      url: z.string().optional().describe("URL to navigate to. Omit to read the current page without navigating."),
      selector: z.string().optional().describe("CSS selector to narrow extraction scope (default: body)"),
      extract: z.enum(["text", "html", "links", "all"]).default("all")
        .describe("What to extract. 'all' returns text + links + DOM summary."),
      attribute: z.string().optional().describe("Attribute name when extract='attribute'"),
      wait_for: z.string().optional().describe("CSS selector to wait for before extracting"),
      session: z.string().default("default").describe("Named session to operate on"),
    },
    READ_ANNOTATIONS,
    async ({ url, selector, extract, attribute, wait_for, session }) => {
      const start = Date.now();
      try {
        // Navigate if URL provided
        let navResult;
        if (url) {
          navResult = await executor.goto(session, url, { waitFor: wait_for });
          if (navResult.status === "error") {
            return { content: [{ type: "text" as const, text: JSON.stringify(navResult, null, 2) }] };
          }
        }

        // Get page info (title, url, DOM summary)
        const pageInfo = await executor.getPageInfo(session);

        // Extract content
        const extractSelector = selector || "body";
        const result: Record<string, any> = {
          status: "success",
          page: pageInfo.data,
          duration_ms: Date.now() - start,
        };

        if (extract === "all") {
          const textResult = await executor.extractContent(session, extractSelector, "text");
          const linkResult = await executor.extractContent(session, "a", "links");
          result.text = textResult.status === "success" ? textResult.data : null;
          result.links = linkResult.status === "success" ? linkResult.data : null;
        } else {
          const extractResult = await executor.extractContent(session, extractSelector, extract, attribute);
          result.content = extractResult.status === "success" ? extractResult.data : null;
          if (extractResult.status === "error") {
            result.extractError = extractResult.error;
          }
        }

        if (navResult?.data?.readiness) {
          result.readiness = navResult.data.readiness;
        }

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
