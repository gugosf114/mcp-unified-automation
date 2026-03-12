/**
 * orchestrator.ts — Anthropic API-based orchestrator.
 *
 * Replaces Claude Desktop as the driver. Instead of MCP ↔ Desktop,
 * this module calls Claude directly via the SDK, parses tool calls,
 * executes them through the same Kernel, and loops until done.
 *
 * Control flow:
 *   User prompt → Claude API → tool_use → Kernel dispatch → tool_result → Claude API → ...
 *
 * Usage:
 *   const orch = new Orchestrator();
 *   const result = await orch.run("Scrape 5 LinkedIn profiles for ...");
 */

import Anthropic from '@anthropic-ai/sdk';
import { Kernel } from './kernel.js';
import { ALL_TOOLS } from './tool-defs.js';
import { env } from './env.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Types ──────────────────────────────────────────────────────────

interface OrchestratorOptions {
  /** Anthropic model ID (default: env.ANTHROPIC_MODEL) */
  model?: string;
  /** System prompt prepended to every run */
  systemPrompt?: string;
  /** Max agentic turns before forced stop (default: env.ORCHESTRATOR_MAX_TURNS) */
  maxTurns?: number;
  /** Temperature 0 = deterministic (default: env.ORCHESTRATOR_TEMPERATURE) */
  temperature?: number;
  /** Stream partial responses to console (default: true) */
  stream?: boolean;
  /** Callback for each tool execution (for logging/UI) */
  onToolCall?: (name: string, input: Record<string, unknown>, result: unknown) => void;
}

interface RunResult {
  /** Final text response from Claude */
  response: string;
  /** Number of agentic turns taken */
  turns: number;
  /** Total input tokens consumed */
  inputTokens: number;
  /** Total output tokens consumed */
  outputTokens: number;
  /** Wall-clock duration in ms */
  durationMs: number;
  /** All tool calls made during the run */
  toolCalls: { name: string; input: Record<string, unknown>; result: unknown }[];
}

const DEFAULT_SYSTEM = `You are an automation agent with access to a real Chrome browser (already logged into all sites), system commands, and a task engine. Execute the user's instructions precisely using the available tools. Be efficient — minimize unnecessary tool calls. When a task is complete, summarize what was done.`;

// ── Orchestrator ───────────────────────────────────────────────────

export class Orchestrator {
  private client: Anthropic;
  private kernel: Kernel;
  private opts: Required<OrchestratorOptions>;

  constructor(options: OrchestratorOptions = {}) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Add it to your .env file or set the environment variable.'
      );
    }

    this.client = new Anthropic({ apiKey });
    this.kernel = new Kernel();
    this.opts = {
      model: options.model ?? env.ANTHROPIC_MODEL,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM,
      maxTurns: options.maxTurns ?? env.ORCHESTRATOR_MAX_TURNS,
      temperature: options.temperature ?? env.ORCHESTRATOR_TEMPERATURE,
      stream: options.stream ?? true,
      onToolCall: options.onToolCall ?? (() => {}),
    };
  }

  /**
   * Run the agentic loop: send prompt to Claude, execute tool calls,
   * feed results back, repeat until Claude produces a final text response
   * or maxTurns is reached.
   */
  async run(userPrompt: string): Promise<RunResult> {
    const start = Date.now();
    const toolCalls: RunResult['toolCalls'] = [];
    let totalInput = 0;
    let totalOutput = 0;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userPrompt },
    ];

    for (let turn = 0; turn < this.opts.maxTurns; turn++) {
      const response = await this.client.messages.create({
        model: this.opts.model,
        max_tokens: 4096,
        temperature: this.opts.temperature,
        system: this.opts.systemPrompt,
        messages,
        tools: ALL_TOOLS,
      });

      totalInput += response.usage.input_tokens;
      totalOutput += response.usage.output_tokens;

      // Check if Claude wants to call tools
      if (response.stop_reason === 'tool_use') {
        // Push Claude's response (may contain text + tool_use blocks)
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool call and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            // Log any text blocks that preceded this tool call
            const textBlocks = response.content.filter(b => b.type === 'text');
            for (const tb of textBlocks) {
              if (tb.type === 'text' && tb.text.trim()) {
                console.error(`  [claude] ${tb.text.trim()}`);
              }
            }

            console.error(`  [tool] ${block.name}(${JSON.stringify(block.input).slice(0, 120)}...)`);

            const result = await this.dispatch(block.name, block.input as Record<string, unknown>);
            const resultStr = JSON.stringify(result, null, 2);

            toolCalls.push({ name: block.name, input: block.input as Record<string, unknown>, result });
            this.opts.onToolCall(block.name, block.input as Record<string, unknown>, result);

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: resultStr,
            });
          }
        }

        // Feed tool results back
        messages.push({ role: 'user', content: toolResults });

      } else {
        // Claude produced a final response (end_turn or max_tokens)
        const finalText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('\n');

        return {
          response: finalText,
          turns: turn + 1,
          inputTokens: totalInput,
          outputTokens: totalOutput,
          durationMs: Date.now() - start,
          toolCalls,
        };
      }
    }

    // Max turns reached
    return {
      response: `[orchestrator] Stopped after ${this.opts.maxTurns} turns (max limit). Task may be incomplete.`,
      turns: this.opts.maxTurns,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      durationMs: Date.now() - start,
      toolCalls,
    };
  }

  /**
   * Dispatch a tool call to the appropriate Kernel component.
   * This is the bridge between Claude's tool_use responses and the
   * existing Kernel infrastructure.
   */
  private async dispatch(name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      switch (name) {
        // ── Browser compat ───────────────────────────────────────
        case 'browser_navigate':
          return await this.kernel.sessionManager.navigate(
            input.url as string,
            input.wait_for as string | undefined,
          );
        case 'browser_extract_content':
          return await this.kernel.sessionManager.extractContent(
            input.selector as string,
            input.extract as string,
            input.attribute as string | undefined,
          );
        case 'browser_fill_form':
          return await this.kernel.sessionManager.fillForm(
            input.fields as Record<string, string>,
            input.submit_selector as string | undefined,
          );
        case 'browser_click':
          return await this.kernel.sessionManager.click(
            input.selector as string,
            (input.wait_after as boolean) ?? true,
          );
        case 'browser_screenshot':
          return await this.kernel.sessionManager.screenshot(
            input.path as string | undefined,
            (input.full_page as boolean) ?? false,
          );
        case 'browser_execute_script':
          return await this.kernel.sessionManager.executeScript(
            input.script as string,
          );
        case 'browser_get_page_info':
          return await this.kernel.sessionManager.getPageInfo();

        // ── Browser extended ─────────────────────────────────────
        case 'browser_scroll':
          return await this.kernel.actionExecutor.scroll('default', {
            direction: ((input.direction as string) ?? 'down') as 'down' | 'up' | 'left' | 'right',
            amount: (input.amount as number) ?? 500,
            selector: input.selector as string | undefined,
          });
        case 'browser_hover':
          return await this.kernel.actionExecutor.hover('default', input.selector as string);
        case 'browser_keyboard':
          return await this.kernel.actionExecutor.keyboard('default', input.key as string, {
            modifiers: input.modifiers as ('Control' | 'Shift' | 'Alt' | 'Meta')[] | undefined,
          });
        case 'browser_select_option':
          return await this.kernel.actionExecutor.select(
            'default',
            input.selector as string,
            input.value as string,
          );
        case 'browser_upload':
          return await this.kernel.actionExecutor.upload(
            'default',
            input.selector as string,
            input.file_path as string,
          );
        case 'browser_download':
          return await this.kernel.actionExecutor.download(
            'default',
            input.trigger_selector as string,
            input.download_dir as string | undefined,
          );
        case 'browser_drag':
          return await this.kernel.actionExecutor.drag(
            'default',
            input.source_selector as string,
            input.target_selector as string,
          );
        case 'browser_wait_for_text':
          return await this.kernel.actionExecutor.waitForText('default', input.text as string, {
            selector: input.selector as string | undefined,
            timeout: (input.timeout_ms as number) ?? 10000,
          });
        case 'browser_pdf':
          return await this.kernel.actionExecutor.pdf('default', input.path as string | undefined);
        case 'browser_accessibility_tree':
          return await this.kernel.actionExecutor.accessibilityTree('default');

        // ── System ───────────────────────────────────────────────
        case 'system_run_command': {
          const { stdout, stderr } = await execAsync(input.command as string, {
            shell: 'powershell.exe',
            timeout: (input.timeout_ms as number) ?? 30000,
            maxBuffer: 10 * 1024 * 1024,
            windowsHide: true,
          });
          return { status: 'success', data: stdout.trim(), details: stderr.trim() || undefined };
        }
        case 'system_disk_usage':
        case 'system_find_large_files':
        case 'system_process_list':
        case 'system_file_search':
        case 'system_network_info':
          // These are self-contained PowerShell commands — delegate via system_run_command
          // The MCP tool functions build the PS command internally; we replicate minimally
          return { status: 'error', error: `Use system_run_command with the appropriate PowerShell command instead of ${name} directly.` };

        // ── Session ──────────────────────────────────────────────
        case 'session_open': {
          const handle = await this.kernel.sessionManager.open(input.context_name as string);
          return { status: 'success', data: { contextName: handle.contextName, url: handle.page.url() } };
        }
        case 'session_warm': {
          const handle = await this.kernel.sessionManager.warm(input.context_name as string);
          return { status: 'success', data: { contextName: handle.contextName, url: handle.page.url() } };
        }

        // ── Task engine ──────────────────────────────────────────
        case 'task_plan':
          return await this.kernel.taskEngine.plan(input.spec as string);
        case 'task_run':
          return await this.kernel.taskEngine.run(input.spec as string);
        case 'task_resume':
          return await this.kernel.taskEngine.resume(input.task_id as string);
        case 'task_pause':
          return await this.kernel.taskEngine.pause(input.task_id as string);
        case 'task_commit':
          return await this.kernel.taskEngine.commit(input.task_id as string);

        // ── Task management ──────────────────────────────────────
        case 'task_list': {
          const active = this.kernel.taskEngine.listTasks();
          const checkpointed = await this.kernel.checkpointStore.list();
          const activeIds = new Set(active.map(t => t.taskId));
          const dormant = checkpointed.filter(id => !activeIds.has(id));
          return { active, dormant };
        }
        case 'task_status':
          return this.kernel.taskEngine.getStatus(input.task_id as string);
        case 'task_cancel': {
          const result = this.kernel.taskEngine.cancel(input.task_id as string);
          if (input.delete_checkpoint) {
            await this.kernel.checkpointStore.delete(input.task_id as string);
          }
          return result;
        }

        // ── Observe ──────────────────────────────────────────────
        case 'observe_start': {
          const page = await this.kernel.sessionManager.getPage(input.context_name as string);
          await this.kernel.observerBus.startObserving(input.context_name as string, page);
          return { status: 'success', data: { observing: input.context_name } };
        }
        case 'observe_stop': {
          let page;
          try { page = await this.kernel.sessionManager.getPage(input.context_name as string); } catch { /* page closed */ }
          await this.kernel.observerBus.stopObserving(input.context_name as string, page);
          return { status: 'success', data: { stopped: input.context_name } };
        }

        // ── Network ──────────────────────────────────────────────
        case 'network_learn': {
          const pg = await this.kernel.sessionManager.getPage(input.context_name as string);
          const ctx = this.kernel.sessionManager.getBrowserContext();
          if (ctx && !this.kernel.cdpBridge.getSession(input.context_name as string)) {
            await this.kernel.cdpBridge.attach(input.context_name as string, pg, ctx);
          }
          const endpoints = await this.kernel.networkOrchestrator.learnEndpoints(input.context_name as string);
          return { status: 'success', data: { endpoints, count: endpoints.length } };
        }
        case 'network_block':
          await this.kernel.networkOrchestrator.applyProfile('global', input.profile_name as string);
          return { status: 'success', data: { profile: input.profile_name } };

        // ── Evidence ─────────────────────────────────────────────
        case 'evidence_export': {
          const verification = await this.kernel.evidenceLedger.verify(input.task_id as string);
          const exported = await this.kernel.evidenceLedger.export(input.task_id as string, 'json');
          return { status: 'success', data: { exportPath: exported.path, recordCount: exported.records, hashChainValid: verification.valid } };
        }

        // ── Metrics ──────────────────────────────────────────────
        case 'metrics_report': {
          const report = input.task_id
            ? await this.kernel.metricsEngine.reportForTask(input.task_id as string)
            : await this.kernel.metricsEngine.report(
                input.window_hours ? (input.window_hours as number) * 3600000 : undefined,
              );
          return { status: 'success', data: report };
        }

        default:
          return { status: 'error', error: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      return { status: 'error', error: err.message, stack: err.stack?.split('\n').slice(0, 3) };
    }
  }

  /** Graceful shutdown — closes browser, stops monitors */
  async shutdown(): Promise<void> {
    await this.kernel.shutdown();
  }
}
