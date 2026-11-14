@echo off
title Draft Lab - montar o instalador
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b
)
rem A montagem acontece fora do OneDrive: dentro dele, os arquivos copiados para a pasta temporaria
rem do instalador somem no meio do caminho ("Cannot open ... files"). So o instalador pronto volta para a pasta dist.
set "SAIDA=%LOCALAPPDATA%\Draft Lab Build"
echo.
echo  1/3  Baixando o Electron e o montador de instalador (so demora na primeira vez)...
echo.
call npm install --save-dev --save-exact electron@latest electron-builder@latest
if errorlevel 1 goto erro
echo.
echo  2/3  Montando o instalador...
echo.
if exist "%SAIDA%" rmdir /s /q "%SAIDA%"
call npx electron-builder --win nsis "--config.directories.output=%SAIDA%"
if errorlevel 1 goto erro
echo.
echo  3/3  Copiando o instalador para a pasta dist...
if not exist dist mkdir dist
copy /y "%SAIDA%\*Setup*.exe" dist >nul
if errorlevel 1 goto erro
echo.
echo  Pronto! O instalador esta na pasta dist: "Draft Lab Setup (versao).exe"
explorer dist
pause
exit /b
:erro
echo.
echo  Algo deu errado. Tire um print desta janela e mande para o Claude.
pause
