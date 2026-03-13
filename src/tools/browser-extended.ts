import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SessionManager } from "../session/session-manager.js";
import type { ActionExecutor } from "../action/action-executor.js";

/**
 * Extended browser tools — the primitives missing from v1.0.
 *
 * These all operate on the "default" page slot for backward compatibility.
 * For named-session variants, use the ActionExecutor directly via task steps.
 */
export function registerBrowserExtendedTools(
  server: McpServer,
  session: SessionManager,
  executor: ActionExecutor,
) {

  server.tool(
    "browser_scroll",
    "Scroll page or scroll element into view. Pre-authorized.",
    {
      direction: z.enum(["down", "up", "left", "right"]).default("down")
        .describe("Scroll direction"),
      amount: z.number().default(500).describe("Scroll amount in pixels"),
      selector: z.string().optional()
        .describe("CSS selector to scroll into view (overrides direction/amount)"),
    },
    async ({ direction, amount, selector }) => {
      const result = await executor.scroll('default', { direction, amount, selector });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_hover",
    "Hover over an element to trigger tooltips or dropdowns. Pre-authorized.",
    {
      selector: z.string().describe("CSS selector of element to hover"),
    },
    async ({ selector }) => {
      const result = await executor.hover('default', selector);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_keyboard",
    "Press a key or key combination. Pre-authorized. " +
    "Supports modifiers (Ctrl, Shift, Alt, Meta).",
    {
      key: z.string().describe("Key to press (e.g., 'Enter', 'Tab', 'a', 'F5')"),
      modifiers: z.array(z.enum(["Control", "Shift", "Alt", "Meta"])).optional()
        .describe("Modifier keys to hold (e.g., ['Control', 'Shift'])"),
    },
    async ({ key, modifiers }) => {
      const result = await executor.keyboard('default', key, { modifiers });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_select_option",
    "Select an option from a <select> dropdown. Pre-authorized.",
    {
      selector: z.string().describe("CSS selector of the <select> element"),
      value: z.string().describe("Option value, visible text, or index to select"),
    },
    async ({ selector, value }) => {
      const result = await executor.select('default', selector, value);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_upload",
    "Upload a file via a file input element. Pre-authorized.",
    {
      selector: z.string().describe("CSS selector of the file input"),
      file_path: z.string().describe("Absolute path to the file to upload"),
    },
    async ({ selector, file_path }) => {
      const result = await executor.upload('default', selector, file_path);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_download",
    "Trigger a download by clicking an element. Pre-authorized.",
    {
      trigger_selector: z.string().describe("CSS selector of the element that triggers download"),
      download_dir: z.string().optional().describe("Directory to save to (default: ~/Downloads)"),
    },
    async ({ trigger_selector, download_dir }) => {
      const result = await executor.download('default', trigger_selector, download_dir);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_drag",
    "Drag and drop elements. Pre-authorized.",
    {
      source_selector: z.string().describe("CSS selector of element to drag"),
      target_selector: z.string().describe("CSS selector of drop target"),
    },
    async ({ source_selector, target_selector }) => {
      const result = await executor.drag('default', source_selector, target_selector);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_wait_for_text",
    "Wait for specific text to appear on the page.",
    {
      text: z.string().describe("Text to wait for"),
      selector: z.string().optional().describe("Limit search to this container (default: body)"),
      timeout_ms: z.number().default(10000).describe("Timeout in milliseconds"),
    },
    async ({ text, selector, timeout_ms }) => {
      const result = await executor.waitForText('default', text, { selector, timeout: timeout_ms });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_pdf",
    "Generate a PDF of the current page. Requires headless mode.",
    {
      path: z.string().optional().describe("Output file path (default: Desktop)"),
    },
    async ({ path }) => {
      const result = await executor.pdf('default', path);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "browser_accessibility_tree",
    "Get the accessibility tree of the page. Structured snapshot of roles, names, values.",
    {},
    async () => {
      const result = await executor.accessibilityTree('default');
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
