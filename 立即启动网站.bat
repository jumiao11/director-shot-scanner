@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装：https://nodejs.org/
  pause
  exit /b 1
)

set PORT=5180
echo 正在启动镜头扫描分析台...
echo 打开地址：http://127.0.0.1:5180/?v=4
echo 请保持此窗口开启，关闭窗口会停止网站。
echo.
start "" "http://127.0.0.1:5180/?v=4"
node server.js
echo.
echo 网站已停止。
pause
