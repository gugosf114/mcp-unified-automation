import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Kernel } from "./kernel.js";
import { registerBrowserCompatTools } from "./tools/browser-compat.js";
import { registerSystemTools } from "./tools/system.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerObserveTools } from "./tools/observe-tools.js";
import { registerNetworkTools } from "./tools/network-tools.js";
import { registerEvidenceTools } from "./tools/evidence-tools.js";
import { registerMetricsTools } from "./tools/metrics-tools.js";

const server = new McpServer({
  name: "unified-automation",
  version: "2.0.0",
});

const kernel = new Kernel();

// ── Register all tool groups ────────────────────────────────────────

// Backward-compatible: original 7 browser_* tools (use "default" page slot)
registerBrowserCompatTools(server, kernel.sessionManager);

// Unchanged: 6 system_* tools
registerSystemTools(server);

// New: named session management
registerSessionTools(server, kernel.sessionManager);

// New: task DSL engine (plan/run/resume/pause/commit)
registerTaskTools(server, kernel.taskEngine);

// New: DOM observation
registerObserveTools(server, kernel.observerBus, kernel.sessionManager);

// New: network blocking + API discovery
registerNetworkTools(server, kernel.networkOrchestrator, kernel.cdpBridge, kernel.sessionManager);

// New: evidence export + hash chain verification
registerEvidenceTools(server, kernel.evidenceLedger);

// New: step-level metrics reporting
registerMetricsTools(server, kernel.metricsEngine);

// ── Cleanup on exit ─────────────────────────────────────────────────

const cleanup = async () => {
  await kernel.shutdown();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ── Start the server ────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('Unified Automation MCP server v2.0 started');
console.error(`  Tools: browser(7) + system(6) + session(2) + task(5) + observe(1) + network(2) + evidence(1) + metrics(1) = 25 total`);
