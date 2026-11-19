#!/bin/bash
# Vivaldi OS — QA check. Is everything in place? If not, puts it back.
#   check-mac.sh <package>           check, and run the installer when something is missing
#   check-mac.sh <package> --auto    the same, quietly (the auto-repair agent after a Vivaldi update)
#   check-mac.sh <package> --report  only report, change nothing
PKG="${1:?package folder}"; MODE="${2:-}"
APP="/Applications/Vivaldi.app"
RES="$APP/Contents/Frameworks/Vivaldi Framework.framework/Versions/Current/Resources/vivaldi"
WIN="$RES/window.html"
UD="$HOME/Library/Application Support/Vivaldi"
fails=0
ok()  { [[ "$MODE" == "--auto" ]] || echo "  ✓ $1"; }
bad() { [[ "$MODE" == "--auto" ]] || echo "  ✗ $1"; fails=$((fails + 1)); }

[[ "$MODE" == "--auto" ]] || echo "== Vivaldi OS $(cat "$PKG/VERSION" 2>/dev/null) — QA check =="
if [[ ! -f "$WIN" ]]; then echo "  ✗ Vivaldi is not in /Applications"; exit 2; fi
ok "Vivaldi $(defaults read "$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null)"

# 1. the scripts: in Vivaldi, the same as the package, and loaded by window.html
PERS="$(cd "$PKG/.." && pwd)/personal"
for js in "$PKG"/js/*.js; do
  n="custom-$(basename "$js")"
  [[ "$n" == custom-launchpad-seed.js && -f "$PERS/launchpad-seed.js" ]] && js="$PERS/launchpad-seed.js"   # your own apps
  if [[ ! -f "$RES/$n" ]]; then bad "$n missing (Vivaldi was updated?)"
  elif ! cmp -s "$js" "$RES/$n"; then bad "$n is an older copy"
  elif ! grep -q "src=\"$n\"" "$WIN"; then bad "$n not loaded by window.html"
  else ok "$n"; fi
done

# 2. the CSS mods and settings (skipped by the agent: only a Vivaldi update is its job)
if [[ "$MODE" != "--auto" ]]; then
  CSS="$UD/VivaldiOS/css"
  if [[ -d "$CSS" ]] && diff -rq "$PKG/css" "$CSS" >/dev/null 2>&1; then ok "CSS mods"; else bad "CSS mods missing or older"; fi
  P="$UD/Default/Preferences"
  if grep -q "VivaldiOS/css" "$P" 2>/dev/null; then ok "CSS folder setting"; else bad "CSS folder setting"; fi
  if grep -q "vivaldi-css-mods@1" "$UD/Local State" 2>/dev/null; then ok "CSS modifications allowed"; else bad "CSS modifications not allowed"; fi
fi

if (( fails == 0 )); then [[ "$MODE" == "--auto" ]] || echo "All good."; exit 0; fi
[[ "$MODE" == "--report" ]] && { echo "$fails problem(s)."; exit 1; }
# something is missing: put everything back (the installer restarts Vivaldi)
INST="$(cd "$PKG/.." && pwd)/Install Vivaldi OS (Mac).command"
if [[ "$MODE" == "--auto" ]]; then
  sleep 20                                         # let an update finish first, then look again
  "$0" "$PKG" --report >/dev/null && exit 0
  osascript -e 'display notification "Vivaldi was updated. Putting Vivaldi OS back…" with title "Vivaldi OS"' 2>/dev/null
  open -a Terminal "$INST"                         # in Terminal: it may change Vivaldi.app
else
  echo "$fails problem(s): putting Vivaldi OS back…"
  bash "$INST"
fi
