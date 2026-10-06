$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $guideText = [IO.File]::ReadAllText((Join-Path $projectRoot 'README.md'), [Text.Encoding]::UTF8)
    $guideText = $guideText.Replace('](backend-package/', '](')
    [IO.File]::WriteAllText((Join-Path $projectRoot 'backend-package/BACKEND.md'), $guideText, (New-Object System.Text.UTF8Encoding($false)))
    & node tools/build-content.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Content build failed' }
    & node backend-package/validate.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Package validation failed' }
    $packagePath = Join-Path $projectRoot 'backend-package'
    $archivePath = Join-Path $projectRoot 'LogicKernel-backend-package.zip'
    Compress-Archive -LiteralPath $packagePath -DestinationPath $archivePath -Force
    Write-Output $archivePath
} finally {
    Pop-Location
}
