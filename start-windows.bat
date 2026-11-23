@echo off
TITLE ChefPulse Restaurant POS Server
echo ============================================================
echo   Starting ChefPulse Restaurant POS Server (Windows)
echo ============================================================
echo.

cd /d "%~dp0"

:: Check if Node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Node.js is not found on PATH! Please install Node.js 18+ from https://nodejs.org
  pause
  exit /b 1
)

:: Check if dependencies are installed
if not exist "node_modules" (
  echo Installing dependencies...
  npm install
)

:: Start Server and open browser
echo Launching Server on http://localhost:4000...
start "" "http://localhost:4000"
node server/server.js
pause
