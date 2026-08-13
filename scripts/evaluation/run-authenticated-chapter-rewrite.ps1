param(
  [Parameter(Mandatory = $true)][string]$BookId,
  [Parameter(Mandatory = $true)][string]$ChapterId,
  [Parameter(Mandatory = $true)][string]$ManuscriptVersionId,
  [Parameter(Mandatory = $true)][string]$Instruction,
  [int]$TimeoutMinutes = 25
)

$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:43111'
$origin = 'http://127.0.0.1:43110'
$credentialPath = Join-Path $env:LOCALAPPDATA 'Wenmi\release-validation.credential.xml'
if (-not (Test-Path -LiteralPath $credentialPath)) { throw '未找到本机加密的验收账号凭据' }
$credential = Import-Clixml -LiteralPath $credentialPath
$plainPassword = $credential.GetNetworkCredential().Password
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$headers = @{ Origin = $origin; 'Sec-Fetch-Site' = 'same-site' }

try {
  $loginBody = @{ email = $credential.UserName; password = $plainPassword } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Method Post -Uri "$api/api/v1/auth/login" -Headers $headers `
    -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($loginBody)) `
    -WebSession $session -TimeoutSec 30

  $rewriteBody = @{ manuscriptVersionId = $ManuscriptVersionId; instruction = $Instruction } | ConvertTo-Json -Compress
  $created = Invoke-RestMethod -Method Post -Uri "$api/api/v1/books/$BookId/chapters/$ChapterId/rewrite" `
    -Headers $headers -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($rewriteBody)) -WebSession $session -TimeoutSec 30
  $taskId = [string]$created.data.taskId
  if ([string]::IsNullOrWhiteSpace($taskId)) { throw '重写接口没有返回任务编号' }
  Write-Output (ConvertTo-Json @{ taskId = $taskId; state = 'queued' } -Compress)

  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  do {
    Start-Sleep -Seconds 5
    $status = Invoke-RestMethod -Method Get -Uri "$api/api/v1/books/$BookId/tasks/$taskId" `
      -Headers $headers -WebSession $session -TimeoutSec 30
    $task = $status.data.task
    Write-Output (ConvertTo-Json @{
      taskId = $taskId
      status = $task.status
      phase = $task.currentPhase
      attempts = $task.attemptCount
      modelCalls = @($status.data.modelCalls).Count
    } -Compress)
    if ($task.status -in @('succeeded', 'failed', 'blocked', 'cancelled', 'waiting_confirmation')) {
      $result = @{
        taskId = $taskId
        task = $task
        modelCalls = @($status.data.modelCalls | Select-Object phase_key, provider, model_id, state, input_tokens, output_tokens, error_class)
      }
      Write-Output (ConvertTo-Json $result -Depth 8)
      exit $(if ($task.status -in @('succeeded', 'waiting_confirmation')) { 0 } else { 2 })
    }
  } while ((Get-Date) -lt $deadline)
  throw "重写任务在$TimeoutMinutes分钟内未进入终态"
} finally {
  $plainPassword = $null
}
