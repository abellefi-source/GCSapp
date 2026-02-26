@echo off
setlocal enabledelayedexpansion
title Good Car Solutions — Portable EXE Builder
color 0A
cd /d "%~dp0"

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo. > build.log
echo Portable build started at %date% %time% >> build.log

echo.
echo  ==========================================
echo   Good Car Solutions — Portable EXE Builder
echo  ==========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed.
    pause
    exit /b 1
)
echo  [OK] Node.js found.
echo.

if exist release rmdir /s /q release 2>nul
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
)

if exist "node_modules\electron" (
    echo  [SKIP] Dependencies already installed.
    echo.
) else (
    echo  Installing dependencies (first run only)...
    call npm install --no-fund --no-audit >> build.log 2>&1
    if !errorlevel! neq 0 (
        color 0C
        echo  [ERROR] npm install failed! See build.log
        pause
        exit /b 1
    )
    echo  [OK] Dependencies installed.
    echo.
)

echo  Building portable EXE...
echo  This takes 2-5 minutes. DO NOT close.
echo.

call npx electron-builder --win portable --x64 >> build.log 2>&1
set BCODE=!errorlevel!

if !BCODE! neq 0 (
    color 0C
    echo.
    echo  BUILD FAILED! Error details:
    echo.
    type build.log
    echo.
    pause
    exit /b 1
)

echo.
echo  ==========================================
echo   BUILD COMPLETE!
echo  ==========================================
echo.
echo  Your portable EXE is in the release\ folder.
echo.

explorer "%cd%\release"
pause
