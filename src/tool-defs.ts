/**
 * tool-defs.ts — Anthropic API-format tool definitions.
 *
 * Single source of truth for tool schemas used by the API orchestrator.
 * Mirrors the MCP tool registrations in tools/*.ts but in Anthropic's
 * messages API format (name, description, input_schema as JSON Schema).
 *
 * v3.0.0 — 12 compound tools replacing the previous 38 granular tools.
 */

import type Anthropic from '@anthropic-ai/sdk';

type ToolDef = Anthropic.Tool;

// ── Web (4) ───────────────────────────────────────────────────────

const web: ToolDef[] = [
  {
    name: 'web_read',
    description:
      'Navigate to a URL (or read the current page) and extract content in one call. ' +
      'Returns page title, URL, DOM summary, and extracted content. ' +
      'Operates in the user\'s authenticated Chrome browser with real login sessions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to navigate to. Omit to read the current page.' },
        selector: { type: 'string', description: 'CSS selector to narrow extraction scope (default: body)' },
        extract: {
          type: 'string',
          enum: ['text', 'html', 'links', 'all'],
          description: "What to extract. 'all' returns text + links + DOM summary. Default: 'all'",
        },
        attribute: { type: 'string', description: "Attribute name when extract='attribute'" },
        wait_for: { type: 'string', description: 'CSS selector to wait for before extracting' },
        session: { type: 'string', description: "Named session to operate on (default: 'default')" },
      },
      required: [],
    },
  },
  {
    name: 'web_act',
    description:
      'Execute an ordered list of browser actions in the authenticated Chrome browser. ' +
      'Actions run sequentially — stops on first error and auto-screenshots the failure. ' +
      'Supports: click, fill, type, select, scroll, hover, keyboard, upload, download, ' +
      'drag, wait_for_text, wait_for_selector, screenshot, pdf.',
    input_schema: {
      type: 'object' as const,
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          description: 'Ordered list of browser actions to execute sequentially',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: [
                  'click', 'fill', 'type', 'select', 'scroll', 'hover',
                  'keyboard', 'upload', 'download', 'drag', 'wait_for_text',
                  'wait_for_selector', 'screenshot', 'pdf',
                ],
              },
              selector: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              key: { type: 'string' },
              modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta'] } },
              direction: { type: 'string', enum: ['down', 'up', 'left', 'right'] },
              amount: { type: 'number' },
              path: { type: 'string' },
              source_selector: { type: 'string' },
              target_selector: { type: 'string' },
              timeout_ms: { type: 'number' },
              full_page: { type: 'boolean' },
              wait_for_nav: { type: 'boolean' },
              delay: { type: 'number' },
            },
            required: ['action'],
          },
        },
        session: { type: 'string', description: "Named session to operate on (default: 'default')" },
        screenshot_on_error: { type: 'boolean', description: 'Auto-screenshot when an action fails (default: true)' },
        screenshot_final: { type: 'boolean', description: 'Screenshot after all actions complete (default: false)' },
      },
      required: ['actions'],
    },
  },
  {
    name: 'web_watch',
    description:
      'Observe the current page state in the authenticated Chrome browser. ' +
      'Returns any combination of: screenshot, accessibility tree, and page info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        include: {
          type: 'array',
          items: { type: 'string', enum: ['screenshot', 'accessibility_tree', 'page_info'] },
          description: "What to include (default: ['screenshot', 'page_info'])",
        },
        screenshot_path: { type: 'string', description: 'Save screenshot to this path' },
        full_page: { type: 'boolean', description: 'Full-page screenshot (default: false)' },
        session: { type: 'string', description: "Named session to observe (default: 'default')" },
      },
      required: [],
    },
  },
  {
    name: 'web_script',
    description:
      'Execute JavaScript in the authenticated Chrome browser page and return the result. ' +
      'Runs in the real page context with full DOM access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute in the page context' },
        session: { type: 'string', description: "Named session to execute in (default: 'default')" },
      },
      required: ['script'],
    },
  },
];

// ── Session (1) ──────────────────────────────────────────────────

const session: ToolDef[] = [
  {
    name: 'session',
    description:
      'Manage named browser sessions (tabs). All sessions share the same Chrome profile. ' +
      'Commands: open (create/reuse tab), warm (open + navigate to home URL), list, close.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: ['open', 'warm', 'list', 'close'],
          description: 'Session operation to perform',
        },
        name: { type: 'string', description: "Session name (required for open/warm/close). E.g., 'linkedin', 'gmail'" },
      },
      required: ['command'],
    },
  },
];

// ── Task (1) ─────────────────────────────────────────────────────

const task: ToolDef[] = [
  {
    name: 'task',
    description:
      'Manage automated tasks. Commands: plan (validate spec), run (execute), ' +
      'resume (from checkpoint), pause, commit (approve gate), status, list, cancel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: ['plan', 'run', 'resume', 'pause', 'commit', 'status', 'list', 'cancel'],
          description: 'Task operation',
        },
        spec: { type: 'string', description: 'JSON task specification (required for plan/run)' },
        task_id: { type: 'string', description: 'Task ID (required for resume/pause/commit/status/cancel)' },
        delete_checkpoint: { type: 'boolean', description: 'Also delete checkpoint on cancel (prevents resume)' },
      },
      required: ['command'],
    },
  },
];

// ── System (1) ───────────────────────────────────────────────────

const system: ToolDef[] = [
  {
    name: 'system',
    description: 'Execute a PowerShell command and return stdout/stderr. Destructive commands are blocked. Timeout defaults to 30 seconds.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'PowerShell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
  },
];

// ── Observe (1) ──────────────────────────────────────────────────

const observe: ToolDef[] = [
  {
    name: 'observe',
    description:
      'Start or stop observing DOM mutations and form changes on a named session\'s page. ' +
      'Injects MutationObserver and event listeners.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', enum: ['start', 'stop'], description: 'Start or stop observing' },
        context_name: { type: 'string', description: 'Session name to observe' },
      },
      required: ['command', 'context_name'],
    },
  },
];

// ── Network (2) ──────────────────────────────────────────────────

const network: ToolDef[] = [
  {
    name: 'network_learn',
    description: 'Discover JSON API endpoints from captured network traffic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context_name: { type: 'string', description: 'Session name to analyze' },
      },
      required: ['context_name'],
    },
  },
  {
    name: 'network_block',
    description: 'Apply a network blocking profile: none, minimal, or aggressive.',
    input_schema: {
      type: 'object' as const,
      properties: {
        profile_name: { type: 'string', description: 'Blocking profile name' },
      },
      required: ['profile_name'],
    },
  },
];

// ── Evidence (1) ─────────────────────────────────────────────────

const evidence: ToolDef[] = [
  {
    name: 'evidence_export',
    description: 'Export all evidence records for a task as JSON with hash chain verification.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to export evidence for' },
        format: { type: 'string', enum: ['json'], description: 'Export format (default: json)' },
      },
      required: ['task_id'],
    },
  },
];

// ── Metrics (1) ──────────────────────────────────────────────────

const metrics: ToolDef[] = [
  {
    name: 'metrics_report',
    description: 'Get aggregated metrics: success rate, latencies, retry counts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        window_hours: { type: 'number', description: 'Time window in hours (default: all time)' },
        task_id: { type: 'string', description: 'Filter to a specific task ID' },
      },
      required: [],
    },
  },
];

// ── Export all 12 tools ─────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [
  ...web,
  ...session,
  ...task,
  ...system,
  ...observe,
  ...network,
  ...evidence,
  ...metrics,
];
