@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ============================================
echo   急救设备巡检系统 - 局域网一键部署
echo ============================================
echo.
echo 提示：建议右键本文件选择「以管理员身份运行」，
echo       这样才能自动放行防火墙，手机才连得上。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
