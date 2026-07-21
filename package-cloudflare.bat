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

if exist "%DIST_DIR%" (
  echo [1/5] Xoa thu muc dist cu...
  rd /s /q "%DIST_DIR%"
)
mkdir "%DIST_DIR%"

echo [2/5] Sao chep frontend...
xcopy /e /i /q /y "frontend\*" "%DIST_DIR%\" > nul
if errorlevel 1 (
  echo [LOI] Khong the sao chep thu muc frontend.
  goto :failed
)

echo [3/5] Sao chep cloud-admin vao /admin...
mkdir "%DIST_DIR%\admin"
xcopy /e /i /q /y "cloud-admin\*" "%DIST_DIR%\admin\" > nul
if errorlevel 1 (
  echo [LOI] Khong the sao chep thu muc cloud-admin.
  goto :failed
)

echo [4/5] Tao file _redirects...
(
  echo /admin/*    /admin/index.html   200
  echo /*           /index.html         200
) > "%DIST_DIR%\_redirects"

echo [5/5] Tao file ZIP...
if exist "%OUT_ZIP%" del /f /q "%OUT_ZIP%"

powershell -NoProfile -Command "Compress-Archive -Path '%DIST_DIR%\*' -DestinationPath '%OUT_ZIP%' -Force"
if errorlevel 1 (
  echo [LOI] Khong the tao file ZIP.
  goto :failed
)

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
