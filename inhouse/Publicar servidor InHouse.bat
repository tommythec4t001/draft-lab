@echo off
chcp 65001 >nul
title Draft Lab InHouse - publicar servidor
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo O Node.js nao esta instalado. Baixe a versao LTS em https://nodejs.org e rode este arquivo de novo.
  pause
  exit /b
)
echo.
echo Publicando o servidor das salas InHouse na Cloudflare.
echo Na primeira vez, o navegador abre para voce entrar na sua conta da Cloudflare e autorizar.
echo.
call npx --yes wrangler@4 deploy
if errorlevel 1 (
  echo.
  echo Nao deu certo. Se for a primeira vez, rode de novo depois de entrar na conta da Cloudflare.
  pause
  exit /b
)
echo.
echo Pronto! Copie o endereco que termina em .workers.dev (aparece acima)
echo e cole no Draft Lab: aba InHouse ^> Servidor InHouse.
pause
