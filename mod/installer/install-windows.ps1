# Vivaldi OS - installer for Windows (started by "Install Vivaldi OS (Windows).cmd").
#   - floating windows, traffic lights, desktop clock, tab tint (JS mods)
#   - the CSS mods (mod\css, copied next to the Vivaldi profile) + "Allow CSS modifications"
#   - the Vivaldi light/dark themes with the wallpaper, and the tab bar setup
# Re-run after every Vivaldi update. Undo: the .vivaldi-os.bak / window.html.orig backups.

$ErrorActionPreference = 'Stop'
$pkg = Split-Path $PSScriptRoot -Parent                    # the package's mod folder
Add-Type -AssemblyName System.Web.Extensions
$json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$json.MaxJsonLength = [int]::MaxValue
$json.RecursionLimit = 1000

function Read-Json($path) {
  if (-not (Test-Path -LiteralPath $path)) { return (New-Object 'System.Collections.Generic.Dictionary[string,object]') }
  return $json.DeserializeObject([IO.File]::ReadAllText($path))
}
# values that passed through PowerShell (function output, New-Object, Join-Path...) end up
# PSObject-wrapped inside the dictionaries, and JavaScriptSerializer fails on those
# ("circular reference"). Unwrapping in PowerShell itself re-wraps, so it is done in C#.
if (-not ('VivaldiOsJson' -as [type])) {
  Add-Type -TypeDefinition @'
using System.Collections;
using System.Collections.Generic;
using System.Management.Automation;
public static class VivaldiOsJson {
  public static object Plain(object o) {
    PSObject p = o as PSObject;
    if (p != null) o = p.BaseObject;
    IDictionary d = o as IDictionary;
    if (d != null) {
      Dictionary<string, object> r = new Dictionary<string, object>();
      foreach (DictionaryEntry e in d) r[e.Key.ToString()] = Plain(e.Value);
      return r;
    }
    if (o is string) return o;
    IEnumerable list = o as IEnumerable;
    if (list != null) {
      List<object> r = new List<object>();
      foreach (object x in list) r.Add(Plain(x));
      return r.ToArray();
    }
    return o;
  }
}
'@
}
function Write-Json($path, $obj) {
  $text = $json.Serialize([VivaldiOsJson]::Plain($obj))
  if ($text.Length -lt 3) { throw "refusing to write an empty $path" }
  [IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}
function Backup-Once($path) {
  if ((Test-Path -LiteralPath $path) -and -not (Test-Path -LiteralPath "$path.vivaldi-os.bak")) { Copy-Item -LiteralPath $path "$path.vivaldi-os.bak" }
}
function New-Dict { New-Object 'System.Collections.Generic.Dictionary[string,object]' }
function Set-JsonPath($obj, [string]$path, $value) {
  $keys = $path.Split('.')
  for ($i = 0; $i -lt $keys.Length - 1; $i++) {
    $k = $keys[$i]
    if (-not $obj.ContainsKey($k) -or -not ($obj[$k] -is [System.Collections.Generic.IDictionary[string,object]])) { $obj[$k] = New-Dict }
    $obj = $obj[$k]
  }
  $obj[$keys[-1]] = $value
}
function Remove-JsonPath($obj, [string]$path) {
  $keys = $path.Split('.')
  for ($i = 0; $i -lt $keys.Length - 1; $i++) {
    if (-not $obj.ContainsKey($keys[$i])) { return }
    $obj = $obj[$keys[$i]]
  }
  [void]$obj.Remove($keys[-1])
}

$version = if (Test-Path (Join-Path $pkg 'VERSION')) { (Get-Content (Join-Path $pkg 'VERSION') -Raw).Trim() } else { '' }
Write-Host "== Vivaldi OS $version installer =="

# find Vivaldi (newest version folder with the UI files)
$roots = @(
  (Join-Path $env:LOCALAPPDATA 'Vivaldi\Application'),
  (Join-Path $env:ProgramFiles 'Vivaldi\Application'),
  (Join-Path ${env:ProgramFiles(x86)} 'Vivaldi\Application')
)
$app = $null; $res = $null
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  $ver = Get-ChildItem $root -Directory |
    Where-Object { $_.Name -match '^\d+(\.\d+)+$' -and (Test-Path (Join-Path $_.FullName 'resources\vivaldi\window.html')) } |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
  if ($ver) { $app = $root; $res = Join-Path $ver.FullName 'resources\vivaldi'; break }
}
if (-not $res) { throw 'Vivaldi not found in AppData\Local or Program Files.' }
$userData = Join-Path (Split-Path $app -Parent) 'User Data'      # standalone install
if (-not (Test-Path $userData)) { $userData = Join-Path $env:LOCALAPPDATA 'Vivaldi\User Data' }
$prof = Join-Path $userData 'Default'
if (-not (Test-Path (Join-Path $prof 'Preferences'))) { throw "No Vivaldi profile at $prof - start Vivaldi once first." }
Write-Host "Vivaldi: $res"

# 1. close Vivaldi (it saves the open tabs and brings them back)
$procs = Get-Process vivaldi -ErrorAction SilentlyContinue
if ($procs) {
  Write-Host 'Closing Vivaldi...'
  $procs | ForEach-Object { [void]$_.CloseMainWindow() }
  for ($i = 0; $i -lt 40 -and (Get-Process vivaldi -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
  if (Get-Process vivaldi -ErrorAction SilentlyContinue) {
    Write-Host 'Vivaldi is still running in the background - stopping it.'
    Get-Process vivaldi -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
  Start-Sleep -Seconds 1
}

# 2. JS mods into Vivaldi
$win = Join-Path $res 'window.html'
if (-not (Test-Path "$win.orig")) { Copy-Item $win "$win.orig" }
$html = [IO.File]::ReadAllText($win)
# the CSS now comes from the CSS mods folder; drop the copy older installers added
$html = $html -replace '\s*<link rel="stylesheet" href="custom-vivaldi-os.css">', ''
Remove-Item (Join-Path $res 'custom-vivaldi-os.css') -ErrorAction SilentlyContinue
foreach ($js in Get-ChildItem (Join-Path $pkg 'js') -Filter *.js) {
  if ($js.Length -eq 0) { throw "$($js.FullName) is empty - wait for iCloud to finish syncing, then run again." }
  $name = "custom-$($js.Name)"
  Copy-Item $js.FullName (Join-Path $res $name) -Force
  if (-not $html.Contains("src=`"$name`"")) {
    $html = $html -replace '</body>', "  <script src=`"$name`"></script>`n</body>"
  }
  Write-Host "installed: $name"
}
# your own data (never in a release): a "personal" folder next to the mod folder
$personal = Join-Path (Split-Path $pkg -Parent) 'personal'
if (Test-Path (Join-Path $personal 'launchpad-seed.js')) {
  Copy-Item (Join-Path $personal 'launchpad-seed.js') (Join-Path $res 'custom-launchpad-seed.js') -Force
  Write-Host 'installed: your Launchpad apps (personal)'
}
# scripts no longer in the package (e.g. a mod that was removed): out of Vivaldi too
foreach ($old in Get-ChildItem $res -Filter 'custom-*.js') {
  if (Test-Path (Join-Path (Join-Path $pkg 'js') ($old.Name -replace '^custom-', ''))) { continue }
  Move-Item $old.FullName "$win.removed-$($old.Name)" -Force
  $html = $html -replace ('[ \t]*<script src="' + [regex]::Escape($old.Name) + '"></script>\r?\n?'), ''
  Write-Host "removed: $($old.Name)"
}
[IO.File]::WriteAllText($win, $html, (New-Object System.Text.UTF8Encoding $false))

# 3. settings
$cfg = Read-Json (Join-Path $pkg 'settings\vivaldi-os-settings.json')
$mineFile = Join-Path $personal 'personal-settings.json'
if (Test-Path $mineFile) { $mine = Read-Json $mineFile; foreach ($k in $mine['set'].Keys) { $cfg['set'][$k] = $mine['set'][$k] } }

#   wallpaper, copied next to the profile (iCloud may free up files in the package)
$wpDir = Join-Path $userData 'VivaldiOS'
New-Item -ItemType Directory -Force $wpDir | Out-Null
$wp = Join-Path $wpDir $cfg['wallpaper']['file']
Copy-Item (Join-Path $pkg ('settings\' + $cfg['wallpaper']['file'])) $wp -Force
$mapPath = Join-Path $prof 'file_mapping.json'
Backup-Once $mapPath
$map = Read-Json $mapPath
if (-not $map.ContainsKey('mappings')) { $map['mappings'] = New-Dict }
$entry = New-Dict; $entry['local_path'] = [string]$wp   # plain string: the serializer chokes on PowerShell-wrapped ones
$map['mappings'][$cfg['wallpaper']['id']] = $entry
Write-Json $mapPath $map

#   Preferences: themes, tab bar, CSS folder
$prefPath = Join-Path $prof 'Preferences'
Backup-Once $prefPath
$prefs = Read-Json $prefPath
if (-not $prefs.ContainsKey('vivaldi')) { $prefs['vivaldi'] = New-Dict }
if (-not $prefs['vivaldi'].ContainsKey('themes')) { $prefs['vivaldi']['themes'] = New-Dict }
$themes = $prefs['vivaldi']['themes']
if (-not $themes.ContainsKey('system') -or @($themes['system']).Count -eq 0) {
  $themes['system'] = $cfg['systemThemes']
} else {
  $list = New-Object System.Collections.ArrayList
  $list.AddRange(@($themes['system']))
  foreach ($id in $cfg['themeIds']) {
    $t = @($cfg['systemThemes']) | Where-Object { $_['id'] -eq $id } | Select-Object -First 1
    $found = $false
    for ($i = 0; $i -lt $list.Count; $i++) { if ($list[$i]['id'] -eq $id) { $list[$i] = $t; $found = $true } }
    if (-not $found) { [void]$list.Add($t) }
  }
  $themes['system'] = $list.ToArray()
}
foreach ($k in $cfg['set'].Keys) { Set-JsonPath $prefs $k $cfg['set'][$k] }
#   the tab bar items are only a starting point: set on the first install,
#   then your own arrangement is never touched again
$onceMark = Join-Path $wpDir 'set-once.done'
if (-not (Test-Path $onceMark)) {
  if ($cfg['setOnce']) { foreach ($k in $cfg['setOnce'].Keys) { Set-JsonPath $prefs $k $cfg['setOnce'][$k] } }
  Set-Content -Path $onceMark -Value "tab bar items were set on $(Get-Date -Format o)"
}
#   later additions to the default setup (e.g. the Clock): each one once per machine,
#   so an older install gets it too, and removing it afterwards sticks
$updMark = Join-Path $wpDir 'updates-once.done'
$done = New-Object System.Collections.ArrayList
if (Test-Path $updMark) { $done.AddRange(@(Get-Content $updMark | Where-Object { $_ })) }
foreach ($u in @($cfg['updatesOnce'])) {
  if ($null -eq $u -or $done.Contains($u['id'])) { continue }
  if ($u.ContainsKey('set')) { foreach ($k in $u['set'].Keys) { Set-JsonPath $prefs $k $u['set'][$k] } }
  if ($u.ContainsKey('insert')) {
    foreach ($ins in @($u['insert'])) {
      $parent = $prefs; $keys = $ins['toolbar'].Split('.')
      for ($i = 0; $i -lt $keys.Length - 1 -and $null -ne $parent; $i++) { $parent = if ($parent.ContainsKey($keys[$i])) { $parent[$keys[$i]] } else { $null } }
      if ($null -eq $parent -or -not $parent.ContainsKey($keys[-1])) { continue }   # toolbar not customised yet: Vivaldi's default applies
      $bar = New-Object System.Collections.ArrayList
      $bar.AddRange(@($parent[$keys[-1]]))
      if ($bar.Contains($ins['item'])) { continue }
      $at = $bar.IndexOf($ins['before'])
      if ($at -ge 0) { $bar.Insert($at, $ins['item']) } else { [void]$bar.Add($ins['item']) }
      $parent[$keys[-1]] = $bar.ToArray()
    }
  }
  [void]$done.Add($u['id'])
}
Set-Content -Path $updMark -Value ($done -join "`n")
foreach ($k in $cfg['reset']) { Remove-JsonPath $prefs $k }
#   the CSS mods: copied next to the profile too, so the package folder can be moved or deleted
$cssDir = Join-Path $wpDir 'css'
foreach ($c in Get-ChildItem (Join-Path $pkg 'css') -Filter *.css) {
  if ($c.Length -eq 0) { throw "$($c.FullName) is empty - wait for iCloud to finish syncing, then run again." }
}
if (Test-Path $cssDir) { Remove-Item $cssDir -Recurse -Force }
Copy-Item (Join-Path $pkg 'css') $cssDir -Recurse -Force
Set-JsonPath $prefs 'vivaldi.appearance.css_ui_mods_directory' ([string]$cssDir)
Write-Json $prefPath $prefs

#   Local State: vivaldi://experiments -> Allow for using CSS modifications
$lsPath = Join-Path $userData 'Local State'
Backup-Once $lsPath
$ls = Read-Json $lsPath
if (-not $ls.ContainsKey('browser')) { $ls['browser'] = New-Dict }
$labs = New-Object System.Collections.ArrayList
if ($ls['browser'].ContainsKey('enabled_labs_experiments')) { $labs.AddRange(@($ls['browser']['enabled_labs_experiments'])) }
if (-not $labs.Contains('vivaldi-css-mods@1')) { [void]$labs.Add('vivaldi-css-mods@1') }
$ls['browser']['enabled_labs_experiments'] = $labs.ToArray()
Write-Json $lsPath $ls
Write-Host 'settings applied (themes, wallpaper, tab bar, CSS folder, CSS experiment)'

# 4. start Vivaldi again
Start-Process (Join-Path $app 'vivaldi.exe')
Write-Host 'Done. Vivaldi is now an OS.'
