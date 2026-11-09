@echo off
setlocal
cd /d "%~dp0landingpage"
echo Starting LOHA website at http://127.0.0.1:5174...
call npm run dev
exit /b %errorlevel%
