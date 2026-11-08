@echo off
title Minhas Cameras
cd /d "%~dp0"
if not exist config.yaml (
  echo Copie config.example.yaml para config.yaml e preencha antes de iniciar.
  pause
  exit /b 1
)
if not exist node_modules call npm install
:loop
node src\server.js
echo O servidor parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
