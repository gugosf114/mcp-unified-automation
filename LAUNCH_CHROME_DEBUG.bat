@echo off
REM Launch Chrome with remote debugging enabled so the MCP server can attach to it.
REM This opens YOUR Chrome with all your logins, cookies, and sessions intact.
REM The MCP server connects via CDP (Chrome DevTools Protocol) — no new window.

start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

echo Chrome started with remote debugging on port 9222.
echo The MCP server will attach to this browser instance.
echo.
echo DO NOT close this Chrome window while using automation tools.
