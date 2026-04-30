@echo off
chcp 65001 >nul
title Binance Grid Worker - Local Test

echo.
echo ========================================
echo   Binance Grid Worker - Local Test
echo ========================================
echo.

cd /d "%~dp0"

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Please install: https://nodejs.org/
    pause
    exit /b 1
)

REM Install dependencies
echo [1/3] Installing dependencies...
if not exist "node_modules" (
    echo     Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
) else (
    echo     Dependencies exist, skipping
)

REM Check Wrangler
echo.
echo [2/3] Checking Wrangler CLI...
where wrangler >nul 2>&1
if %errorlevel% neq 0 (
    echo     Installing Wrangler...
    call npm install -g wrangler
)

REM Start dev server
echo.
echo [3/3] Starting local dev server...
echo.
echo ========================================
echo   Visit http://localhost:8787
echo   Press Ctrl+C to stop
echo ========================================
echo.
wrangler dev --local
