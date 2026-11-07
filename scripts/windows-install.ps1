$ErrorActionPreference = 'Stop'
$install = Join-Path $env:RUNNER_TEMP 'SimpleDocsInstall'
$previous = Join-Path $env:RUNNER_TEMP 'SimpleDocsPrevious.exe'
# Install the published predecessor, then exercise an in-place upgrade with the new NSIS package.
Invoke-WebRequest 'https://github.com/fleetwoodjohnr/simple-docs/releases/download/v0.2.0/Simple-Docs-Setup-0.2.0.exe' -OutFile $previous
function Install-SimpleDocs($installer) {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$install") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
Install-SimpleDocs $previous
$env:SD_PACKAGED = Join-Path $install 'Simple Docs.exe'
$env:SD_UPGRADE_PROFILE = Join-Path $env:RUNNER_TEMP 'SimpleDocsUpgradeProfile'
$env:SD_UPGRADE_STAGE = 'before'
npx playwright test install-upgrade
if ($LASTEXITCODE -ne 0) { throw 'Previous installation smoke test failed' }
$current = (Get-ChildItem release -Filter '*.exe' | Select-Object -First 1).FullName
Install-SimpleDocs $current
$env:SD_UPGRADE_STAGE = 'after'
npx playwright test install-upgrade shutdown formatting packaged
if ($LASTEXITCODE -ne 0) { throw 'Installed upgrade tests failed' }
