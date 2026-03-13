@echo off
:: Creates a Windows scheduled task that starts Chrome with remote debugging
:: on every login. Run this script ONCE as administrator.
::
:: After this, Chrome is always ready for the MCP server on port 9222.
:: George never has to think about it again.

set TASK_NAME=MCP-Chrome-Debug
set CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
set CHROME_ARGS=--remote-debugging-port=9222 --restore-last-session

echo.
echo Installing scheduled task: %TASK_NAME%
echo Chrome will auto-start with debug port 9222 on every login.
echo.

schtasks /create /tn "%TASK_NAME%" /tr "%CHROME_PATH% %CHROME_ARGS%" /sc onlogon /rl highest /f

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS: Chrome will auto-start with --remote-debugging-port=9222 on login.
    echo The MCP server will always find Chrome waiting on localhost:9222.
    echo.
    echo To remove later: schtasks /delete /tn "%TASK_NAME%" /f
) else (
    echo.
    echo FAILED: Run this script as Administrator.
    echo Right-click ^> Run as administrator
)

pause
