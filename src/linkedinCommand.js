import { linkedinProfile } from './linkedin.js';

export function linkedinCommand(profile, archiveHash) {
  if (!profile?.trim()) throw new Error('Enter the candidate’s LinkedIn profile URL above first.');
  if (/^\d{5,20}$/.test(profile.trim()))
    throw new Error(
      'Use the public profile URL or handle for local extraction, rather than a numeric provider ID.',
    );
  const url = linkedinProfile(profile);
  if (!/^[a-f0-9]{64}$/.test(archiveHash)) throw new Error('Extractor checksum is invalid.');
  // Only a normalized member URL and a hexadecimal release checksum enter code.
  return `& {
  $ErrorActionPreference = 'Stop'
  try {
    $anthroProfile = '${url}/'
    $anthroHash = '${archiveHash}'
    $anthroRoot = Join-Path $env:LOCALAPPDATA 'AnthroPrime\\LinkedIn'
    $anthroPackage = Join-Path $anthroRoot $anthroHash
    New-Item -ItemType Directory -Force -Path $anthroPackage | Out-Null
    $anthroZip = Join-Path $anthroPackage 'extractor.zip'
    if (-not (Test-Path -LiteralPath $anthroZip)) {
      Write-Host 'Downloading the reviewed AnthroPrime extractor...'
      Invoke-WebRequest -UseBasicParsing -Uri 'https://hiringintelligence.netlify.app/linkedin-local-extractor.zip' -OutFile $anthroZip
    }
    if ((Get-FileHash -LiteralPath $anthroZip -Algorithm SHA256).Hash.ToLowerInvariant() -ne $anthroHash) {
      throw 'Download checksum mismatch. Remove extractor.zip from the printed folder, refresh the portal and copy a new command.'
    }
    Expand-Archive -LiteralPath $anthroZip -DestinationPath $anthroPackage -Force
    $anthroPython = Join-Path $anthroRoot 'runtime\\Scripts\\python.exe'
    if (-not (Test-Path -LiteralPath $anthroPython)) {
      $anthroBase = $null
      foreach ($anthroCandidate in @('py', 'python', 'python3')) {
        if (Get-Command $anthroCandidate -ErrorAction SilentlyContinue) {
          & $anthroCandidate -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>$null
          if ($LASTEXITCODE -eq 0) { $anthroBase = $anthroCandidate; break }
        }
      }
      if (-not $anthroBase) { throw 'Install Python 3.10 or newer from python.org, enable Add Python to PATH, then run this command again.' }
      Write-Host 'Setting up the local runtime once...'
      & $anthroBase -m venv (Join-Path $anthroRoot 'runtime')
      if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python runtime.' }
    }
    & $anthroPython -c 'import importlib.util, importlib.metadata; raise SystemExit(0 if importlib.util.find_spec("playwright") and importlib.metadata.version("playwright") == "1.63.0" else 1)' 2>$null
    if ($LASTEXITCODE -ne 0) {
      & $anthroPython -m pip install --index-url https://pypi.org/simple 'playwright==1.63.0'
      if ($LASTEXITCODE -ne 0) { throw 'Playwright installation failed. Check your connection and run again.' }
    }
    & $anthroPython -c 'from playwright.sync_api import sync_playwright; from pathlib import Path; p=sync_playwright().start(); exists=Path(p.chromium.executable_path).exists(); p.stop(); raise SystemExit(0 if exists else 1)' 2>$null
    if ($LASTEXITCODE -ne 0) {
      & $anthroPython -m playwright install chromium
      if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed. Check your connection and run again.' }
    }
    $anthroOutput = Join-Path $anthroRoot ('profile-' + [guid]::NewGuid().ToString('N') + '.json')
    Write-Host 'Sign in to LinkedIn in the window that opens, then press Enter here.'
    & $anthroPython (Join-Path $anthroPackage 'tools\\linkedin_profile_extractor.py') $anthroProfile --login --no-raw --out $anthroOutput
    if ($LASTEXITCODE -ne 0) { throw 'Extraction stopped. No new result was copied. Check the message above.' }
    $anthroJson = Get-Content -LiteralPath $anthroOutput -Raw -Encoding UTF8
    $anthroCheck = $anthroJson | ConvertFrom-Json
    if ($anthroCheck.format -ne 'anthro-linkedin-profile' -or $anthroCheck.version -ne 1 -or $anthroCheck.url -ne $anthroProfile) { throw 'Unexpected output. Do not import it.' }
    try {
      Set-Clipboard -Value $anthroJson
      Write-Host 'Done! Return to AnthroPrime and click Paste extracted profile.' -ForegroundColor Green
    } catch { Write-Host 'Clipboard was unavailable. Choose the saved JSON using LinkedIn JSON export in the portal.' }
    Write-Host ('Saved locally: ' + $anthroOutput)
  } catch { Write-Host $_.Exception.Message -ForegroundColor Red; Write-Host ('Local folder: ' + $anthroPackage) }
}`;
}
