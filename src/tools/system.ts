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

export function registerSystemTools(server: McpServer) {

  server.tool(
    "system_run_command",
    "Execute a PowerShell command and return stdout/stderr. " +
    "For running arbitrary system commands. Destructive commands are blocked. " +
    "Timeout defaults to 30 seconds.",
    {
      command: z.string().describe("PowerShell command to execute"),
      timeout_ms: z.number().optional().describe("Timeout in ms (default: 30000)"),
    },
    async ({ command, timeout_ms }) => {
      const result = await runCommand(command, timeout_ms);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_disk_usage",
    "Get disk space for all drives. Returns drive letter, total/used/free space in GB, and percent used.",
    {},
    async () => {
      const result = await runCommand(
        "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='TotalGB';E={[math]::Round($_.Used/1GB + $_.Free/1GB, 2)}}, @{N='UsedGB';E={[math]::Round($_.Used/1GB, 2)}}, @{N='FreeGB';E={[math]::Round($_.Free/1GB, 2)}} | ConvertTo-Json"
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_find_large_files",
    "Find files larger than a threshold in a directory. Returns file paths and sizes. " +
    "Useful for disk cleanup. Default: files > 100MB, recursive.",
    {
      directory: z.string().describe("Directory to search"),
      min_size_mb: z.number().default(100).describe("Minimum file size in MB"),
      recursive: z.boolean().default(true).describe("Search subdirectories"),
    },
    async ({ directory, min_size_mb, recursive }) => {
      const recurse = recursive ? '-Recurse' : '';
      const cmd = `Get-ChildItem -Path '${directory}' ${recurse} -File -ErrorAction SilentlyContinue | Where-Object { $_.Length -gt ${min_size_mb * 1024 * 1024} } | Sort-Object Length -Descending | Select-Object FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB, 2)}} | ConvertTo-Json`;
      const result = await runCommand(cmd, 60000);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_process_list",
    "List running processes sorted by memory or CPU usage. Returns top N processes with name, PID, memory (MB), CPU.",
    {
      sort_by: z.enum(["memory", "cpu"]).default("memory").describe("Sort by memory or cpu"),
      top_n: z.number().default(20).describe("Number of top processes to return"),
    },
    async ({ sort_by, top_n }) => {
      const sortProp = sort_by === 'memory' ? 'WorkingSet64' : 'CPU';
      const cmd = `Get-Process | Sort-Object ${sortProp} -Descending | Select-Object -First ${top_n} Name, Id, @{N='MemoryMB';E={[math]::Round($_.WorkingSet64/1MB, 1)}}, CPU | ConvertTo-Json`;
      const result = await runCommand(cmd);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_file_search",
    "Search for files by name pattern in a directory. Supports wildcards (*.txt, report*). " +
    "Returns matching file paths with size and last modified date.",
    {
      directory: z.string().describe("Directory to search"),
      pattern: z.string().describe("File name pattern with wildcards (e.g., '*.log', 'report*')"),
      recursive: z.boolean().default(true).describe("Search subdirectories"),
    },
    async ({ directory, pattern, recursive }) => {
      const recurse = recursive ? '-Recurse' : '';
      const cmd = `Get-ChildItem -Path '${directory}' -Filter '${pattern}' ${recurse} -File -ErrorAction SilentlyContinue | Select-Object FullName, @{N='SizeMB';E={[math]::Round($_.Length/1MB, 2)}}, LastWriteTime | ConvertTo-Json`;
      const result = await runCommand(cmd, 60000);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "system_network_info",
    "Get network information: IP addresses, DNS servers, and active connections count.",
    {},
    async () => {
      const cmd = `$ip = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object IPAddress, InterfaceAlias; $dns = Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object ServerAddresses -Unique; @{IP=$ip; DNS=$dns} | ConvertTo-Json -Depth 3`;
      const result = await runCommand(cmd);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
