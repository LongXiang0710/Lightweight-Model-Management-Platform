@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0_start-platform.ps1" %*
exit /b %errorlevel%
