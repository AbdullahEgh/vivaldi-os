# Vivaldi OS

Vivaldi as an operating system: floating windows with traffic lights, window snapping
(top = full screen, sides = Bento), Bento tiling, a macOS-style Launchpad with iOS
widgets (clocks, calendar, timer), a desktop, a dock-style tab bar and light/dark themes.
For Vivaldi on macOS and Windows.

## Install, update, or put it back after a Vivaldi update

Close Vivaldi, paste ONE line, press Enter. It always installs the newest release.

**Mac** (Terminal):
```
curl -fsSL https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Mac.command -o /tmp/vivaldi-os.command && bash /tmp/vivaldi-os.command
```

**Windows** (PowerShell):
```
irm https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Windows.cmd -OutFile $env:TEMP\vivaldi-os.cmd; & $env:TEMP\vivaldi-os.cmd
```

**Windows without PowerShell** (Command Prompt):
```
curl -L -o "%USERPROFILE%\Downloads\VivaldiOS-Windows-Manual.zip" https://github.com/AbdullahEgh/vivaldi-os/releases/latest/download/VivaldiOS-Windows-Manual.zip & (for /f "delims=" %Z in ('dir /b /o:d "%USERPROFILE%\Downloads\VivaldiOS*Manual*.zip"') do tar -xf "%USERPROFILE%\Downloads\%Z" -C "%USERPROFILE%\Documents") & (for /d %D in ("%LOCALAPPDATA%\Vivaldi\Application\*.*.*.*") do (copy /y "%USERPROFILE%\Documents\VivaldiOS\custom-vivaldi-os*.*" "%D\resources\vivaldi\" >nul & (if not exist "%D\resources\vivaldi\window.html.orig" copy "%D\resources\vivaldi\window.html" "%D\resources\vivaldi\window.html.orig" >nul) & (findstr /v /l /x /c:"</body>" /c:"</html>" "%D\resources\vivaldi\window.html.orig" & echo   ^<script src="custom-vivaldi-os.js"^>^</script^>& echo ^</body^>& echo ^</html^>) > "%D\resources\vivaldi\window.html" & echo Vivaldi OS installed in %D)) & start "" "%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe" --restore-last-session
```

A Vivaldi update replaces Vivaldi's own files and with them the mod's scripts: paste
the same line again afterwards. Vivaldi OS checks this repository for new releases and
shows a notice with a button that copies the line for you (desktop right-click menu:
Check for Updates).

Or download a file from the [latest release](https://github.com/AbdullahEgh/vivaldi-os/releases/latest)
and double-click it: `VivaldiOS-Mac.command` or `VivaldiOS-Windows.cmd`.

## What it changes
- Scripts added to Vivaldi's own files (`custom-*.js`, loaded by `window.html`; the original is kept as `window.html.orig`).
- Vivaldi settings: themes and wallpaper, tab bar and toolbars, "Allow CSS modifications" and the CSS folder.
- Backups of changed settings files: `*.vivaldi-os.bak`.
- A fresh install gets a few starter apps in the Launchpad, only when it is empty. No personal data is included.

## Check
`Check Vivaldi OS (Mac).command` / `Check Vivaldi OS (Windows).cmd` check that everything is in place and reinstall what is missing.
