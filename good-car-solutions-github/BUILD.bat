@echo off
setlocal enabledelayedexpansion
title Good Car Solutions — Desktop Builder
color 0A
cd /d "%~dp0"

set CSC_IDENTITY_AUTO_DISCOVERY=false

echo. > build.log
echo Build started at %date% %time% >> build.log

echo.
echo  ======================================
echo   Good Car Solutions — Desktop Builder
echo  ======================================
echo.
echo  All output also saved to build.log
echo.

REM ─── CHECK NODE ───
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo  [ERROR] Node.js is not installed.
    echo  Download it from: https://nodejs.org
    pause
    exit /b 1
)
echo  [OK] Node.js:
node --version
echo  [OK] npm:
call npm --version
echo.

REM ─── CLEAN OLD BUILD ───
echo  Cleaning previous build...
if exist release rmdir /s /q release 2>nul
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
    rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" 2>nul
)
echo  [OK] Clean.
echo.

REM ─── INSTALL DEPENDENCIES ───
if exist "node_modules\electron" (
    echo  [SKIP] Dependencies already installed.
    echo         To force reinstall, delete node_modules first.
    echo.
) else (
    echo  ──────────────────────────────────────
    echo  Installing dependencies...
    echo  First run downloads Electron ~200MB.
    echo  Please be patient...
    echo  ──────────────────────────────────────
    echo.

    echo npm install started %time% >> build.log
    call npm install --no-fund --no-audit >> build.log 2>&1
    if !errorlevel! neq 0 (
        color 0C
        echo.
        echo  [ERROR] npm install failed!
        echo.
        echo  Try manually:
        echo    npm cache clean --force
        echo    npm install
        echo.
        echo  See build.log for details.
        echo.
        pause
        exit /b 1
    )
    echo npm install done %time% >> build.log
    echo  [OK] Dependencies installed.
    echo.
)

REM ─── VERIFY CRITICAL FILES ───
if not exist "main.js" (
    echo  [ERROR] main.js not found!
    pause
    exit /b 1
)
if not exist "src\index.html" (
    echo  [ERROR] src\index.html not found!
    pause
    exit /b 1
)
if not exist "src\icon.ico" (
    echo  [WARN] src\icon.ico not found, build may fail.
    echo  Continuing anyway...
    echo.
)
echo  [OK] All source files present.
echo.

REM ─── BUILD ───
echo  ──────────────────────────────────────
echo  Building Windows installer...
echo  This takes 2-5 minutes.
echo  DO NOT close this window.
echo  ──────────────────────────────────────
echo.
echo Build started %time% >> build.log

call npx electron-builder --win --x64 >> build.log 2>&1
set BCODE=!errorlevel!

echo Build ended %time% exit code !BCODE! >> build.log

if !BCODE! neq 0 (
    color 0C
    echo.
    echo  ══════════════════════════════════════
    echo   BUILD FAILED  (exit code !BCODE!)
    echo  ══════════════════════════════════════
    echo.
    echo  ─── Error details from build.log: ───
    echo.
    type build.log
    echo.
    echo  ─────────────────────────────────────
    echo.
    echo  Common fixes:
    echo   1. Delete node_modules + package-lock.json
    echo      then run BUILD.bat again
    echo   2. Right-click BUILD.bat, Run as Admin
    echo   3. Disable antivirus temporarily
    echo   4. Check disk space (need ~1GB free)
    echo.
    pause
    exit /b 1
)

echo.
color 0A
echo  ======================================
echo   BUILD COMPLETE!
echo  ======================================
echo.
echo  Output files:
dir /b release\*.exe 2>nul
echo.
echo  Your installer is in the release\ folder.
echo.

explorer "%cd%\release"
pause
