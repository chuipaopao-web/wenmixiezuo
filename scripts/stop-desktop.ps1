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
  $record = Get-Content -LiteralPath $pidPath -Raw -Encoding utf8 | ConvertFrom-Json
} catch {
  throw 'The Wenmi launcher record is invalid. Refusing to stop any process.'
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
$recordedStart = [DateTimeOffset]::Parse([string]$record.startedAtUtc).UtcDateTime
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
  startedAtUtc = [string]$record.startedAtUtc
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
