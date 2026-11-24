#!/bin/bash
# Bento OS — one-click installer for macOS. Double-click this file.
#   • floating windows, traffic lights, desktop clock, tab tint (JS mods)
#   • the CSS mods (mod/css, copied next to the Vivaldi profile) + "Allow CSS modifications"
#   • your Vivaldi light/dark themes with the wallpaper, and the tab bar setup
# Re-run after every Vivaldi update. Undo: the .vivaldi-os.bak / window.html.orig backups.
set -euo pipefail

PKG="$(cd "$(dirname "$0")" && pwd)/mod"                          # everything the installer puts in place
APP="/Applications/Vivaldi.app"
RES="$APP/Contents/Frameworks/Vivaldi Framework.framework/Versions/Current/Resources/vivaldi"
WIN="$RES/window.html"
USERDATA="$HOME/Library/Application Support/Vivaldi"

echo "== Bento OS $(cat "$PKG/VERSION" 2>/dev/null) installer =="
[[ -f "$WIN" ]] || { echo "Vivaldi not found in /Applications."; read -r -p "Press Return to close."; exit 1; }

# 1. quit Vivaldi (it saves the open tabs and brings them back)
if pgrep -x Vivaldi >/dev/null; then
  echo "Closing Vivaldi…"
  osascript -e 'quit app "Vivaldi"' || true
  for _ in $(seq 1 60); do pgrep -x Vivaldi >/dev/null || break; sleep 0.5; done
  if pgrep -x Vivaldi >/dev/null; then echo "Vivaldi did not close. Close it and run this again."; read -r -p "Press Return to close."; exit 1; fi
  sleep 1
fi

# 1b. on the Mac that built the package, its own latest look goes into the
#     package first, so installing never undoes a change made since the build
PERS="$(cd "$(dirname "$0")" && pwd)/personal"                 # your own data: only on your machines, never in a release
if [[ "$(cat "$PERS/built-on" 2>/dev/null)" == "$(ioreg -rd1 -c IOPlatformExpertDevice | awk -F\" '/IOPlatformUUID/{print $4}' | shasum | cut -c1-12)" ]]; then
  python3 -I "$PKG/installer/sync-settings-from-mac.py" "$PKG" >/dev/null && echo "kept this Mac's current look"
fi

# 2. JS mods into Vivaldi.app
[[ -f "$WIN.orig" ]] || cp "$WIN" "$WIN.orig"
for js in "$PKG"/js/*.js; do
  [[ -f "$js" ]] || continue
  name="custom-$(basename "$js")"
  cp "$js" "$RES/$name"
  if ! grep -q "src=\"$name\"" "$WIN"; then
    NAME="$name" /usr/bin/perl -0pi -e 's#</body>#  <script src="$ENV{NAME}"></script>\n</body>#' "$WIN"
  fi
  echo "installed: $name"
done
# the page-start file (one tab's own look): loaded by pages, not by window.html
if [[ -f "$PKG/page/page-look.js" ]]; then cp "$PKG/page/page-look.js" "$RES/custom-vivaldi-os-page-look.js"; echo "installed: custom-vivaldi-os-page-look.js"; fi
# your own Launchpad apps instead of the starter set, when personal/ is here
if [[ -f "$PERS/launchpad-seed.js" ]]; then cp "$PERS/launchpad-seed.js" "$RES/custom-launchpad-seed.js"; echo "installed: your Launchpad apps (personal)"; fi
# scripts no longer in the package (e.g. a mod that was removed): out of Vivaldi too
for old in "$RES"/custom-*.js; do
  [[ -f "$old" ]] || continue
  base="$(basename "$old")"
  [[ -f "$PKG/js/${base#custom-}" ]] && continue
  [[ "$base" == custom-vivaldi-os-page-look.js && -f "$PKG/page/page-look.js" ]] && continue
  /bin/mv -f "$old" "$WIN.removed-$base"
  NAME="$base" /usr/bin/perl -0pi -e 's#[ \t]*<script src="\Q$ENV{NAME}\E"></script>\n?##g' "$WIN"
  echo "removed: $base"
done

# 3. settings: themes + wallpaper, tab bar, CSS folder, CSS experiment
osascript -l JavaScript "$PKG/installer/apply-settings-mac.js" "$PKG" "$USERDATA" "$PERS"

# the updater: Bento OS's "Update Now" opens vivaldios://update, and this small app
# (in your Applications folder) asks you, then runs the update in Terminal.
# Remove it: delete ~/Applications/Vivaldi OS Updater.app
UPD="$HOME/Applications/Vivaldi OS Updater.app"
if [[ -f "$PKG/installer/updater-mac.applescript" ]]; then
  mkdir -p "$HOME/Applications"; rm -rf "$UPD"
  if osacompile -o "$UPD" "$PKG/installer/updater-mac.applescript" 2>/dev/null; then
    PB=/usr/libexec/PlistBuddy; PL="$UPD/Contents/Info.plist"
    $PB -c "Set :CFBundleIdentifier com.vivaldios.updater" "$PL" 2>/dev/null || $PB -c "Add :CFBundleIdentifier string com.vivaldios.updater" "$PL"
    $PB -c "Add :CFBundleURLTypes array" "$PL"
    $PB -c "Add :CFBundleURLTypes:0 dict" "$PL"
    $PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string Bento OS Update" "$PL"
    $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
    $PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string vivaldios" "$PL"
    $PB -c "Add :NSAppleEventsUsageDescription string 'Vivaldi OS Updater opens Terminal to install the update.'" "$PL" 2>/dev/null || true
    codesign --force --deep -s - "$UPD" 2>/dev/null || true
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$UPD" 2>/dev/null || true
    echo "updater: ready (Update Now in Bento OS)"
  fi
fi

# 4. start Vivaldi again
open -a Vivaldi --args --restore-last-session      # your windows and tabs, as they were
echo "Done. Vivaldi is now an OS."
