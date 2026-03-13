import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionExecutor } from "../action/action-executor.js";
import type { SessionManager } from "../session/session-manager.js";
import type { ToolResult, ContextName } from "../types/common.js";

const ACT_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
} as const;

// ── Action schema ─────────────────────────────────────────────────────

const ActionSchema = z.object({
  action: z.enum([
    "click", "fill", "type", "select", "scroll", "hover",
    "keyboard", "upload", "download", "drag", "wait_for_text",
    "wait_for_selector", "screenshot", "pdf",
  ]),
  selector: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
  key: z.string().optional(),
  modifiers: z.array(z.enum(["Control", "Shift", "Alt", "Meta"])).optional(),
  direction: z.enum(["down", "up", "left", "right"]).optional(),
  amount: z.number().optional(),
  path: z.string().optional(),
  source_selector: z.string().optional(),
  target_selector: z.string().optional(),
  timeout_ms: z.number().optional(),
  full_page: z.boolean().optional(),
  wait_for_nav: z.boolean().optional(),
  delay: z.number().optional(),
});

export type WebAction = z.infer<typeof ActionSchema>;

// ── Shared action runner (reused by orchestrator.ts) ──────────────────

export async function runActions(
  actions: WebAction[],
  session: ContextName,
  executor: ActionExecutor,
  opts: { screenshotOnError: boolean; screenshotFinal: boolean },
): Promise<ToolResult> {
  const start = Date.now();
  const results: any[] = [];

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    let stepResult: ToolResult;

    switch (a.action) {
      case "click":
        stepResult = await executor.click(session, a.selector!, { waitForNav: a.wait_for_nav });
        break;
      case "fill":
        stepResult = await executor.fill(session, a.selector!, a.value!);
        break;
      case "type":
        stepResult = await executor.type(session, a.selector!, a.value!, { delay: a.delay });
        break;
      case "select":
        stepResult = await executor.select(session, a.selector!, a.value!);
        break;
      case "scroll":
        stepResult = await executor.scroll(session, {
          direction: a.direction,
          amount: a.amount,
          selector: a.selector,
        });
        break;
      case "hover":
        stepResult = await executor.hover(session, a.selector!);
        break;
      case "keyboard":
        stepResult = await executor.keyboard(session, a.key!, { modifiers: a.modifiers as any });
        break;
      case "upload":
        stepResult = await executor.upload(session, a.selector!, a.path!);
        break;
      case "download":
        stepResult = await executor.download(session, a.selector!, a.path);
        break;
      case "drag":
        stepResult = await executor.drag(session, a.source_selector!, a.target_selector!);
        break;
      case "wait_for_text":
        stepResult = await executor.waitForText(session, a.text!, {
          selector: a.selector,
          timeout: a.timeout_ms,
        });
        break;
      case "wait_for_selector":
        stepResult = await executor.waitForState(session, {
          selector: a.selector,
          timeout: a.timeout_ms,
        });
        break;
      case "screenshot":
        stepResult = await executor.screenshot(session, a.path, a.full_page);
        break;
      case "pdf":
        stepResult = await executor.pdf(session, a.path);
        break;
      default:
        stepResult = { status: "error", error: `Unknown action: ${(a as any).action}` };
    }

    results.push({ step: i, action: a.action, ...stepResult });

    if (stepResult.status === "error") {
      if (opts.screenshotOnError) {
        const errShot = await executor.screenshot(session).catch(() => null);
        if (errShot) results.push({ step: "error_screenshot", ...errShot });
      }
      return {
        status: "partial",
        data: { completed: i, total: actions.length, results },
        duration_ms: Date.now() - start,
      };
    }
  }

  if (opts.screenshotFinal) {
    const finalShot = await executor.screenshot(session).catch(() => null);
    if (finalShot) results.push({ step: "final_screenshot", ...finalShot });
  }

  return {
    status: "success",
    data: { completed: actions.length, total: actions.length, results },
    duration_ms: Date.now() - start,
  };
}

// ── MCP tool registration ─────────────────────────────────────────────

export function registerWebActTool(
  server: McpServer,
  executor: ActionExecutor,
  _session: SessionManager,
) {

  server.tool(
    "web_act",
    "Execute an ordered list of browser actions in the authenticated Chrome browser. " +
    "Actions run sequentially — stops on first error and auto-screenshots the failure. " +
    "Supports: click, fill, type, select, scroll, hover, keyboard, upload, download, " +
    "drag, wait_for_text, wait_for_selector, screenshot, pdf.",
    {
      actions: z.array(ActionSchema).min(1)
        .describe("Ordered list of browser actions to execute sequentially"),
      session: z.string().default("default").describe("Named session to operate on"),
      screenshot_on_error: z.boolean().default(true)
        .describe("Auto-screenshot when an action fails"),
      screenshot_final: z.boolean().default(false)
        .describe("Screenshot after all actions complete successfully"),
    },
    ACT_ANNOTATIONS,
    async ({ actions, session, screenshot_on_error, screenshot_final }) => {
      const result = await runActions(actions, session, executor, {
        screenshotOnError: screenshot_on_error,
        screenshotFinal: screenshot_final,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
