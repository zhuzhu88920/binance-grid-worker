@echo off
chcp 65001 >nul 2>&1
title Binance Grid Worker

echo.
echo  ==========================================
echo   Binance Grid Worker
echo  ==========================================
echo.
echo  请选择操作：
echo.
echo  [1] 自动获取 Cookie（弹出浏览器，扫码登录）
echo  [2] 上传 Secrets 到 CF 并触发推送
echo  [3] 预览 .dev.vars（不上传）
echo  [0] 退出
echo.
set /p choice=请输入编号：

if "%choice%"=="1" goto auto_login
if "%choice%"=="2" goto update
if "%choice%"=="3" goto dry_run
if "%choice%"=="0" goto end
echo  无效选择
goto end

:auto_login
echo.
echo  即将打开浏览器，请扫码登录 Binance...
node auto-login.cjs
echo.
pause
goto end

:update
:: 检查 .dev.vars 是否存在
if not exist ".dev.vars" (
    echo  错误：找不到 .dev.vars 文件
    pause
    goto end
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
    goto end
)

node sync-secrets.cjs
echo.
pause
goto end

:dry_run
if not exist ".dev.vars" (
    echo  错误：找不到 .dev.vars 文件
    pause
    goto end
)
node sync-secrets.cjs --dry
echo.
pause
goto end

:end
