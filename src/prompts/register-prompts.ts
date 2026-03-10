import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP Prompts — server-defined prompt templates for common workflows.
 *
 * These appear as available prompts in the MCP client and can be invoked
 * with parameters to generate structured task specs.
 */
export function registerPrompts(server: McpServer) {

  server.prompt(
    "batch-scrape",
    "Generate a task spec for scraping a list of URLs. Extracts content using " +
    "a CSS selector from each URL, with screenshots and error handling.",
    {
      urls: z.string().describe("Comma-separated list of URLs to scrape"),
      selector: z.string().default("body").describe("CSS selector to extract from each page"),
      extract_mode: z.enum(["text", "html", "links"]).default("text"),
    },
    ({ urls, selector, extract_mode }) => {
      const urlList = urls.split(',').map(u => u.trim()).filter(Boolean);
      const spec = {
        taskId: `scrape-${Date.now()}`,
        context: 'default',
        mode: 'auto',
        entities: {
          source: 'provided',
          items: urlList.map(url => ({ url, selector, extractMode: extract_mode })),
        },
        steps: ['goto', 'extract', 'screenshot'],
        idempotency: { key: '{{url}}' },
        onError: ['screenshot', 'dom_dump', 'checkpoint_and_continue'],
      };

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Here's a batch scrape task spec for ${urlList.length} URLs. ` +
              `Review it with task.plan, then execute with task.run:\n\n` +
              '```json\n' + JSON.stringify(spec, null, 2) + '\n```',
          },
        }],
      };
    }
  );

  server.prompt(
    "linkedin-apply",
    "Generate a task spec for LinkedIn Easy Apply batch processing. " +
    "Processes a list of job URLs through the full apply pipeline.",
    {
      job_urls: z.string().describe("Comma-separated LinkedIn job URLs"),
      resume_path: z.string().optional().describe("Path to resume file for upload"),
    },
    ({ job_urls, resume_path }) => {
      const urls = job_urls.split(',').map(u => u.trim()).filter(Boolean);
      const spec = {
        taskId: `linkedin-apply-${Date.now()}`,
        context: 'linkedin',
        mode: 'semi_auto',
        entities: {
          source: 'provided',
          items: urls.map(url => ({
            url,
            jobId: url.split('/').pop(),
            resumePath: resume_path,
          })),
        },
        steps: [
          'open_job',
          'validate_requirements',
          'fill_easy_apply_fields',
          'attach_resume_if_missing',
          'pre_submit_snapshot',
          'approval_gate',
          'submit',
          'capture_confirmation',
        ],
        idempotency: { key: '{{jobId}}' },
        onError: ['screenshot', 'dom_dump', 'checkpoint_and_continue'],
      };

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `LinkedIn Easy Apply task for ${urls.length} jobs. ` +
              `Mode is semi_auto — will pause at approval_gate before each submit.\n\n` +
              '```json\n' + JSON.stringify(spec, null, 2) + '\n```',
          },
        }],
      };
    }
  );

  server.prompt(
    "evidence-audit",
    "Review the evidence chain for a completed task. Verifies hash chain " +
    "integrity and summarizes all captured artifacts.",
    {
      task_id: z.string().describe("Task ID to audit"),
    },
    ({ task_id }) => {
      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Audit the evidence chain for task "${task_id}":\n\n` +
              `1. Run evidence_export to get all records\n` +
              `2. Verify the hash chain is intact\n` +
              `3. Summarize screenshots and actions\n` +
              `4. Flag any gaps or anomalies\n\n` +
              `Start by calling evidence_export with task_id="${task_id}".`,
          },
        }],
      };
    }
  );
}
