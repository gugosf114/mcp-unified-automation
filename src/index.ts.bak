import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { Kernel } from "./kernel.js";
import { registerBrowserCompatTools } from "./tools/browser-compat.js";
import { registerSystemTools } from "./tools/system.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerObserveTools } from "./tools/observe-tools.js";
import { registerNetworkTools } from "./tools/network-tools.js";
import { registerEvidenceTools } from "./tools/evidence-tools.js";
import { registerMetricsTools } from "./tools/metrics-tools.js";

const kernel = new Kernel();

function createMcpServer() {
  const server = new McpServer({
    name: "unified-automation",
    version: "2.0.0",
  });

  // ── Register all tool groups ────────────────────────────────────────
  registerBrowserCompatTools(server, kernel.sessionManager);
  registerSystemTools(server);
  registerSessionTools(server, kernel.sessionManager);
  registerTaskTools(server, kernel.taskEngine);
  registerObserveTools(server, kernel.observerBus, kernel.sessionManager);
  registerNetworkTools(server, kernel.networkOrchestrator, kernel.cdpBridge, kernel.sessionManager);
  registerEvidenceTools(server, kernel.evidenceLedger);
  registerMetricsTools(server, kernel.metricsEngine);

  return server;
}

// ── Cleanup on exit ─────────────────────────────────────────────────
const cleanup = async () => {
  await kernel.shutdown();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const SSE_PORT = parseInt(process.env.SSE_PORT ?? "3456");
const USE_SSE = process.env.USE_SSE !== "false"; // default on

// ── SSE/HTTP transport (for claude.ai) ──────────────────────────────
if (USE_SSE) {
  const sseTransports: Record<string, SSEServerTransport> = {};

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS — allow claude.ai origin
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/sse" && req.method === "GET") {
      const server = createMcpServer();
      const transport = new SSEServerTransport("/messages", res);
      sseTransports[transport.sessionId] = transport;
      res.on("close", () => delete sseTransports[transport.sessionId]);
      await server.connect(transport);
      return;
    }

    if (req.url?.startsWith("/messages") && req.method === "POST") {
      const url = new URL(req.url, `http://localhost:${SSE_PORT}`);
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const transport = sseTransports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.writeHead(404);
        res.end("Session not found");
      }
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "2.0.0", tools: 25 }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(SSE_PORT, "127.0.0.1", () => {
    console.error(`SSE transport listening on http://localhost:${SSE_PORT}/sse`);
    console.error(`Health check: http://localhost:${SSE_PORT}/health`);
  });
}

// ── Stdio transport (for Claude Code) ───────────────────────────────
const stdioServer = createMcpServer();
const transport = new StdioServerTransport();
await stdioServer.connect(transport);

console.error('Unified Automation MCP server v2.0 started');
console.error(`  Tools: browser(7) + system(6) + session(2) + task(5) + observe(1) + network(2) + evidence(1) + metrics(1) = 25 total`);
console.error(`  Stdio: connected`);
console.error(`  SSE:   ${USE_SSE ? `http://localhost:${SSE_PORT}/sse` : "disabled"}`);
