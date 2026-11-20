# Bento OS - QA check for Windows (started by "Check Vivaldi OS (Windows).cmd").
# Is everything in place in the newest Vivaldi? If not (a Vivaldi update installs into a
# new version folder without the mod), it runs the installer to put it all back.
#   -Report : only report, change nothing
param([switch]$Report)
$ErrorActionPreference = 'Stop'
$pkg = Split-Path $PSScriptRoot -Parent
$version = if (Test-Path (Join-Path $pkg 'VERSION')) { (Get-Content (Join-Path $pkg 'VERSION') -Raw).Trim() } else { '' }
Write-Host "== Bento OS $version - QA check =="
$fails = 0
function Ok($t)  { Write-Host "  OK  $t" -ForegroundColor Green }
function Bad($t) { Write-Host "  X   $t" -ForegroundColor Red; $script:fails++ }

# the newest Vivaldi version folder (the same search as the installer)
$roots = @(
  (Join-Path $env:LOCALAPPDATA 'Vivaldi\Application'),
  (Join-Path $env:ProgramFiles 'Vivaldi\Application'),
  (Join-Path ${env:ProgramFiles(x86)} 'Vivaldi\Application')
)
$app = $null; $res = $null; $ver = $null
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  $ver = Get-ChildItem $root -Directory |
    Where-Object { $_.Name -match '^\d+(\.\d+)+$' -and (Test-Path (Join-Path $_.FullName 'resources\vivaldi\window.html')) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if ($ver) { $app = $root; $res = Join-Path $ver.FullName 'resources\vivaldi'; break }
}
if (-not $res) { Write-Host '  X   Vivaldi not found in AppData\Local or Program Files' -ForegroundColor Red; exit 2 }
Ok "Vivaldi $($ver.Name)"
$win = [IO.File]::ReadAllText((Join-Path $res 'window.html'))

# 1. the scripts: in Vivaldi, the same as the package, and loaded by window.html
$personal = Join-Path (Split-Path $pkg -Parent) 'personal'
foreach ($js in Get-ChildItem (Join-Path $pkg 'js') -Filter *.js) {
  $n = "custom-$($js.Name)"; $dst = Join-Path $res $n
  if ($n -eq 'custom-launchpad-seed.js' -and (Test-Path (Join-Path $personal 'launchpad-seed.js'))) { $js = Get-Item (Join-Path $personal 'launchpad-seed.js') }
  if (-not (Test-Path $dst)) { Bad "$n missing (Vivaldi was updated?)" }
  elseif ((Get-FileHash $js.FullName).Hash -ne (Get-FileHash $dst).Hash) { Bad "$n is an older copy" }
  elseif (-not $win.Contains("src=`"$n`"")) { Bad "$n not loaded by window.html" }
  else { Ok $n }
}

# 2. the CSS mods and settings
$userData = Join-Path (Split-Path $app -Parent) 'User Data'
if (-not (Test-Path $userData)) { $userData = Join-Path $env:LOCALAPPDATA 'Vivaldi\User Data' }
$cssDir = Join-Path $userData 'VivaldiOS\css'
$same = Test-Path $cssDir
if ($same) {
  foreach ($c in Get-ChildItem (Join-Path $pkg 'css') -Filter *.css) {
    $d = Join-Path $cssDir $c.Name
    if (-not (Test-Path $d) -or (Get-FileHash $c.FullName).Hash -ne (Get-FileHash $d).Hash) { $same = $false; break }
  }
}
if ($same) { Ok 'CSS mods' } else { Bad 'CSS mods missing or older' }
$prefs = Join-Path $userData 'Default\Preferences'
if ((Test-Path $prefs) -and ([IO.File]::ReadAllText($prefs)).Contains('VivaldiOS\\css')) { Ok 'CSS folder setting' } else { Bad 'CSS folder setting' }
$ls = Join-Path $userData 'Local State'
if ((Test-Path $ls) -and ([IO.File]::ReadAllText($ls)).Contains('vivaldi-css-mods@1')) { Ok 'CSS modifications allowed' } else { Bad 'CSS modifications not allowed' }

if ($fails -eq 0) { Write-Host 'All good.'; exit 0 }
if ($Report) { Write-Host "$fails problem(s)."; exit 1 }
Write-Host "$fails problem(s): putting Bento OS back..."
& (Join-Path $PSScriptRoot 'install-windows.ps1')
