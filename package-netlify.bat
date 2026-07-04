@echo off
setlocal
cd /d "%~dp0"

echo.
echo ========================================
echo   vn.Quiz - Dong goi Netlify
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [LOI] Khong tim thay Node.js.
  echo Hay cai Node.js roi chay lai file nay.
  goto :failed
)

if not exist "node_modules\archiver" (
  echo [1/3] Dang cai dependencies...
  call npm install
  if errorlevel 1 (
    echo [LOI] npm install khong thanh cong.
    goto :failed
  )
) else (
  echo [1/3] Dependencies da san sang.
)

echo [2/3] Dang tao full package...
set "GENERATED_ZIP="
for /f "usebackq delims=" %%I in (`node -e "require('./backend/src/generator').exportDeployZip().then(function(p){console.log(p)}).catch(function(e){console.error(e);process.exit(1)})"`) do set "GENERATED_ZIP=%%I"

if errorlevel 1 (
  echo [LOI] Khong the tao file ZIP.
  goto :failed
)

if not defined GENERATED_ZIP (
  echo [LOI] Khong nhan duoc duong dan file ZIP.
  goto :failed
)

if not exist "%GENERATED_ZIP%" (
  echo [LOI] File ZIP khong ton tai: %GENERATED_ZIP%
  goto :failed
)

echo [3/3] Dang tao file deploy ten co dinh...
copy /y "%GENERATED_ZIP%" "%~dp0simple-quiz-netlify-full.zip" >nul
if errorlevel 1 (
  echo [LOI] Khong the sao chep file ZIP ra thu muc goc.
  goto :failed
)

echo.
echo [THANH CONG] Da tao:
echo %~dp0simple-quiz-netlify-full.zip
echo.
echo Upload truc tiep file nay len Netlify.
goto :done

:failed
echo.
echo Dong goi that bai. Vui long xem thong bao loi o tren.
if /i not "%~1"=="--no-pause" pause
exit /b 1

:done
if /i not "%~1"=="--no-pause" pause
exit /b 0
