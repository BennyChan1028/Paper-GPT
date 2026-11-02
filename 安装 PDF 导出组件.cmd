@echo off
chcp 65001 >nul
where py >nul 2>nul
if errorlevel 1 (
  python "%~dp0setup-pdf-export.py"
) else (
  py -3.12 "%~dp0setup-pdf-export.py"
)
pause
