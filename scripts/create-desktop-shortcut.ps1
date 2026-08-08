$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$productName = -join ([char[]](0x6587, 0x79D8, 0x5199, 0x4F5C))
$startName = -join ([char[]](0x542F, 0x52A8))
$launcherPath = Join-Path $projectRoot ($productName + '-' + $startName + '.cmd')
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'RELEASE_ID')) -or
  -not (Test-Path -LiteralPath $launcherPath)) {
  throw 'The Wenmi launcher files are incomplete.'
}

$desktop = [Environment]::GetFolderPath('Desktop')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop)) {
  throw 'The current user desktop was not found.'
}

$shortcutPath = Join-Path $desktop ($productName + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$shortcut.Arguments = '/d /c ""{0}""' -f $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "$productName - local long-form writing workspace"
$shortcut.IconLocation = "$(Join-Path $env:SystemRoot 'System32\shell32.dll'),220"
$shortcut.WindowStyle = 7
$shortcut.Save()

if (-not (Test-Path -LiteralPath $shortcutPath)) {
  throw 'The desktop shortcut was not created.'
}
Write-Output $shortcutPath
