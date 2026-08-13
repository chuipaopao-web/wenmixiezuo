param(
  [Parameter(Mandatory = $true)][string]$BookId,
  [Parameter(Mandatory = $true)][string]$TaskId,
  [int]$TimeoutMinutes = 20
)

$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:43111'
$origin = 'http://127.0.0.1:43110'
$credentialPath = Join-Path $env:LOCALAPPDATA 'Wenmi\release-validation.credential.xml'
if (-not (Test-Path -LiteralPath $credentialPath)) { throw '未找到本机加密的验收账号凭据' }
$credential = Import-Clixml -LiteralPath $credentialPath
$password = $credential.GetNetworkCredential().Password
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$headers = @{ Origin = $origin; 'Sec-Fetch-Site' = 'same-site' }

try {
  $login = @{ email = $credential.UserName; password = $password } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Method Post -Uri "$api/api/v1/auth/login" -Headers $headers `
    -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($login)) `
    -WebSession $session -TimeoutSec 30
  $null = Invoke-RestMethod -Method Post -Uri "$api/api/v1/books/$BookId/tasks/$TaskId/retry" `
    -Headers $headers -ContentType 'application/json; charset=utf-8' -Body '{}' -WebSession $session -TimeoutSec 30
  Write-Output (ConvertTo-Json @{ taskId = $TaskId; state = 'retried' } -Compress)
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  do {
    Start-Sleep -Seconds 5
    $status = Invoke-RestMethod -Method Get -Uri "$api/api/v1/books/$BookId/tasks/$TaskId" `
      -Headers $headers -WebSession $session -TimeoutSec 30
    $task = $status.data.task
    Write-Output (ConvertTo-Json @{ taskId = $TaskId; status = $task.status; phase = $task.currentPhase; attempts = $task.attemptCount; modelCalls = @($status.data.modelCalls).Count } -Compress)
    if ($task.status -in @('succeeded', 'failed', 'blocked', 'cancelled', 'waiting_confirmation')) {
      Write-Output (ConvertTo-Json @{ task = $task; modelCalls = @($status.data.modelCalls | Select-Object phase_key, provider, model_id, state, input_tokens, output_tokens, error_class) } -Depth 8)
      exit $(if ($task.status -in @('succeeded', 'waiting_confirmation')) { 0 } else { 2 })
    }
  } while ((Get-Date) -lt $deadline)
  throw "任务在$TimeoutMinutes分钟内未进入终态"
} finally {
  $password = $null
}
