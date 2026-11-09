@echo off
setlocal
cd /d "%~dp0frontend"
echo Starting LOHA PMS at http://127.0.0.1:5173...
call npm run dev
exit /b %errorlevel%
