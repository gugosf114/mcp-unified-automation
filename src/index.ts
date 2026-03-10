import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomUUID } from "crypto";
import { Kernel } from "./kernel.js";
import { env } from "./env.js";
import { registerBrowserCompatTools } from "./tools/browser-compat.js";
import { registerBrowserExtendedTools } from "./tools/browser-extended.js";
import { registerSystemTools } from "./tools/system.js";
import { registerSessionTools } from "./tools/session-tools.js";
import { registerTaskTools } from "./tools/task-tools.js";
import { registerTaskManagementTools } from "./tools/task-management-tools.js";
import { registerObserveTools } from "./tools/observe-tools.js";
import { registerNetworkTools } from "./tools/network-tools.js";
import { registerEvidenceTools } from "./tools/evidence-tools.js";
import { registerMetricsTools } from "./tools/metrics-tools.js";
import { registerResources } from "./resources/register-resources.js";
import { registerPrompts } from "./prompts/register-prompts.js";

const kernel = new Kernel();

const USE_SSE = env.MCP_USE_SSE;
const SSE_PORT = env.MCP_SSE_PORT;
const SSE_HOST = env.MCP_SSE_HOST;
const SSE_BEARER = env.MCP_SSE_BEARER_TOKEN?.trim() || "";
const PUBLIC_BASE_URL = (env.MCP_PUBLIC_BASE_URL ?? "").trim();

const TOOL_COUNTS = {
  browser_compat: 7,
  browser_extended: 10,
  system: 6,
  session: 2,
  task: 5,
  task_management: 3,
  observe: 1,
  network: 2,
  evidence: 1,
  metrics: 1,
};
const TOTAL_TOOLS = Object.values(TOOL_COUNTS).reduce((a, b) => a + b, 0);

function createMcpServer() {
  const server = new McpServer({ name: "unified-automation", version: "2.2.0" });

  // ── Tools ───────────────────────────────────────────────────────
  registerBrowserCompatTools(server, kernel.sessionManager);
  registerBrowserExtendedTools(server, kernel.sessionManager, kernel.actionExecutor);
  registerSystemTools(server);
  registerSessionTools(server, kernel.sessionManager);
  registerTaskTools(server, kernel.taskEngine);
  registerTaskManagementTools(server, kernel.taskEngine, kernel.checkpointStore);
  registerObserveTools(server, kernel.observerBus, kernel.sessionManager);
  registerNetworkTools(server, kernel.networkOrchestrator, kernel.cdpBridge, kernel.sessionManager);
  registerEvidenceTools(server, kernel.evidenceLedger);
  registerMetricsTools(server, kernel.metricsEngine);

  // ── Resources ───────────────────────────────────────────────────
  registerResources(
    server,
    kernel.sessionManager,
    kernel.evidenceLedger,
    kernel.metricsEngine,
    kernel.checkpointStore,
    kernel.taskEngine,
  );

  // ── Prompts ─────────────────────────────────────────────────────
  registerPrompts(server);

  // ── Notifications ──────────────────────────────────────────────
  kernel.taskEngine.onNotify((level, data) => {
    server.sendLoggingMessage({
      level,
      logger: 'task-engine',
      data,
    }).catch(() => {});
  });

  return server;
}

// ── Cleanup on exit ─────────────────────────────────────────────────
const cleanup = async () => {
  await kernel.shutdown();
  process.exit(0);
};
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

function setCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept");
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!SSE_BEARER) return true;
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${SSE_BEARER}`;
}

if (USE_SSE) {
  const sseServer = createMcpServer();
  const transports: Record<string, SSEServerTransport> = {};
  // Streamable HTTP: one transport per session, keyed by session ID
  const streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

  const httpServer = createServer(async (req, res) => {
    setCors(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!isAuthorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    const url = req.url || "";
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, transport: "sse", version: "2.2.0", tools: TOTAL_TOOLS }));
      return;
    }

    if (req.method === "GET" && url === "/metrics") {
      try {
        const report = await kernel.metricsEngine.report();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(report, null, 2));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === "GET" && url === "/sse") {
      const transport = new SSEServerTransport("/messages", res);
      transports[transport.sessionId] = transport;
      res.on("close", () => delete transports[transport.sessionId]);
      await sseServer.connect(transport);
      return;
    }

    if (req.method === "POST" && url.startsWith("/messages")) {
      const sessionId = new URL(req.url!, "http://localhost").searchParams.get("sessionId");
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No transport found for sessionId" }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    // ── Streamable HTTP transport (MCP SDK 1.12+) ────────────────
    if (url === "/mcp" || url.startsWith("/mcp?")) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (req.method === "GET" || req.method === "POST" || req.method === "DELETE") {
        let transport: StreamableHTTPServerTransport;

        if (sessionId && streamableTransports.has(sessionId)) {
          transport = streamableTransports.get(sessionId)!;
        } else if (req.method === "POST" && !sessionId) {
          // New session — create transport
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
          });
          const mcpServer = createMcpServer();
          await mcpServer.connect(transport);

          // Store by session ID after first request
          if (transport.sessionId) {
            streamableTransports.set(transport.sessionId, transport);
            transport.onclose = () => {
              if (transport.sessionId) streamableTransports.delete(transport.sessionId);
            };
          }
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request — missing session ID" }));
          return;
        }

        await transport.handleRequest(req, res);
        return;
      }
    }

    res.writeHead(404);
    res.end();
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`SSE port ${SSE_PORT} already in use — skipping SSE transport (stdio still active)`);
    } else {
      console.error(`HTTP server error: ${err.message}`);
    }
  });

  httpServer.listen(SSE_PORT, SSE_HOST, () => {
    const localBase = `http://${SSE_HOST}:${SSE_PORT}`;
    const publicBase = PUBLIC_BASE_URL || localBase;
    console.error(`SSE local: ${localBase}/sse`);
    console.error(`SSE public: ${publicBase}/sse`);
    console.error(`Health: ${publicBase}/health`);
    console.error(`Metrics: ${publicBase}/metrics`);
  });
}

// ── Stdio transport (for Claude Code) ───────────────────────────────
const stdioServer = createMcpServer();
const transport = new StdioServerTransport();
await stdioServer.connect(transport);

const toolBreakdown = Object.entries(TOOL_COUNTS)
  .map(([name, count]) => `${name}(${count})`)
  .join(' + ');

console.error('Unified Automation MCP server v2.2.0 started');
console.error(`  Tools: ${toolBreakdown} = ${TOTAL_TOOLS} total`);
console.error(`  Resources: 6 (sessions, tasks, evidence, checkpoint, metrics, server-info)`);
console.error(`  Prompts: 3 (batch-scrape, linkedin-apply, evidence-audit)`);
console.error(`  Stdio: connected`);
console.error(`  SSE:   ${USE_SSE ? `http://${SSE_HOST}:${SSE_PORT}/sse` : "disabled"}`);
console.error(`  HTTP:  ${USE_SSE ? `http://${SSE_HOST}:${SSE_PORT}/mcp (Streamable HTTP)` : "disabled"}`);
