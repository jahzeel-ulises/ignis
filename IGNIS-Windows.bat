@echo off
chcp 65001 >nul
title IGNIS
cd /d "%~dp0"
echo Como quieres abrir IGNIS?
echo   1) Solo en esta red Wi-Fi (recomendado para la sala)
echo   2) Con enlace publico HTTPS para que entre cualquiera (GPS real en celulares)
set /p OPCION="Elige 1 o 2 [1]: "
if "%OPCION%"=="2" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ignis.ps1" publico
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ignis.ps1" iniciar
)
echo.
pause
