@echo off
chcp 65001 >nul 2>&1
title Binance Grid Worker - 一键更新

echo.
echo  ==========================================
echo   Binance Grid Worker - 一键更新
echo   更新 cookie/token 并触发推送
echo  ==========================================
echo.

:: 检查 .dev.vars 是否存在
if not exist ".dev.vars" (
    echo  错误：找不到 .dev.vars 文件
    echo  请先在 .dev.vars 中填入 cookie 和 token
    pause
    exit /b 1
)

:: 检查 API Token 是否已设置
if "%CLOUDFLARE_API_TOKEN%"=="" (
    echo  错误：未设置 CLOUDFLARE_API_TOKEN
    echo.
    echo  请先运行（只需设置一次）：
    echo    setx CLOUDFLARE_API_TOKEN "你的API_Token"
    echo.
    echo  设置后重新打开此窗口再运行
    pause
    exit /b 1
)

node sync-secrets.cjs

echo.
pause
