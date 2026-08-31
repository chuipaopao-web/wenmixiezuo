$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$logDirectory = Join-Path $projectRoot 'data\logs'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$stopRequestPath = Join-Path $controlDirectory 'desktop-stop.request.json'
$expectedReleaseId = (Get-Content -LiteralPath (Join-Path $projectRoot 'RELEASE_ID') -Raw).Trim()

# Explorer may not have inherited recently saved user variables.
# Import only allowlisted Wenmi settings; never print or persist their values.
$wenmiEnvironmentNames = 'WENMI_MODEL_MODE', 'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_FLASH_MODEL', 'WENMI_ARK_CODING_PLAN_DOUBAO_MODEL', 'WENMI_ARK_CODING_PLAN_KIMI_MODEL', 'WENMI_ARK_CODING_PLAN_KIMI_K27_MODEL', 'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_IMAGE_API_KEY', 'WENMI_ARK_IMAGE_MODEL_ID', 'WENMI_V7_FORMALIZATION_ENABLED', 'WENMI_PROMPT_VIEW_PASSWORD'
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
    # The first local request may include antivirus and Vite cold-start work. The
    # surrounding deadline remains the real startup bound, so avoid a false failure here.
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/health' -TimeoutSec 5
    $web = Invoke-WebRequest -Uri 'http://127.0.0.1:43110' -UseBasicParsing -TimeoutSec 5
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
    $recordRaw = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8
    $record = $recordRaw | ConvertFrom-Json
    if ($record.schemaVersion -ne 1 -or $record.entryPoint -ne 'scripts/start.mjs') { return $true }
    $recordDocument = [System.Text.Json.JsonDocument]::Parse($recordRaw)
    $startedAtText = $recordDocument.RootElement.GetProperty('startedAtUtc').GetString()
    $recordDocument.Dispose()
    $startedAt = [DateTimeOffset]::Parse($startedAtText).UtcDateTime
    $watchedFiles = @(
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'apps\api\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'coauthoring-v7\author-app\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'coauthoring-v7\admin-console\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'apps\worker\src') -Recurse -File
      Get-ChildItem -LiteralPath (Join-Path $projectRoot 'coauthoring-v7\backend') -Recurse -File |
        Where-Object { $_.FullName -notmatch '[\\/](?:dist|node_modules)[\\/]' }
      Get-Item -LiteralPath (Join-Path $projectRoot 'apps\api\dist\main.js') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'artifacts\v7-static-releases\current.json') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'apps\worker\dist\main.js') -ErrorAction SilentlyContinue
      Get-Item -LiteralPath (Join-Path $projectRoot 'package.json')
      Get-Item -LiteralPath (Join-Path $projectRoot 'package-lock.json')
    )
    return $null -ne ($watchedFiles | Where-Object { $_.LastWriteTimeUtc -gt $startedAt } | Select-Object -First 1)
  } catch {
    return $true
  }
}

function Resolve-WenmiNodePath {
  $candidates = @()
  $pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $pathNode) { $candidates += $pathNode.Source }
  $candidates += (Join-Path $projectRoot 'data\cache\runtime\node-v24.16.0-win-x64\node.exe')

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      $version = (& $candidate --version 2>$null).Trim()
      if ($version -match '^v(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$' -and
        [int]$Matches.major -eq 24 -and [int]$Matches.minor -ge 16) {
        $candidateNpm = Join-Path (Split-Path -Parent $candidate) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $candidateNpm)) { continue }
        return [System.IO.Path]::GetFullPath($candidate)
      }
    } catch {
      # Try the next approved local runtime candidate.
    }
  }
  throw 'Node.js 24.16 or newer in the 24.x line is required. The Wenmi portable runtime is missing.'
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

$nodePath = Resolve-WenmiNodePath
$nodeDirectory = Split-Path -Parent $nodePath
$npmPath = Join-Path $nodeDirectory 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) {
  throw "The approved Node.js runtime does not include npm.cmd: $nodeDirectory"
}
$env:Path = "$nodeDirectory;$env:Path"

# V7 formalization must continue outside the browser page lifecycle.
# Enable the reliable consumer before spawning API and Worker.
if ([string]::IsNullOrWhiteSpace($env:WENMI_V7_FORMALIZATION_ENABLED)) {
  $env:WENMI_V7_FORMALIZATION_ENABLED = 'true'
}

& $npmPath run migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Startup stopped.' }
& $npmPath run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed. Startup stopped.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logDirectory "desktop-$timestamp.out.log"
$stderrPath = Join-Path $logDirectory "desktop-$timestamp.err.log"
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

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline -and -not (Test-WenmiReady)) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-WenmiReady)) {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw "Wenmi did not start within 30 seconds. See $stderrPath"
}

$workerDeadline = (Get-Date).AddSeconds(45)
do {
  try {
    $readiness = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/health' -TimeoutSec 2
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
