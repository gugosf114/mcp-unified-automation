import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EvidenceLedger } from "../evidence/evidence-ledger.js";

export function registerEvidenceTools(server: McpServer, ledger: EvidenceLedger) {

  server.tool(
    "evidence.export",
    "Export all evidence records for a task as JSON. Includes hash chain, " +
    "screenshot paths, DOM snapshots, and action logs. Also verifies chain integrity.",
    {
      task_id: z.string().describe("Task ID to export evidence for"),
      format: z.enum(["json"]).default("json").describe("Export format"),
    },
    async ({ task_id }) => {
      try {
        const verification = await ledger.verify(task_id);
        const exported = await ledger.export(task_id, 'json');

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              status: "success",
              data: {
                exportPath: exported.path,
                recordCount: exported.records,
                hashChainValid: verification.valid,
                verification,
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
