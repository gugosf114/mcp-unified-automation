/**
 * tool-defs.ts — Anthropic API-format tool definitions.
 *
 * Single source of truth for tool schemas used by the API orchestrator.
 * Mirrors the MCP tool registrations in tools/*.ts but in Anthropic's
 * messages API format (name, description, input_schema as JSON Schema).
 */

import type Anthropic from '@anthropic-ai/sdk';

type ToolDef = Anthropic.Tool;

// ── Browser compat (7) ─────────────────────────────────────────────

const browserCompat: ToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL in the authenticated Chrome browser.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        wait_for: { type: 'string', description: 'CSS selector to wait for before returning' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_extract_content',
    description: 'Extract content from the browser page using CSS selectors. Modes: text, html, links, attribute.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to match elements' },
        extract: { type: 'string', enum: ['text', 'html', 'links', 'attribute'], description: 'Extraction mode' },
        attribute: { type: 'string', description: 'Attribute name when extract=attribute' },
      },
      required: ['selector', 'extract'],
    },
  },
  {
    name: 'browser_fill_form',
    description: 'Fill form fields. Provide CSS selector:value pairs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fields: { type: 'object', additionalProperties: { type: 'string' }, description: 'Map of CSS selector to value' },
        submit_selector: { type: 'string', description: 'Submit button selector' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by CSS selector.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to click' },
        wait_after: { type: 'boolean', description: 'Wait for navigation after click (default: true)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path (default: Desktop)' },
        full_page: { type: 'boolean', description: 'Full scrollable page (default: false)' },
      },
      required: [],
    },
  },
  {
    name: 'browser_execute_script',
    description: 'Execute JavaScript in the browser page and return the result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['script'],
    },
  },
  {
    name: 'browser_get_page_info',
    description: 'Get current page URL, title, and DOM summary.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Browser extended (10) ──────────────────────────────────────────

const browserExtended: ToolDef[] = [
  {
    name: 'browser_scroll',
    description: 'Scroll the page or scroll an element into view.',
    input_schema: {
      type: 'object' as const,
      properties: {
        direction: { type: 'string', enum: ['down', 'up', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount in pixels (default: 500)' },
        selector: { type: 'string', description: 'CSS selector to scroll into view' },
      },
      required: [],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element to trigger tooltips or dropdowns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to hover' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_keyboard',
    description: 'Press a key or key combination. Supports modifiers (Ctrl, Shift, Alt, Meta).',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Key to press' },
        modifiers: { type: 'array', items: { type: 'string', enum: ['Control', 'Shift', 'Alt', 'Meta'] }, description: 'Modifier keys' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option from a <select> dropdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select> element' },
        value: { type: 'string', description: 'Option value, visible text, or index' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_upload',
    description: 'Upload a file via a file input element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the file input' },
        file_path: { type: 'string', description: 'Absolute path to the file to upload' },
      },
      required: ['selector', 'file_path'],
    },
  },
  {
    name: 'browser_download',
    description: 'Trigger a download by clicking an element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        trigger_selector: { type: 'string', description: 'CSS selector that triggers download' },
        download_dir: { type: 'string', description: 'Directory to save to (default: ~/Downloads)' },
      },
      required: ['trigger_selector'],
    },
  },
  {
    name: 'browser_drag',
    description: 'Drag an element and drop it onto another element.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_selector: { type: 'string', description: 'CSS selector of element to drag' },
        target_selector: { type: 'string', description: 'CSS selector of drop target' },
      },
      required: ['source_selector', 'target_selector'],
    },
  },
  {
    name: 'browser_wait_for_text',
    description: 'Wait for specific text to appear on the page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string', description: 'Text to wait for' },
        selector: { type: 'string', description: 'Limit search to this container' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 10000)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_pdf',
    description: 'Generate a PDF of the current page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Output file path' },
      },
      required: [],
    },
  },
  {
    name: 'browser_accessibility_tree',
    description: 'Get the accessibility tree of the current page.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── System (6) ─────────────────────────────────────────────────────

const system: ToolDef[] = [
  {
    name: 'system_run_command',
    description: 'Execute a PowerShell command. Destructive commands are blocked.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'PowerShell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'system_disk_usage',
    description: 'Get disk space for all drives.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'system_find_large_files',
    description: 'Find files larger than a threshold in a directory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: { type: 'string', description: 'Directory to search' },
        min_size_mb: { type: 'number', description: 'Minimum file size in MB (default: 100)' },
        recursive: { type: 'boolean', description: 'Search subdirectories (default: true)' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'system_process_list',
    description: 'List running processes sorted by memory or CPU usage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sort_by: { type: 'string', enum: ['memory', 'cpu'], description: 'Sort by memory or cpu' },
        top_n: { type: 'number', description: 'Number of top processes (default: 20)' },
      },
      required: [],
    },
  },
  {
    name: 'system_file_search',
    description: 'Search for files by name pattern with wildcards.',
    input_schema: {
      type: 'object' as const,
      properties: {
        directory: { type: 'string', description: 'Directory to search' },
        pattern: { type: 'string', description: 'File name pattern (e.g., *.log)' },
        recursive: { type: 'boolean', description: 'Search subdirectories (default: true)' },
      },
      required: ['directory', 'pattern'],
    },
  },
  {
    name: 'system_network_info',
    description: 'Get network information: IP addresses, DNS servers, active connections.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];

// ── Session (2) ────────────────────────────────────────────────────

const session: ToolDef[] = [
  {
    name: 'session_open',
    description: 'Open or reuse a named browser session (tab). Sessions share the same Chrome profile.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context_name: { type: 'string', description: 'Session name (e.g., linkedin, gmail)' },
      },
      required: ['context_name'],
    },
  },
  {
    name: 'session_warm',
    description: 'Open a named session AND navigate to its home URL (configured via env var).',
    input_schema: {
      type: 'object' as const,
      properties: {
        context_name: { type: 'string', description: 'Session name to warm up' },
      },
      required: ['context_name'],
    },
  },
];

// ── Task (5) ───────────────────────────────────────────────────────

const task: ToolDef[] = [
  {
    name: 'task_plan',
    description: 'Parse and validate a task spec (JSON) without executing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spec: { type: 'string', description: 'JSON task specification string' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'task_run',
    description: 'Execute a task from a JSON spec. Returns immediately if an approval gate is hit.',
    input_schema: {
      type: 'object' as const,
      properties: {
        spec: { type: 'string', description: 'JSON task specification string' },
      },
      required: ['spec'],
    },
  },
  {
    name: 'task_resume',
    description: 'Resume a paused or interrupted task from its last checkpoint.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to resume' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'task_pause',
    description: 'Pause a running task. Takes effect after the current step completes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to pause' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'task_commit',
    description: 'Approve a pending approval gate and continue task execution.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to approve' },
      },
      required: ['task_id'],
    },
  },
];

// ── Task management (3) ────────────────────────────────────────────

const taskManagement: ToolDef[] = [
  {
    name: 'task_list',
    description: 'List all known tasks — active and checkpointed.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'task_status',
    description: 'Get detailed status of a specific task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to check' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'task_cancel',
    description: 'Cancel a task. Checkpoint is preserved for later resume.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'Task ID to cancel' },
        delete_checkpoint: { type: 'boolean', description: 'Also delete checkpoint (default: false)' },
      },
      required: ['task_id'],
    },
  },
];

// ── Observe (2) ────────────────────────────────────────────────────

const observe: ToolDef[] = [
  {
    name: 'observe_start',
    description: 'Start observing DOM mutations and form changes on a named session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context_name: { type: 'string', description: 'Session name to observe' },
      },
      required: ['context_name'],
    },
  },
  {
    name: 'observe_stop',
    description: 'Stop observing DOM mutations on a named session.',
    input_schema: {
      type: 'object' as const,
      properties: {
        context_name: { type: 'string', description: 'Session name to stop observing' },
      },
      required: ['context_name'],
    },
  },
];

// ── Network (2) ────────────────────────────────────────────────────

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

// ── Evidence (1) ───────────────────────────────────────────────────

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

// ── Metrics (1) ────────────────────────────────────────────────────

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

// ── Export all 38 tools ────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [
  ...browserCompat,
  ...browserExtended,
  ...system,
  ...session,
  ...task,
  ...taskManagement,
  ...observe,
  ...network,
  ...evidence,
  ...metrics,
];
