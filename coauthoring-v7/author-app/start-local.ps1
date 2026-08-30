param(
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $appRoot '..\..'))
$port = 43180
$address = "http://127.0.0.1:$port/"
$apiAddress = 'http://127.0.0.1:43111/health'
$logPath = Join-Path $appRoot 'start-local.log'

function Write-V7LaunchLog {
  param([string]$Message)
  $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message" -Encoding utf8
}

trap {
  $failureMessage = $_.Exception.Message
  Write-V7LaunchLog "Launch failed: $failureMessage"
  $popup = New-Object -ComObject WScript.Shell
  [void]$popup.Popup("Wenmi Writing V7 failed to start.`n$failureMessage`n`nLog: $logPath", 0, 'Wenmi Writing V7', 16)
  exit 1
}

function Test-V7AuthorPage {
  try {
    $response = Invoke-WebRequest -Uri $address -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-V7Api {
  try {
    $response = Invoke-WebRequest -Uri $apiAddress -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExecutable = if ($null -ne $nodeCommand) {
  $nodeCommand.Source
} else {
  Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $nodeExecutable)) {
  throw 'Node.js was not found. Load the local Codex workspace dependencies first.'
}

Write-V7LaunchLog "Launch requested. NoBrowser=$NoBrowser"

# The V7 author app stores tasks and confirmed books through the shared API.
# Always pass through the verified platform launcher: it exits quickly when the
# current build is fresh, and safely rebuilds/restarts when V7 backend sources
# changed. A plain health check cannot prove the running API contains new code.
$platformLauncher = Join-Path $projectRoot 'scripts\start-desktop.ps1'
if (-not (Test-Path -LiteralPath $platformLauncher)) {
  throw "Platform launcher was not found: $platformLauncher"
}
$previousNoBrowser = $env:WENMI_NO_BROWSER
$env:WENMI_NO_BROWSER = '1'
try {
  $platformProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $platformLauncher
  ) -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
} finally {
  $env:WENMI_NO_BROWSER = $previousNoBrowser
}
$platformFinished = $false
for ($attempt = 0; $attempt -lt 720; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  if ($null -ne $platformProcess -and $platformProcess.HasExited) {
    $platformFinished = $true
    break
  }
}
if (-not $platformFinished -or $platformProcess.ExitCode -ne 0 -or -not (Test-V7Api)) {
  throw 'The shared API did not start with the current V7 backend build. Check the latest file under data\logs\desktop-*.err.log.'
}
Write-V7LaunchLog 'Shared API build freshness and health verified.'

if (-not (Test-V7AuthorPage)) {
  $viteEntry = Join-Path $projectRoot 'node_modules\vite\bin\vite.js'
  $viteConfig = Join-Path $appRoot 'vite.config.mjs'
  if (-not (Test-Path -LiteralPath $viteEntry)) {
    throw "Vite was not found: $viteEntry"
  }

  $arguments = @(
    $viteEntry,
    '--config', $viteConfig,
    '--configLoader', 'native',
    '--host', '127.0.0.1',
    '--port', "$port",
    '--strictPort'
  )

  $process = Start-Process -FilePath $nodeExecutable -ArgumentList $arguments -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru
  Write-V7LaunchLog "Local server process started. PID=$($process.Id)"
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if (Test-V7AuthorPage) {
      $ready = $true
      break
    }
    if ($process.HasExited) {
      break
    }
  }

  if (-not $ready) {
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id
    }
    throw 'The V7 author app did not become available on port 43180.'
  }
  Write-V7LaunchLog 'Cold start completed.'
} else {
  Write-V7LaunchLog 'Existing local server detected and reused.'
}

if (-not $NoBrowser) {
  $browserStart = New-Object System.Diagnostics.ProcessStartInfo
  $browserStart.FileName = $address
  $browserStart.UseShellExecute = $true
  $openedBrowser = [System.Diagnostics.Process]::Start($browserStart)
  if ($null -eq $openedBrowser) {
    throw 'The Windows default browser did not accept the open request.'
  }
  Write-V7LaunchLog 'The Windows default browser was asked to open the page.'
}

Write-Output $address
