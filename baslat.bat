@echo off
chcp 65001 >nul
title Havuc Takas
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js bulunamadi. Lutfen https://nodejs.org adresinden "LTS" surumunu kurun,
  echo  sonra bu dosyaya tekrar cift tiklayin.
  start https://nodejs.org/tr/download
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (
  echo  Node.js surumunuz eski. En az 22 gerekli. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)
if not exist ".env" copy ".env.example" ".env" >nul
if not exist "node_modules" (
  echo  Ilk kurulum yapiliyor, bu birkac dakika surebilir...
  call npm install --omit=dev
  if errorlevel 1 ( echo Kurulum basarisiz oldu. & pause & exit /b 1 )
  call npm run seed
)
start "" http://localhost:3000
call npm start
pause
