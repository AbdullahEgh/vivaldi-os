@echo off
rem Vivaldi OS - QA: checks that everything is installed, and puts it back if not
rem (for example after a Vivaldi update). Double-click this file.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mod\installer\check-windows.ps1"
echo.
pause
