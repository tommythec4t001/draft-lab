@echo off
title Draft Lab - instalador PUBLICO (sem a pasta pessoal)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b
)
rem Monta o instalador que vai para o GitHub e para outras pessoas: copia o projeto para fora do OneDrive
rem SEM a pasta pessoal (painel de ouro do Tab) e sem os seus dados (chave da Riot, coleta, historico).
set "COPIA=%LOCALAPPDATA%\Draft Lab Publico"
set "SAIDA=%LOCALAPPDATA%\Draft Lab Build Publico"
echo.
echo  1/4  Copiando o projeto sem a pasta pessoal e sem os seus dados...
if exist "%COPIA%" rmdir /s /q "%COPIA%"
robocopy . "%COPIA%" /E /NFL /NDL /NJH /NJS /XD pessoal node_modules dist .git "data\cache" "data\soloq" /XF config.json partidas.json lol-config-backup.json *.log >nul
if errorlevel 8 goto erro
if exist "%COPIA%\pessoal" goto erro
cd /d "%COPIA%"
echo.
echo  2/4  Baixando o Electron e o montador de instalador...
call npm install --save-dev --save-exact electron@latest electron-builder@latest
if errorlevel 1 goto erro
echo.
echo  3/4  Montando o instalador publico...
if exist "%SAIDA%" rmdir /s /q "%SAIDA%"
call npx electron-builder --win nsis "--config.directories.output=%SAIDA%"
if errorlevel 1 goto erro
echo.
echo  4/4  Copiando para a pasta dist\publico...
cd /d "%~dp0"
if not exist dist\publico mkdir dist\publico
copy /y "%SAIDA%\*Setup*.exe" dist\publico >nul
if errorlevel 1 goto erro
echo.
echo  Pronto! O instalador publico esta em dist\publico. E esse que vai para o GitHub (Releases).
echo  O instalador do "Montar o instalador.bat" continua sendo o seu, com o painel de ouro.
explorer dist\publico
pause
exit /b
:erro
echo.
echo  Algo deu errado. Tire um print desta janela e mande para o Claude.
pause
