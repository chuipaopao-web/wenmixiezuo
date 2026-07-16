$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$logDirectory = Join-Path $projectRoot 'data\logs'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$expectedReleaseId = (Get-Content -LiteralPath (Join-Path $projectRoot 'RELEASE_ID') -Raw).Trim()

Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force -Path $controlDirectory, $logDirectory | Out-Null

function Test-WenmaiReady {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/health' -TimeoutSec 2
    $web = Invoke-WebRequest -Uri 'http://127.0.0.1:43110' -UseBasicParsing -TimeoutSec 2
    return $health.data.status -eq 'ok' -and
      $health.data.releaseId -eq $expectedReleaseId -and
      $web.StatusCode -eq 200 -and
      $web.Content -like '*文脉写作*'
  } catch {
    return $false
  }
}

if (Test-WenmaiReady) {
  if ($env:WENMAI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
  Write-Host 'Wenmai Writing is already running. The workspace is open.'
  exit 0
}

$occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 43110, 43111 }
if ($occupied) {
  $details = ($occupied | ForEach-Object { "port $($_.LocalPort), process $($_.OwningProcess)" }) -join '; '
  throw "Wenmai ports are occupied: $details"
}

& npm.cmd run migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Startup stopped.' }
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Production build failed. Startup stopped.' }

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logDirectory "desktop-$timestamp.out.log"
$stderrPath = Join-Path $logDirectory "desktop-$timestamp.err.log"
$nodePath = (Get-Command node.exe).Source
$process = Start-Process -FilePath $nodePath -ArgumentList @('scripts/start.mjs') `
  -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline -and -not (Test-WenmaiReady)) {
  Start-Sleep -Milliseconds 250
}
if (-not (Test-WenmaiReady)) {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw "Wenmai did not start within 30 seconds. See $stderrPath"
}

$workerDeadline = (Get-Date).AddSeconds(15)
do {
  try {
    $worker = Invoke-RestMethod -Uri 'http://127.0.0.1:43111/api/v1/runtime/worker' -TimeoutSec 2
  } catch {
    $worker = $null
  }
  if ($worker.data.status -eq 'ready') { break }
  Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $workerDeadline)

if ($null -eq $worker -or $worker.data.status -ne 'ready') {
  & (Join-Path $PSScriptRoot 'stop-desktop.ps1')
  throw 'The Worker did not become ready. Startup stopped safely.'
}

if ($env:WENMAI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
Write-Host 'Wenmai Writing is ready at http://127.0.0.1:43110'
Write-Host 'Double-click the stop entry when you want to stop the app.'
