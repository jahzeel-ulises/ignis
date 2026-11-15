#!/usr/bin/env bash
# IGNIS · arranque en un comando para Mac y Linux (laptop de la demo o servidor).
#
#   scripts/ignis.sh iniciar      levanta todo y abre el centro de control
#   scripts/ignis.sh publico      igual, y además crea un enlace público https://….trycloudflare.com
#   scripts/ignis.sh detener      detiene (conserva la base de datos)
#   scripts/ignis.sh estado       muestra cada servicio y su salud
#   scripts/ignis.sh registros    sigue los registros en vivo
#   scripts/ignis.sh actualizar   trae la última versión (git pull) y reconstruye
set -euo pipefail
cd "$(dirname "$0")/.."

ACCION="${1:-iniciar}"
c() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
titulo() { echo; c "1;38;5;208" "▲ IGNIS · $1"; }
ok() { c "32" "  ✓ $1"; }
aviso() { c "33" "  ! $1"; }
falla() { c "31" "  ✗ $1"; exit 1; }
es_mac() { [ "$(uname)" = "Darwin" ]; }
valor_env() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true; }
fijar_env() {   # fijar_env CLAVE valor  (sin sed -i para que funcione igual en Mac y Linux)
  local tmp; tmp="$(mktemp)"
  if grep -qE "^$1=" .env; then awk -v k="$1" -v v="$2" -F= '$1==k{print k"="v; next}{print}' .env > "$tmp"; else cat .env > "$tmp"; echo "$1=$2" >> "$tmp"; fi
  mv "$tmp" .env
}

revisar_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    if es_mac; then
      aviso "Falta Docker Desktop. Instálalo desde https://www.docker.com/products/docker-desktop/ y vuelve a abrir este archivo."
      open "https://www.docker.com/products/docker-desktop/" 2>/dev/null || true
    else
      aviso "Falta Docker. En Ubuntu/Debian:  curl -fsSL https://get.docker.com | sudo sh"
    fi
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    if es_mac; then
      aviso "Abriendo Docker Desktop…"; open -a Docker || true
      for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
    fi
    docker info >/dev/null 2>&1 || falla "Docker no está corriendo. Ábrelo y vuelve a intentar."
  fi
  docker compose version >/dev/null 2>&1 || falla "Falta 'docker compose'. Actualiza Docker."
  local libre_gb
  libre_gb="$(df -Pk "$HOME" | awk 'NR==2 {printf "%d", $4/1048576}')"
  if [ "${libre_gb:-99}" -lt 10 ]; then
    aviso "Solo hay ${libre_gb} GB libres en el disco. IGNIS completo necesita ~10 GB (imágenes + base de 3.6 millones de detecciones)."
    aviso "Libera espacio (Papelera, Descargas, cachés) o Docker se queda sin disco y marca 'read-only file system'."
    [ "${libre_gb:-0}" -lt 6 ] && falla "Espacio insuficiente para continuar."
  fi
  ok "Docker listo"
}

subir() {   # docker compose up con un mensaje claro si falla
  if ! docker compose "$@"; then
    echo
    aviso "Docker no pudo construir o arrancar IGNIS."
    aviso "Si dice 'read-only file system' o 'no space left': libera espacio y reinicia Docker Desktop."
    falla "Revisa el mensaje de arriba (o corre: scripts/ignis.sh registros)."
  fi
}

preparar_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    local clave; clave="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32 || true)"
    fijar_env POSTGRES_PASSWORD "$clave"
    ok "Creé .env con una contraseña aleatoria para la base de datos"
    if docker volume inspect ignis_pg_datos >/dev/null 2>&1; then
      aviso "Había una base de datos de un arranque anterior (con otra contraseña). La reinicio: se vuelve a cargar sola desde los CSV."
      docker compose --profile tunel down >/dev/null 2>&1 || true
      docker volume rm ignis_pg_datos >/dev/null 2>&1 || true
    fi
  fi
  SITE="$(valor_env SITE_ADDRESS)"; SITE="${SITE:-:80}"
  if { [ "$ACCION" = "publico" ] || [ "${SITE#:}" = "$SITE" ]; } && [ -z "$(valor_env CONTROL_CLAVE)" ]; then
    fijar_env CONTROL_CLAVE "$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 10 || true)"
    ok "Protegí el centro de control con contraseña (IGNIS será público)"
  fi
  PUERTO="$(valor_env HTTP_PORT)"; PUERTO="${PUERTO:-80}"
  if [ "${SITE#:}" != "$SITE" ]; then   # modo red local: sin dominio
    local ocupado=""
    if command -v lsof >/dev/null 2>&1; then
      ocupado="$(lsof -nP -iTCP:"$PUERTO" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -v -i -E 'docker|com\.docke|vpnkit' || true)"
    fi
    if [ -n "$ocupado" ] && [ -z "$(docker compose ps -q proxy 2>/dev/null)" ]; then
      aviso "El puerto $PUERTO está ocupado; uso el 8080."
      PUERTO=8080; fijar_env HTTP_PORT 8080
    fi
    local ip=""
    if es_mac; then   # IP de la interfaz que realmente sale a la red (Wi-Fi o cable), luego en0/en1
      local iface; iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
      case "$iface" in en*|bridge*) ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)" ;; esac
      [ -z "$ip" ] && ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
    else ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; fi
    ip="${ip:-localhost}"
    local sufijo=""; [ "$PUERTO" != "80" ] && sufijo=":$PUERTO"
    LOCAL="http://localhost$sufijo"
    RED="http://$ip$sufijo"
    [ -z "$(valor_env PUBLIC_URL)" ] && export PUBLIC_URL="$RED"
  else
    LOCAL="https://$SITE"; RED="https://$SITE"
  fi
}

esperar() {
  printf '  … preparando IGNIS'
  for _ in $(seq 1 120); do
    local id; id="$(docker compose ps -q alerta 2>/dev/null || true)"
    if [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = "healthy" ]; then echo; ok "IGNIS en línea"; return 0; fi
    printf '.'; sleep 2
  done
  echo; aviso "Tarda más de lo normal. Revisa:  scripts/ignis.sh registros"
}

enlace_tunel() {
  printf '  … creando enlace público'
  for _ in $(seq 1 45); do
    URL="$(docker compose --profile tunel logs tunel 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)"
    if [ -n "$URL" ]; then echo; return 0; fi
    printf '.'; sleep 2
  done
  echo; return 1
}

resumen() {
  titulo "lista"
  echo "  Celulares (misma Wi-Fi):  $RED"
  echo "  Centro de control:        $LOCAL/control"
  echo "  Incendios reconstruidos:  $LOCAL/eventos"
  echo "  Laboratorio:              $LOCAL/laboratorio/"
  [ -n "${URL:-}" ] && { echo; c "1;32" "  Enlace público (HTTPS, GPS real):  $URL"; echo "  Compártelo: cualquiera con internet entra desde su celular."; }
  [ -n "$(valor_env CONTROL_CLAVE)" ] && { echo; c "1;33" "  Contraseña del centro de control:  $(valor_env CONTROL_CLAVE)"; }
  echo
  echo "  La base de detecciones FIRMS se carga en segundo plano la primera vez (unos minutos)."
  echo "  Detener:  scripts/ignis.sh detener"
}

case "$ACCION" in
  iniciar|publico)
    titulo "arrancando"
    revisar_docker; preparar_env
    if [ "$ACCION" = "publico" ]; then
      subir --profile tunel up -d --build
      esperar
      if enlace_tunel; then
        PUBLIC_URL="$URL" docker compose up -d alerta >/dev/null 2>&1   # el QR del control apunta al enlace público
        ok "Enlace público: $URL"; esperar; ABRIR="$URL/control"
      else aviso "No se pudo crear el enlace público (¿sin internet?). Sigue disponible en la red local."; ABRIR="$LOCAL/control"; fi
    else
      subir up -d --build
      esperar; ABRIR="$LOCAL/control"
    fi
    resumen
    if es_mac; then open "$ABRIR" 2>/dev/null || true; fi
    ;;
  reiniciar-datos)
    titulo "reiniciando la base de detecciones"; revisar_docker
    docker compose --profile tunel down; docker volume rm ignis_pg_datos 2>/dev/null || true
    ok "Base borrada. Arranca de nuevo con: scripts/ignis.sh iniciar (se recarga sola desde los CSV)." ;;
  detener)   titulo "deteniendo"; docker compose --profile tunel stop; ok "Detenido. La base de datos se conserva." ;;
  estado)    docker compose --profile tunel ps ;;
  registros) docker compose --profile tunel logs -f --tail=100 ;;
  actualizar)
    titulo "actualizando"; git pull --ff-only; revisar_docker; preparar_env
    subir up -d --build; esperar; resumen ;;
  *) echo "Uso: scripts/ignis.sh [iniciar|publico|detener|estado|registros|actualizar|reiniciar-datos]"; exit 1 ;;
esac
