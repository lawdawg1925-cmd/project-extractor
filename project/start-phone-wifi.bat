@echo off
REM Lets a phone on the SAME Wi-Fi open the app from this laptop (for testing on iPhone/Android).
REM The phone does the OCR itself; photos never leave the phone. Close this window to stop.
cd /d "%~dp0app"
set PORT=8765
echo.
echo Your laptop's Wi-Fi address(es):
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo    http://%%a:%PORT%/index.html
echo.
echo On the phone, open Chrome (Android) or Safari (iPhone) and type the address above (without spaces).
echo If Windows asks about the firewall, allow access on PRIVATE networks only.
echo.
python -c "import http.server" >nul 2>nul && (python -m http.server %PORT% --bind 0.0.0.0 & goto :eof)
py -3 -c "import http.server" >nul 2>nul && (py -3 -m http.server %PORT% --bind 0.0.0.0 & goto :eof)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port %PORT% -Lan
