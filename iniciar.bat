@echo off
title Minhas Cameras (servidor)
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe em https://nodejs.org (versao LTS^), instale e abra este arquivo de novo.
  pause
  exit /b 1
)
echo Verificando dependencias (na primeira vez ou depois de atualizar pode demorar alguns minutos)...
call npm install --omit=dev --no-audit --no-fund
:loop
node src\server.js
echo O servidor parou. Reiniciando em 5 segundos...
timeout /t 5 /nobreak >nul
goto loop
