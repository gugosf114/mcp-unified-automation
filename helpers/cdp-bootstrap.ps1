# cdp-bootstrap.ps1
# One-shot setup script for Chrome CDP + Playwright on any Windows machine.
#
# What it does:
#   1. Checks Node.js — offers to install if missing
#   2. Creates %USERPROFILE%\.cdp\ folder
#   3. Installs playwright-core there via npm
#   4. Writes cdp.js helper module
#   5. Auto-detects Chrome install location
#   6. Writes launch-chrome-cdp.ps1 to Desktop
#   7. Kills any existing Chrome processes
#   8. Launches Chrome with CDP enabled
#   9. Verifies CDP at 127.0.0.1:9222
#  10. Runs test screenshot
#
# Usage (from PowerShell):
#   .\cdp-bootstrap.ps1
#
# Remote install (one-liner):
#   iwr -useb https://raw.githubusercontent.com/gugosf114/lavrentiy/main/cdp-bootstrap.ps1 | iex

$ErrorActionPreference = 'Stop'
$CDP_DIR = Join-Path $env:USERPROFILE '.cdp'
$CDP_PORT = 9222

Write-Host "=== CDP Bootstrap ===" -ForegroundColor Cyan

# --- Step 1: Node.js check ---
Write-Host "[1/10] Checking Node.js..." -NoNewline
try {
    $nodeVer = node --version 2>$null
    Write-Host " $nodeVer OK" -ForegroundColor Green
} catch {
    Write-Host " NOT FOUND" -ForegroundColor Red
    Write-Host "  Node.js is required. Download LTS from https://nodejs.org/" -ForegroundColor Yellow
    Write-Host "  After installing, re-run this script." -ForegroundColor Yellow
    exit 1
}

# --- Step 2: Create .cdp folder ---
Write-Host "[2/10] Creating $CDP_DIR..." -NoNewline
if (-not (Test-Path $CDP_DIR)) {
    New-Item -ItemType Directory -Path $CDP_DIR -Force | Out-Null
}
Write-Host " OK" -ForegroundColor Green

# --- Step 3: Install playwright-core ---
Write-Host "[3/10] Installing playwright-core (this takes ~30-60 sec)..." -NoNewline
Push-Location $CDP_DIR
$pkgJson = @{
    name = "cdp-helpers"
    version = "1.0.0"
    private = $true
    dependencies = @{ "playwright-core" = "^1.48.0" }
} | ConvertTo-Json -Depth 3
Set-Content -Path (Join-Path $CDP_DIR 'package.json') -Value $pkgJson -Encoding UTF8
npm install --silent 2>&1 | Out-Null
Pop-Location
if (Test-Path (Join-Path $CDP_DIR 'node_modules\playwright-core\package.json')) {
    Write-Host " OK" -ForegroundColor Green
} else {
    Write-Host " FAILED" -ForegroundColor Red
    exit 2
}

# --- Step 4: Get cdp.js (download from GitHub if not local) ---
Write-Host "[4/10] Installing cdp.js..." -NoNewline
$CDP_JS = Join-Path $CDP_DIR 'cdp.js'
$CDP_JS_URL = 'https://raw.githubusercontent.com/gugosf114/mcp-unified-automation/main/helpers/cdp.js'
if (-not (Test-Path $CDP_JS)) {
    try {
        Invoke-WebRequest -Uri $CDP_JS_URL -OutFile $CDP_JS -UseBasicParsing -ErrorAction Stop
        Write-Host " downloaded OK" -ForegroundColor Green
    } catch {
        Write-Host " FAILED to download from GitHub" -ForegroundColor Red
        Write-Host "  $_" -ForegroundColor Red
        exit 3
    }
} else {
    Write-Host " already present OK" -ForegroundColor Green
}

# --- Step 5: Set PWCORE_PATH environment variable (user scope) ---
Write-Host "[5/10] Setting PWCORE_PATH env var..." -NoNewline
$pwcorePath = Join-Path $CDP_DIR 'node_modules\playwright-core'
[Environment]::SetEnvironmentVariable('PWCORE_PATH', $pwcorePath, 'User')
$env:PWCORE_PATH = $pwcorePath
Write-Host " OK" -ForegroundColor Green

# --- Step 6: Find Chrome ---
Write-Host "[6/10] Finding Chrome install..." -NoNewline
$chromeCandidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:LocalAppData}\Google\Chrome\Application\chrome.exe"
)
$chromePath = $null
foreach ($p in $chromeCandidates) {
    if (Test-Path $p) { $chromePath = $p; break }
}
if (-not $chromePath) {
    # Try Edge as fallback
    $edgeCandidates = @(
        "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($p in $edgeCandidates) {
        if (Test-Path $p) { $chromePath = $p; break }
    }
}
if (-not $chromePath) {
    Write-Host " NOT FOUND (Chrome or Edge)" -ForegroundColor Red
    exit 4
}
Write-Host " $chromePath" -ForegroundColor Green

# --- Step 7: Write Chrome launcher to Desktop ---
Write-Host "[7/10] Writing launch-chrome-cdp.ps1 to Desktop..." -NoNewline
$userDataDir = if ($chromePath -like '*msedge*') {
    Join-Path $env:LocalAppData 'Microsoft\Edge\User Data'
} else {
    Join-Path $env:LocalAppData 'Google\Chrome\User Data'
}
$launcherContent = @"
# Launches Chrome/Edge with CDP on port $CDP_PORT
# ALWAYS use 127.0.0.1 to connect, NEVER localhost (Windows IPv6 bug)
Start-Process '$chromePath' -ArgumentList ``
  '--remote-debugging-port=$CDP_PORT', ``
  '--user-data-dir=$userDataDir', ``
  '--restore-last-session'
"@
$launcherPath = Join-Path $env:USERPROFILE 'Desktop\launch-chrome-cdp.ps1'
Set-Content -Path $launcherPath -Value $launcherContent -Encoding UTF8
Write-Host " OK" -ForegroundColor Green

# --- Step 8: Kill existing Chrome/Edge, launch with CDP ---
Write-Host "[8/10] Restarting browser with CDP enabled..." -NoNewline
$procName = if ($chromePath -like '*msedge*') { 'msedge' } else { 'chrome' }
Get-Process -Name $procName -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
Start-Process $chromePath -ArgumentList "--remote-debugging-port=$CDP_PORT","--user-data-dir=$userDataDir","--restore-last-session"
Write-Host " OK" -ForegroundColor Green

# --- Step 9: Verify CDP ---
Write-Host "[9/10] Waiting for CDP to respond..." -NoNewline
$cdpOk = $false
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$CDP_PORT/json/version" -TimeoutSec 2 -ErrorAction Stop
        Write-Host " OK ($($resp.Browser))" -ForegroundColor Green
        $cdpOk = $true
        break
    } catch {
        Write-Host "." -NoNewline
    }
}
if (-not $cdpOk) {
    Write-Host " FAILED — CDP not responding at 127.0.0.1:$CDP_PORT" -ForegroundColor Red
    exit 5
}

# --- Step 10: Test screenshot via cdp.js ---
Write-Host "[10/10] Running test screenshot..." -NoNewline
$testOut = Join-Path $env:USERPROFILE 'Desktop\cdp-test.png'
$testResult = node $CDP_JS screenshot 'https://example.com' $testOut 2>&1
if ($LASTEXITCODE -eq 0 -and (Test-Path $testOut)) {
    Write-Host " OK" -ForegroundColor Green
    Write-Host ""
    Write-Host "=== Setup complete ===" -ForegroundColor Cyan
    Write-Host "Test screenshot saved to: $testOut"
    Write-Host "Helper module at: $CDP_JS"
    Write-Host "playwright-core at: $pwcorePath"
    Write-Host ""
    Write-Host "Quick commands:" -ForegroundColor Yellow
    Write-Host "  node `"$CDP_JS`" ping"
    Write-Host "  node `"$CDP_JS`" screenshot https://example.com out.png"
    Write-Host "  node `"$CDP_JS`" text https://example.com"
    Write-Host ""
    Write-Host "Chrome launcher at: $launcherPath"
    Write-Host "(Run it anytime to restart Chrome with CDP enabled)"
} else {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host "  $testResult" -ForegroundColor Red
    exit 6
}
