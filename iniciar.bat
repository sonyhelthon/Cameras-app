@echo off
title Minhas Cameras
cd /d "%~dp0"
if not exist config.yaml (
  echo Copie config.example.yaml para config.yaml e preencha antes de iniciar.
  pause
  exit /b 1
)
if not exist C:\cameras\bin\ffmpeg.exe (
  echo Instalando ffmpeg e rclone em C:\cameras\bin ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-programas.ps1"
  if errorlevel 1 (
    echo Nao foi possivel baixar os programas. Verifique a internet e tente de novo.
    pause
    exit /b 1
  )
)
if not exist node_modules call npm install
:loop
node src\server.js
echo O servidor parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
