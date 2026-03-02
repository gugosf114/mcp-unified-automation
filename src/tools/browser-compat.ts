import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";

/**
 * Backward-compatible browser_* tools.
 *
 * These are the original 7 tools from v1.0, now delegating to
 * SessionManager's compat methods (which use the "default" page slot).
 * Existing MCP clients see no behavioral change.
 */
export function registerBrowserCompatTools(server: McpServer, session: SessionManager) {

  server.tool(
    "browser_navigate",
    "Navigate to a URL in the automated browser. Returns page title and current URL. " +
    "Uses real Chrome profile with all cookies/sessions.",
    {
      url: z.string().describe("URL to navigate to"),
      wait_for: z.string().optional().describe("CSS selector to wait for before returning"),
    },
    async ({ url, wait_for }) => {
      const result = await session.navigate(url, wait_for);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_extract_content",
    "Extract content from the current page using CSS selectors. " +
    "Modes: 'text', 'html', 'links', 'attribute'.",
    {
      selector: z.string().describe("CSS selector to match elements"),
      extract: z.enum(["text", "html", "links", "attribute"]).describe("Extraction mode"),
      attribute: z.string().optional().describe("Attribute name when extract='attribute'"),
    },
    async ({ selector, extract, attribute }) => {
      const result = await session.extractContent(selector, extract, attribute);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_fill_form",
    "Fill form fields on the current page. Provide CSS selector:value pairs.",
    {
      fields: z.record(z.string()).describe("Map of CSS selector to value"),
      submit_selector: z.string().optional().describe("Submit button selector"),
    },
    async ({ fields, submit_selector }) => {
      const result = await session.fillForm(fields, submit_selector);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_click",
    "Click an element on the current page by CSS selector.",
    {
      selector: z.string().describe("CSS selector of element to click"),
      wait_after: z.boolean().optional().describe("Wait for navigation after click (default: true)"),
    },
    async ({ selector, wait_after }) => {
      const result = await session.click(selector, wait_after ?? true);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_screenshot",
    "Take a screenshot of the current page.",
    {
      path: z.string().optional().describe("File path (default: Desktop)"),
      full_page: z.boolean().optional().describe("Full scrollable page (default: false)"),
    },
    async ({ path, full_page }) => {
      const result = await session.screenshot(path, full_page ?? false);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_execute_script",
    "Execute JavaScript in the current page context and return the result.",
    {
      script: z.string().describe("JavaScript code to execute"),
    },
    async ({ script }) => {
      const result = await session.executeScript(script);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_get_page_info",
    "Get current page URL, title, and DOM summary.",
    {},
    async () => {
      const result = await session.getPageInfo();
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
