$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$controlDirectory = Join-Path $projectRoot 'data\control'
$pidPath = Join-Path $controlDirectory 'desktop-launcher.pid'
$stopRequestPath = Join-Path $controlDirectory 'desktop-stop.request.json'

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host 'No Wenmi desktop process was found.'
  exit 0
}

try {
  $recordRaw = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8
  $record = $recordRaw | ConvertFrom-Json
  # 桌面快捷方式使用Windows PowerShell 5，不能假设System.Text.Json已经加载；
  # 新版PowerShell会把ISO字符串自动转换为DateTime，旧版则保留字符串。
  # 两种形态都在后面按UTC归一，避免本地文化设置影响进程身份校验。
  # Windows PowerShell 5 does not consistently expose PSMemberInfoCollection
  # through .Item(name). Check the property name explicitly and then read the
  # value through normal object access so the verified stop path works on the
  # desktop shortcut's actual shell.
  if ($record.PSObject.Properties.Name -notcontains 'startedAtUtc') { throw 'missing startedAtUtc' }
  $recordedStartValue = $record.startedAtUtc
} catch {
  throw "The Wenmi launcher record is invalid. Refusing to stop any process. $($_.Exception.Message)"
}
if ($record.schemaVersion -ne 1 -or $record.entryPoint -ne 'scripts/start.mjs') {
  throw 'The launcher record does not identify scripts/start.mjs. Refusing to stop any process.'
}
$recordedRoot = [System.IO.Path]::GetFullPath([string]$record.projectRoot).TrimEnd('\')
$expectedRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
if (-not $recordedRoot.Equals($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'The launcher record belongs to another project. Refusing to stop any process.'
}

$rootProcessId = [int]$record.processId
$rootProcess = Get-Process -Id $rootProcessId -ErrorAction SilentlyContinue
if ($null -eq $rootProcess) {
  Remove-Item -LiteralPath $pidPath -Force
  Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
  Write-Host 'Wenmi Writing is already stopped.'
  exit 0
}
$recordedExecutable = [System.IO.Path]::GetFullPath([string]$record.executablePath)
$actualExecutable = [System.IO.Path]::GetFullPath([string]$rootProcess.Path)
if ($recordedStartValue -is [DateTime]) {
  $recordedStart = ([DateTime]$recordedStartValue).ToUniversalTime()
  $recordedStartText = $recordedStart.ToString('yyyy-MM-ddTHH:mm:ss.fffZ', [System.Globalization.CultureInfo]::InvariantCulture)
} else {
  $recordedStartText = [string]$recordedStartValue
  if ($recordedStartText.Length -ne 24 -or
    $recordedStartText.Substring(4, 1) -ne '-' -or
    $recordedStartText.Substring(7, 1) -ne '-' -or
    $recordedStartText.Substring(10, 1) -ne 'T' -or
    $recordedStartText.Substring(13, 1) -ne ':' -or
    $recordedStartText.Substring(16, 1) -ne ':' -or
    $recordedStartText.Substring(19, 1) -ne '.' -or
    $recordedStartText.Substring(23, 1) -ne 'Z') {
    throw 'The launcher start timestamp is invalid. Refusing to stop any process.'
  }
  $recordedStart = [DateTimeOffset]::new(
    [int]$recordedStartText.Substring(0, 4),
    [int]$recordedStartText.Substring(5, 2),
    [int]$recordedStartText.Substring(8, 2),
    [int]$recordedStartText.Substring(11, 2),
    [int]$recordedStartText.Substring(14, 2),
    [int]$recordedStartText.Substring(17, 2),
    [TimeSpan]::Zero
  ).AddMilliseconds([int]$recordedStartText.Substring(20, 3)).UtcDateTime
}
$actualStart = $rootProcess.StartTime.ToUniversalTime()
$startDeltaSeconds = [Math]::Abs(($recordedStart - $actualStart).TotalSeconds)
if ($rootProcess.Name -ne 'node' -or
  -not $actualExecutable.Equals($recordedExecutable, [System.StringComparison]::OrdinalIgnoreCase) -or
  $startDeltaSeconds -gt 1) {
  throw "The launcher record does not point to the registered Wenmi process. Refusing to stop process $rootProcessId"
}

$request = [ordered]@{
  schemaVersion = 1
  processId = $rootProcessId
  startedAtUtc = $recordedStartText
  projectRoot = $expectedRoot
  reason = 'desktop-stop-entry'
}
$request | ConvertTo-Json -Compress | Set-Content -LiteralPath $stopRequestPath -Encoding utf8

$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline -and $null -ne (Get-Process -Id $rootProcessId -ErrorAction SilentlyContinue)) {
  Start-Sleep -Milliseconds 200
}
if ($null -ne (Get-Process -Id $rootProcessId -ErrorAction SilentlyContinue)) {
  throw "Wenmi did not acknowledge the verified stop request. Refusing to force-stop process $rootProcessId"
}

Remove-Item -LiteralPath $pidPath -Force
Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
Write-Host 'Wenmi Writing has stopped.'
