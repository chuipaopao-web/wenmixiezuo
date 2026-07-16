$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot 'data\control\desktop-launcher.pid'

if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host 'No Wenmi desktop process was found.'
  exit 0
}

$rootProcessId = [int](Get-Content -LiteralPath $pidPath -Raw)
$rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$rootProcessId"
if ($null -eq $rootProcess) {
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host 'Wenmi Writing is already stopped.'
  exit 0
}
if ($rootProcess.Name -ne 'node.exe' -or $rootProcess.CommandLine -notlike '*scripts/start.mjs*') {
  throw "The PID file does not point to Wenmi. Refusing to stop process $rootProcessId"
}

$allProcesses = Get-CimInstance Win32_Process
$descendants = [System.Collections.Generic.List[object]]::new()
$frontier = @($rootProcessId)
while ($frontier.Count -gt 0) {
  $next = @()
  foreach ($parentId in $frontier) {
    $children = @($allProcesses | Where-Object { $_.ParentProcessId -eq $parentId })
    foreach ($child in $children) {
      $descendants.Add($child)
      $next += $child.ProcessId
    }
  }
  $frontier = $next
}

foreach ($process in $descendants) {
  $isWenmi = $process.CommandLine -like "*$projectRoot*" -or
    $process.CommandLine -like '*apps/api/dist/main.js*' -or
    $process.CommandLine -like '*apps/worker/dist/main.js*' -or
    $process.Name -eq 'conhost.exe'
  if (-not $isWenmi) {
    throw "A non-Wenmi child process was found. Refusing to stop process $($process.ProcessId)"
  }
}
foreach ($process in ($descendants | Sort-Object ProcessId -Descending)) {
  Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $rootProcessId -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidPath -Force
Write-Host 'Wenmi Writing has stopped.'
