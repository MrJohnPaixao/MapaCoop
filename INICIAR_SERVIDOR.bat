@echo off
title Mapa Cooperativa — Servidor Local
color 2F
cls

echo.
echo  ============================================
echo   MAPA COOPERATIVA — Iniciando servidor...
echo  ============================================
echo.

:: Verifica Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Python nao encontrado!
    echo.
    echo  Instale o Python em: https://python.org/downloads
    echo  Marque a opcao "Add Python to PATH" durante a instalacao.
    echo.
    pause
    exit /b 1
)

echo  Python encontrado! Iniciando servidor na porta 8080...
echo.
echo  *** Acesse no navegador: http://localhost:8080 ***
echo.
echo  Para instalar como app no celular:
echo   1. Conecte o celular na mesma rede Wi-Fi
echo   2. Descubra o IP do seu PC (comando: ipconfig)
echo   3. Acesse http://SEU-IP:8080 no celular
echo.
echo  Pressione Ctrl+C para encerrar o servidor.
echo.

:: Abre o navegador automaticamente apos 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

:: Inicia o servidor
python -m http.server 8080

pause
