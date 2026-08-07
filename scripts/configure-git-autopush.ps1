$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
git -C $projectRoot config core.hooksPath .githooks
git -C $projectRoot config push.default simple
git -C $projectRoot config push.autoSetupRemote true

Write-Output 'Automatic push is enabled for successful commits on main.'
