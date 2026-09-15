$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $projectRoot 'backend-package/BACKEND.md') -Force
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
