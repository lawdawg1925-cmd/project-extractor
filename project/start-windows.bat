@echo off
REM Project Extractor launcher for Windows. Starts a tiny local web server (this computer only)
REM and opens the app in your browser. Nothing is uploaded anywhere.
cd /d "%~dp0app"
set PORT=8765
python -c "import http.server" >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/index.html
  echo Project Extractor running at http://localhost:%PORT%/  -- close this window to stop.
  python -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
py -3 -c "import http.server" >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:%PORT%/index.html
  echo Project Extractor running at http://localhost:%PORT%/  -- close this window to stop.
  py -3 -m http.server %PORT% --bind 127.0.0.1
  goto :eof
)
REM No Python: use the built-in PowerShell server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT%
