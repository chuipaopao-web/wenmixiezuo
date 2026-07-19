$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$logDirectory = Join-Path $projectRoot 'data\logs'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$expectedReleaseId = (Get-Content -LiteralPath (Join-Path $projectRoot 'RELEASE_ID') -Raw).Trim()

# Explorer可能尚未继承新写入的用户环境变量；只装载文秘写作允许使用的配置名，
# 不打印值，也不创建.env或把凭证写入项目文件。
$wenmiEnvironmentNames = 'WENMI_MODEL_MODE', 'WENMI_CODEX_MODEL', 'WENMI_CODEX_TIMEOUT_MS', 'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_AGENT_PLAN_GLM_MODEL', 'WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_MODEL'
foreach ($name in $wenmiEnvironmentNames) {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}

Set-Location -LiteralPath $projectRoot
New-Item -ItemType Directory -Force -Path $controlDirectory, $logDirectory | Out-Null

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

if (Test-WenmiReady) {
  if ($env:WENMI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
  Write-Host 'Wenmi Writing is already running. The workspace is open.'
  exit 0
}

$occupied = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalPort -in 43110, 43111 }
if ($occupied) {
  $details = ($occupied | ForEach-Object { "port $($_.LocalPort), process $($_.OwningProcess)" }) -join '; '
  throw "Wenmi ports are occupied: $details"
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
