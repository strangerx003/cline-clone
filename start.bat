@echo off
title Starting Cline Web...
cd /d "%~dp0"

echo ========================================================
echo               Starting Cline Web Agent
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Starting local server using Node.js...
    node server.mjs
    goto end
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Starting local server using Python...
    start "" "http://localhost:5500"
    python -m http.server 5500
    goto end
)

where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Starting local server using Python launcher...
    start "" "http://localhost:5500"
    py -m http.server 5500
    goto end
)

echo [ERROR] Neither Node.js nor Python was found on your PATH.
echo Please install Node.js from https://nodejs.org or Python from https://python.org
pause

:end
