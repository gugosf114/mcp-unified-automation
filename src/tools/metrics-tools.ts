import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MetricsEngine } from "../metrics/metrics-engine.js";

export function registerMetricsTools(server: McpServer, metrics: MetricsEngine) {

  server.tool(
    "metrics_report",
    "Get aggregated metrics: success rate, step latencies (avg + p95), retry counts, " +
    "manual interventions, per-task breakdown. Optionally filter by time window.",
    {
      window_hours: z.number().optional().describe("Time window in hours (default: all time)"),
      task_id: z.string().optional().describe("Filter to a specific task ID"),
    },
    async ({ window_hours, task_id }) => {
      try {
        let report;
        if (task_id) {
          report = await metrics.reportForTask(task_id);
        } else {
          const windowMs = window_hours ? window_hours * 60 * 60 * 1000 : undefined;
          report = await metrics.report(windowMs);
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ status: "success", data: report }, null, 2),
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
