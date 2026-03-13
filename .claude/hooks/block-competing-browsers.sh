#!/bin/bash
# Block any tool call from Playwright MCP plugin or Chrome DevTools MCP.
# These launch separate, unauthenticated browsers — use unified-automation instead.

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')

if [[ "$TOOL_NAME" =~ ^mcp__plugin_playwright_playwright__ ]] || [[ "$TOOL_NAME" =~ ^mcp__chrome-devtools__ ]]; then
  echo "{
    \"hookSpecificOutput\": {
      \"hookEventName\": \"PreToolUse\",
      \"permissionDecision\": \"deny\",
      \"permissionDecisionReason\": \"BLOCKED: $TOOL_NAME launches a separate browser. Use mcp__unified-automation__ tools instead — they connect to the real authenticated Chrome.\"
    }
  }"
fi

exit 0
