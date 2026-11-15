#!/usr/bin/env bash
# Doble clic para levantar IGNIS en una Mac (necesita Docker Desktop).
cd "$(dirname "$0")"
clear
echo "¿Cómo quieres abrir IGNIS?"
echo "  1) Solo en esta red Wi-Fi (recomendado para la sala)"
echo "  2) Con enlace público HTTPS para que entre cualquiera (GPS real en celulares)"
read -r -p "Elige 1 o 2 [1]: " opcion
if [ "${opcion:-1}" = "2" ]; then bash scripts/ignis.sh publico; else bash scripts/ignis.sh iniciar; fi
echo
read -r -p "Presiona Enter para cerrar esta ventana (IGNIS sigue corriendo)…" _
