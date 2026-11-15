#!/usr/bin/env bash
# Doble clic para detener IGNIS (la base de datos se conserva).
cd "$(dirname "$0")"
bash scripts/ignis.sh detener
read -r -p "Presiona Enter para cerrar…" _
