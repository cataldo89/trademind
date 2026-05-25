@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\start-quant-cloudflare.ps1" -UpdateVercel -Deploy
pause
