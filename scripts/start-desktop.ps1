$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$logDirectory = Join-Path $projectRoot 'data\logs'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$stopRequestPath = Join-Path $controlDirectory 'desktop-stop.request.json'
$expectedReleaseId = (Get-Content -LiteralPath (Join-Path $projectRoot 'RELEASE_ID') -Raw).Trim()

# Explorer可能尚未继承新写入的用户环境变量；只装载文秘写作允许使用的配置名，
# 不打印值，也不创建.env或把凭证写入项目文件。
$wenmiEnvironmentNames = 'WENMI_MODEL_MODE', 'WENMI_CODEX_MODEL', 'WENMI_CODEX_TIMEOUT_MS', 'WENMI_ARK_CODING_PLAN_API_KEY', 'WENMI_ARK_CODING_PLAN_BASE_URL', 'WENMI_ARK_CODING_PLAN_DEEPSEEK_MODEL', 'WENMI_ARK_AGENT_PLAN_API_KEY', 'WENMI_ARK_AGENT_PLAN_BASE_URL', 'WENMI_ARK_AGENT_PLAN_GLM_MODEL', 'WENMI_ARK_AGENT_PLAN_DOUBAO_MODEL', 'WENMI_ARK_AGENT_PLAN_KIMI_MODEL'
foreach ($name in $wenmiEnvironmentNames) {
  $value = [Environment]::GetEnvironmentVariable($name, 'User')
  if (-not [string]::IsNullOrWhiteSpace($value)) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
}

# 某些开发宿主会同时注入 Path 与 PATH。PowerShell 的 Start-Process 会把它们
# 判定为重复字典键并拒绝启动；统一为 Windows 标准的 Path 后再创建子进程。
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

if (Test-WenmiReady) {
  if ($env:WENMI_NO_BROWSER -ne '1') { Start-Process 'http://127.0.0.1:43110' }
  Write-Host 'Wenmi Writing is already running. The workspace is open.'
  exit 0
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
# Windows PowerShell 的 Start-Process 会枚举宿主环境；当上游同时注入 Path/PATH 时，
# 它会在真正创建进程前因重复键崩溃。cmd start 直接继承当前环境，不重建该字典。
$beforeNodeIds = @(Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$beforeNodeIds = @(Get-Process node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
& cmd.exe /d /c start 'Wenmi Writing' /b $nodePath scripts/start.mjs
if ($LASTEXITCODE -ne 0) { throw 'Wenmi process could not be started.' }
$processDeadline = (Get-Date).AddSeconds(10)
$publishedLauncher = $null
while ((Get-Date) -lt $processDeadline -and $null -eq $publishedLauncher) {
  Start-Sleep -Milliseconds 100
  if (Test-Path -LiteralPath $pidPath) {
    try { $publishedLauncher = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8 | ConvertFrom-Json } catch { $publishedLauncher = $null }
  }
}
$childProcess = if ($null -ne $publishedLauncher) {
  Get-Process -Id ([int]$publishedLauncher.processId) -ErrorAction SilentlyContinue
} else {
  $null
}
while ((Get-Date) -lt $processDeadline -and $null -eq $childProcess) {
  Start-Sleep -Milliseconds 100
  $childProcess = Get-Process node -ErrorAction SilentlyContinue |
    Where-Object { $_.Id -notin $beforeNodeIds -and $_.Path -eq $nodePath } |
    # scripts/start.mjs 必然先于它创建的 API/Web/Worker 子进程出现。
    Sort-Object StartTime, Id |
    Select-Object -First 1
}
if ($null -eq $childProcess) { throw 'Wenmi process started but its verified process record was not found.' }
$childProcess.Refresh()
$launcherRecord = [ordered]@{
  schemaVersion = 1
  processId = $childProcess.Id
  executablePath = $nodePath
  projectRoot = $projectRoot
  entryPoint = 'scripts/start.mjs'
  startedAtUtc = $childProcess.StartTime.ToUniversalTime().ToString('o')
}
$launcherRecord | ConvertTo-Json -Compress | Set-Content -LiteralPath $pidPath -Encoding utf8

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
