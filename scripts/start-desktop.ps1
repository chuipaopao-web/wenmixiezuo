$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$logDirectory = Join-Path $projectRoot 'data\logs'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$stopRequestPath = Join-Path $controlDirectory 'desktop-stop.request.json'
$expectedReleaseId = (Get-Content -LiteralPath (Join-Path $projectRoot 'RELEASE_ID') -Raw).Trim()

# Explorer may not have inherited recently saved user variables.
# Import only allowlisted Wenmi settings; never print or persist their values.
$wenmiEnvironmentNames = 'WENMI_MODEL_MODE', 'WENMI_CODEX_MODEL', 'WENMI_CODEX_TIMEOUT_MS', 'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_AGENT_PLAN_GLM_MODEL', 'WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_K27_MODEL', 'WENMI_ARK_AGENT_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_AGENT_PLAN_DEEPSEEK_FLASH_MODEL', 'WENMI_ARK_AGENT_PLAN_MINIMAX_MODEL', 'WENMI_PROMPT_VIEW_PASSWORD'
foreach ($name in $wenmiEnvironmentNames) {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}

# Some hosts inject both Path and PATH. Windows PowerShell Start-Process
# rejects that duplicate environment key, so keep only the standard Path key.
$processEnvironmentKeys = [Environment]::GetEnvironmentVariables('Process').Keys
if (($processEnvironmentKeys -ccontains 'Path') -and ($processEnvironmentKeys -ccontains 'PATH')) {
  $pathValue = [Environment]::GetEnvironmentVariable('Path', 'Process')
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  [Environment]::SetEnvironmentVariable('Path', $pathValue, 'Process')
}

Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force -Path $controlDirectory, $logDirectory | Out-Null
Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue

function Test-WenmiReady {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/health' -TimeoutSec 2
    $web = Invoke-WebRequest -Uri 'http://127.0.0.1:43110' -UseBasicParsing -TimeoutSec 2
    return (
      $health.data.status -eq 'ok' -and
      $health.data.releaseId -eq $expectedReleaseId -and
      $web.StatusCode -eq 200 -and
      $web.Content -like '*<div id="root"></div>*'
    )
  } catch {
    return $false
  }
}

function Test-WenmiBuildStale {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $true }
  try {
    $record = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8 | ConvertFrom-Json
    if ($record.schemaVersion -ne 1 -or $record.entryPoint -ne 'scripts/start.mjs') { return $true }
    $startedAt = [DateTimeOffset]::Parse([string]$record.startedAtUtc).UtcDateTime
    $watchedFiles = @(
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'apps\api\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'apps\web\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'apps\worker\src') -Recurse -File
      Get-Item -LiteralPath (Join-Path $projectRoot 'apps\api\dist\main.js') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'apps\web\dist\index.html') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'apps\worker\dist\main.js') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'package.json')
      Get-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json')
    )
    return $null -ne ($watchedFiles | Where-Object { $_.LastWriteTimeUtc -gt $startedAt } | Select-Object -First 1)
  } catch {
    return $true
  }
}

if (Test-WenmiReady) {
  if (Test-WenmiBuildStale) {
    & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  } else {
    if ($env:WENMI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
    Write-Host 'Wenmi Writing is already running. The workspace is open.'
    exit 0
  }
}

$occupiedPorts = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
  Where-Object { $_.Port -in 43110, 43111 } | Select-Object -ExpandProperty Port -Unique
if ($occupiedPorts) {
  throw "Wenmi ports are occupied: $($occupiedPorts -join ', ')"
}

& npm.cmd run migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Startup stopped.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed. Startup stopped.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logDirectory "desktop-$timestamp.out.log"
$stderrPath = Join-Path $logDirectory "desktop-$timestamp.err.log"
$nodePath = (Get-Command node.exe).Source
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
$launcherProcess = Start-Process -FilePath $nodePath `
  -ArgumentList @('scripts/start.mjs') `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru
if ($null -eq $launcherProcess) { throw 'Wenmi process could not be started.' }
$processDeadline = (Get-Date).AddSeconds(10)
$publishedLauncher = $null
while ((Get-Date) -lt $processDeadline -and $null -eq $publishedLauncher) {
  Start-Sleep -Milliseconds 100
  if (Test-Path -LiteralPath $pidPath) {
    try { $publishedLauncher = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8 | ConvertFrom-Json } catch { $publishedLauncher = $null }
  }
}
if ($null -eq $publishedLauncher -or [int]$publishedLauncher.processId -ne $launcherProcess.Id) {
  if (-not $launcherProcess.HasExited) { $launcherProcess.Kill() }
  throw 'Wenmi process started but its verified process record was not published.'
}
$childProcess = Get-Process -Id $launcherProcess.Id -ErrorAction SilentlyContinue
if ($null -eq $childProcess) { throw 'Wenmi process exited before startup verification completed.' }

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not (Test-WenmiReady)) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-WenmiReady)) {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw "Wenmi did not start within 30 seconds. See $stderrPath"
}

$runtimeSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$browserHeaders = @{ Origin = 'http://127.0.0.1:43110'; 'Sec-Fetch-Site' = 'same-site' }
try {
  Invoke-WebRequest -Uri 'http://127.0.0.1:43111/api/v1/runtime/session' -Method Post `
    -Headers $browserHeaders -ContentType 'application/json' -Body '{}' -WebSession $runtimeSession `
    -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw 'The local runtime session could not be established. Startup stopped safely.'
}

$workerDeadline = (Get-Date).AddSeconds(15)
do {
  try {
    $readiness = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/api/v1/runtime/readiness' `
      -Headers $browserHeaders -WebSession $runtimeSession -TimeoutSec 2
  } catch {
    $readiness = $null
  }
  if ($readiness.data.worker -eq 'ready') { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $workerDeadline)

if ($null -eq $readiness -or $readiness.data.worker -ne 'ready') {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw 'The Worker did not become ready. Startup stopped safely.'
}

if ($env:WENMI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
Write-Host 'Wenmi Writing is ready at http://127.0.0.1:43110'
Write-Host 'Double-click the stop entry when you want to stop the app.'
