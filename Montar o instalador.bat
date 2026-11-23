@echo off
title Draft Lab - montar o instalador
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b
)
rem Monta o SEU instalador (com a pasta pessoal: painel de ouro do Tab).
rem Tudo acontece numa copia fora do OneDrive: dentro dele, o npm e o montador perdem arquivos no meio do caminho
rem ("Cannot find module", "Cannot open ... files"). A copia guarda as bibliotecas (node_modules) entre uma montagem
rem e outra, entao so a primeira vez demora. So o instalador pronto volta para a pasta dist.
set "COPIA=%LOCALAPPDATA%\Draft Lab Copia"
set "SAIDA=%LOCALAPPDATA%\Draft Lab Build"
echo.
echo  1/4  Copiando o projeto para fora do OneDrive (sem os seus dados)...
robocopy . "%COPIA%" /MIR /NFL /NDL /NJH /NJS /XD node_modules dist .git "data\cache" "data\soloq" "inhouse\.wrangler" /XF config.json partidas.json lol-config-backup.json *.log >nul
if errorlevel 8 goto erro
cd /d "%COPIA%"
echo.
echo  2/4  Baixando o Electron e o montador de instalador (so demora na primeira vez)...
echo.
call npm install --save-dev --save-exact electron@latest electron-builder@latest
if errorlevel 1 goto erro
echo.
echo  3/4  Montando o instalador...
echo.
if exist "%SAIDA%" rmdir /s /q "%SAIDA%"
call npx electron-builder --win nsis "--config.directories.output=%SAIDA%"
if errorlevel 1 goto erro
echo.
echo  4/4  Copiando o instalador para a pasta dist...
cd /d "%~dp0"
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
