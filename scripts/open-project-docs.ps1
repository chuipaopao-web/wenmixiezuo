param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$syncScript = Join-Path $PSScriptRoot 'sync-project-docs.mjs'
$documentCenter = Join-Path $projectRoot 'docs\PROJECT_DOCUMENT_CENTER.html'

function Open-CurrentDocumentCenter {
    $documentUri = (New-Object System.Uri($documentCenter)).AbsoluteUri
    $version = [IO.File]::GetLastWriteTimeUtc($documentCenter).Ticks
    Start-Process -FilePath ($documentUri + '?v=' + $version)
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $nodeCommand) {
    $userProfilePath = [Environment]::GetFolderPath('UserProfile')
    $knownNodes = @(
        'C:\Program Files\nodejs\node.exe',
        (Join-Path $userProfilePath '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    $knownNode = $knownNodes | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($null -ne $knownNode) {
        $nodeExecutable = $knownNode
    }
    else {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show('Node.js was not found. The existing document center will be opened.', 'Wenmi project documents') | Out-Null
        if (-not $NoOpen) { Open-CurrentDocumentCenter }
        exit 0
    }
}
else {
    $nodeExecutable = $nodeCommand.Source
}

& $nodeExecutable $syncScript
if ($LASTEXITCODE -ne 0) {
    throw 'Project document synchronization failed.'
}
if (-not $NoOpen) { Open-CurrentDocumentCenter }