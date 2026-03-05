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

const USE_SSE = (process.env.MCP_USE_SSE ?? "true").toLowerCase() === "true";
const SSE_PORT = Number(process.env.MCP_SSE_PORT ?? 3456);
const SSE_HOST = process.env.MCP_SSE_HOST ?? "127.0.0.1";
const SSE_BEARER = process.env.MCP_SSE_BEARER_TOKEN?.trim() || "";
const PUBLIC_BASE_URL = (process.env.MCP_PUBLIC_BASE_URL ?? "").trim();

function createMcpServer() {
  const server = new McpServer({ name: "unified-automation", version: "2.0.0" });
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
      res.end(JSON.stringify({ ok: true, transport: "sse" }));
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
  });
}

const stdioServer = createMcpServer();
const transport = new StdioServerTransport();
await stdioServer.connect(transport);

console.error("Unified Automation MCP server started");
