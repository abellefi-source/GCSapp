@echo off
title Good Car Solutions
color 0A

cd /d "%~dp0"

echo.
echo  ======================================
echo   Good Car Solutions — Quick Launch
echo  ======================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed.
    echo  Download it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\electron" (
    echo  First run — installing dependencies...
    echo  This downloads Electron (~200MB), please wait.
    echo.
    call npm install --prefer-offline --no-audit --no-fund
    if %errorlevel% neq 0 (
        color 0C
        echo  [ERROR] Install failed.
        pause
        exit /b 1
    )
    echo.
    echo  [OK] Ready.
    echo.
)

echo  Launching Good Car Solutions...
echo  (You can close this window after the app opens)
echo.

call npx electron .
