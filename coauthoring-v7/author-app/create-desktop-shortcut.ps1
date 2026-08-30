$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherPath = Join-Path $appRoot 'launch-local.cmd'
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '文秘写作V7-本地开发.lnk'
$commandPath = Join-Path $env:SystemRoot 'System32\cmd.exe'

if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "没有找到 V7 启动脚本：$launcherPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $commandPath
$shortcut.Arguments = '/d /c ""{0}""' -f $launcherPath
$shortcut.WorkingDirectory = $appRoot
$shortcut.Description = '文秘写作 V7 本地作者端'
$shortcut.IconLocation = "$(Join-Path $env:SystemRoot 'System32\shell32.dll'),220"
$shortcut.WindowStyle = 7
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  throw 'V7 桌面启动图标创建失败。'
}

Write-Output $shortcutPath
