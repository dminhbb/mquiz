@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ========================================
echo   mquiz - Dong goi Cloudflare Pages
echo ========================================
echo.

set "DIST_DIR=%~dp0dist-cloudflare"
set "OUT_ZIP=%~dp0mquiz-cloudflare.zip"

echo [1/3] Build ban phat hanh (scripts\build-static.js)...
node scripts\build-static.js --out dist-cloudflare --keep-redirects
if errorlevel 1 (
  echo [LOI] Build that bai.
  goto :failed
)

echo [2/3] Tao file ZIP...
if exist "%OUT_ZIP%" del /f /q "%OUT_ZIP%"

powershell -NoProfile -Command "Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%OUT_ZIP%' -Force"
if errorlevel 1 (
  echo [LOI] Khong the tao file ZIP.
  goto :failed
)

echo [3/3] Don dep thu muc tam...
rd /s /q "%DIST_DIR%"

echo.
echo [THANH CONG] Da tao: %OUT_ZIP%
echo.
echo Upload file nay len Cloudflare Pages:
echo   https://dash.cloudflare.com ^> Pages ^> [project] ^> Deployments ^> Upload assets
echo.
goto :done

:failed
echo.
echo Dong goi that bai. Vui long xem thong bao loi o tren.
if /i not "%~1"=="--no-pause" pause
exit /b 1

:done
if /i not "%~1"=="--no-pause" pause
exit /b 0
