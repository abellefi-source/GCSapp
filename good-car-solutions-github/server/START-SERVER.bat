@echo off
title GCS Data Server
color 0A

cd /d "%~dp0"

echo.
echo  ======================================
echo   Good Car Solutions - Data Server
echo  ======================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed.
    echo  Download from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\express" (
    echo  Installing dependencies - first run only...
    echo.
    call npm install --no-fund --no-audit --prefer-offline 2>&1
    echo.
    if not exist "node_modules\express" (
        color 0C
        echo  [ERROR] npm install failed.
        echo.
        echo  Try running these commands manually:
        echo    cd "%~dp0"
        echo    npm install
        echo.
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
)

node server.js

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  [ERROR] Server stopped. See error above.
    echo.
)

pause
