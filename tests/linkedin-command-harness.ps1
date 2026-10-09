param([string]$ScriptPath, [string]$ExpectedHash, [string]$Scenario, [string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
$commandText = Get-Content -LiteralPath $ScriptPath -Raw -Encoding UTF8
$parseTokens = $null; $parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseInput($commandText, [ref]$parseTokens, [ref]$parseErrors)
if ($parseErrors.Count) {throw ($parseErrors | Out-String)}
# Run the exact command flow with mocked network/runtime/clipboard boundaries.
# No network, real clipboard, installer, browser or credentials are used.
$commandText = $commandText.Replace("`$anthroPython = Join-Path `$anthroRoot 'runtime\Scripts\python.exe'", "`$anthroPython = 'Invoke-FixturePython'")
$env:LOCALAPPDATA = $FixtureRoot
$script:copies = 0; $script:unpacked = 0; $script:extracted = 0; $script:messages = @()
function Test-Path {param($LiteralPath) return $Scenario -notin @('first-setup', 'no-python', 'download-fail', 'install-fail')}
function Get-FileHash {param($LiteralPath, $Algorithm)
  return @{Hash = $(if ($Scenario -eq 'bad-hash') {'0' * 64} else {$ExpectedHash})}
}
function Expand-Archive {param($LiteralPath, $DestinationPath, [switch]$Force) $script:unpacked++}
function Invoke-WebRequest {param([switch]$UseBasicParsing, $Uri, $OutFile)
  if ($Scenario -eq 'download-fail') {throw 'Fixture download failed'}
}
function Get-Command {param($Name, $ErrorAction)
  if ($Scenario -eq 'no-python') {return $null}
  return @{Name='py'}
}
function py {$global:LASTEXITCODE = 0}
function Set-Clipboard {param($Value) $script:copies++; if (($Value | ConvertFrom-Json).name -ne 'Fictional Test') {throw 'Wrong clipboard data'}}
function Write-Host {param($Object, $ForegroundColor) $script:messages += [string]$Object}
function Invoke-FixturePython {
  if ($args[0] -eq '-c' -and $Scenario -in @('first-setup', 'install-fail')) {$global:LASTEXITCODE = 1; return}
  if ($args -contains 'pip' -and $Scenario -eq 'install-fail') {$global:LASTEXITCODE = 1; return}
  if ($args -contains '--out') {
    $script:extracted++
    if ($Scenario -eq 'extract-fail') {$global:LASTEXITCODE = 1; return}
    $destination = $args[([Array]::IndexOf($args, '--out') + 1)]
    @{format='anthro-linkedin-profile';version=1;url='https://www.linkedin.com/in/amit29533/';name='Fictional Test'} | ConvertTo-Json | Set-Content -LiteralPath $destination -Encoding UTF8
  }
  $global:LASTEXITCODE = 0
}
& ([scriptblock]::Create($commandText))
switch ($Scenario) {
  {$_ -in 'success','first-setup'} {if ($script:copies -ne 1 -or $script:unpacked -ne 1 -or $script:extracted -ne 1) {throw ('Success path did not complete: ' + ($script:messages -join ' | '))}}
  'bad-hash' {if ($script:unpacked -ne 0 -or $script:extracted -ne 0 -or $script:copies -ne 0) {throw 'Checksum failure executed a package'}}
  'extract-fail' {if ($script:copies -ne 0 -or $script:extracted -ne 1) {throw 'Failed extraction copied stale data'}}
  {$_ -in 'download-fail','install-fail','no-python'} {if ($script:copies -ne 0 -or $script:extracted -ne 0) {throw 'Setup failure continued to extraction'}}
  default {throw 'Invalid scenario'}
}
Write-Output "PASS: $Scenario"
