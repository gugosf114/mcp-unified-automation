import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const BLOCKED_PATTERNS = [
  'format c:', 'format d:',
  'del /s /q c:\\',
  'rm -rf /',
  'shutdown',
  'reg delete',
  'remove-item -recurse -force c:\\',
];

function validateCommand(command: string): { allowed: boolean; reason?: string } {
  const lower = command.toLowerCase().trim();
  for (const blocked of BLOCKED_PATTERNS) {
    if (lower.includes(blocked)) {
      return { allowed: false, reason: `Blocked destructive pattern: ${blocked}` };
    }
  }
  if (/[`\r\n]/.test(command)) {
    return { allowed: false, reason: 'Backtick escapes and multiline commands are not allowed' };
  }
  return { allowed: true };
}

async function runCommand(
  command: string,
  timeoutMs: number = 30000
): Promise<{ status: string; data?: string; error?: string; details?: string; duration_ms: number }> {
  const start = Date.now();
  const validation = validateCommand(command);
  if (!validation.allowed) {
    return { status: "error", error: validation.reason!, duration_ms: Date.now() - start };
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      shell: 'powershell.exe',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return {
      status: "success",
      data: stdout.trim(),
      details: stderr.trim() || undefined,
      duration_ms: Date.now() - start,
    };
  } catch (error: any) {
    return {
      status: "error",
      error: error.message,
      details: error.stderr?.trim(),
      duration_ms: Date.now() - start,
    };
  }
}

/** Also exported for use by the orchestrator dispatch. */
export { runCommand };

export function registerSystemTool(server: McpServer) {

  server.tool(
    "system",
    "Execute a PowerShell command and return stdout/stderr. " +
    "Destructive commands are blocked. Timeout defaults to 30 seconds.",
    {
      command: z.string().describe("PowerShell command to execute"),
      timeout_ms: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ command, timeout_ms }) => {
      const result = await runCommand(command, timeout_ms);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
