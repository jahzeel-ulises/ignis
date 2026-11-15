# IGNIS - arranque en un comando para Windows (necesita Docker Desktop).
#   powershell -ExecutionPolicy Bypass -File scripts\ignis.ps1 iniciar|publico|detener|estado|registros|actualizar
param([string]$Accion = "iniciar")
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Titulo($t) { Write-Host ""; Write-Host "▲ IGNIS · $t" -ForegroundColor DarkYellow }
function Ok($t)     { Write-Host "  ✓ $t" -ForegroundColor Green }
function Aviso($t)  { Write-Host "  ! $t" -ForegroundColor Yellow }
function Falla($t)  { Write-Host "  ✗ $t" -ForegroundColor Red; exit 1 }

function Valor-Env($clave) {
  if (-not (Test-Path .env)) { return "" }
  $l = Get-Content .env | Where-Object { $_ -match "^$clave=" } | Select-Object -Last 1
  if ($l) { return ($l -split "=", 2)[1].Trim('"') } else { return "" }
}
function Fijar-Env($clave, $valor) {
  $lineas = @(Get-Content .env)
  if ($lineas -match "^$clave=") { $lineas = $lineas | ForEach-Object { if ($_ -match "^$clave=") { "$clave=$valor" } else { $_ } } }
  else { $lineas += "$clave=$valor" }
  [System.IO.File]::WriteAllLines((Join-Path (Get-Location) ".env"), [string[]]$lineas)
}

function Revisar-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Aviso "Falta Docker Desktop. Instálalo desde https://www.docker.com/products/docker-desktop/ y vuelve a abrir IGNIS."
    Start-Process "https://www.docker.com/products/docker-desktop/"; exit 1
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
    if (Test-Path $exe) { Aviso "Abriendo Docker Desktop…"; Start-Process $exe }
    for ($i = 0; $i -lt 90; $i++) { docker info *> $null; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2 }
    docker info *> $null; if ($LASTEXITCODE -ne 0) { Falla "Docker no está corriendo. Ábrelo y vuelve a intentar." }
  }
  docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Falla "Falta 'docker compose'. Actualiza Docker Desktop." }
  $libre = [math]::Floor((Get-PSDrive -Name ($env:SystemDrive.TrimEnd(':'))).Free / 1GB)
  if ($libre -lt 10) {
    Aviso "Solo hay $libre GB libres en el disco. IGNIS completo necesita ~10 GB (imágenes + base de 3.6 millones de detecciones)."
    Aviso "Libera espacio o Docker se queda sin disco y marca 'read-only file system'."
    if ($libre -lt 6) { Falla "Espacio insuficiente para continuar." }
  }
  Ok "Docker listo"
}

function Preparar-Env {
  if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    $clave = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
    Fijar-Env "POSTGRES_PASSWORD" $clave
    Ok "Creé .env con una contraseña aleatoria para la base de datos"
    docker volume inspect ignis_pg_datos *> $null
    if ($LASTEXITCODE -eq 0) {
      Aviso "Había una base de datos de un arranque anterior (con otra contraseña). La reinicio: se vuelve a cargar sola desde los CSV."
      docker compose --profile tunel down *> $null; docker volume rm ignis_pg_datos *> $null
    }
  }
  $script:Site = Valor-Env "SITE_ADDRESS"; if (-not $script:Site) { $script:Site = ":80" }
  if ((($Accion -eq "publico") -or -not $script:Site.StartsWith(":")) -and -not (Valor-Env "CONTROL_CLAVE")) {
    Fijar-Env "CONTROL_CLAVE" (-join ((48..57) + (97..122) | Get-Random -Count 10 | ForEach-Object { [char]$_ }))
    Ok "Protegí el centro de control con contraseña (IGNIS será público)"
  }
  $script:Puerto = Valor-Env "HTTP_PORT"; if (-not $script:Puerto) { $script:Puerto = "80" }
  if ($script:Site.StartsWith(":")) {
    $usado = Get-NetTCPConnection -LocalPort ([int]$script:Puerto) -State Listen -ErrorAction SilentlyContinue |
      Where-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName -notmatch "docker|wslrelay|vpnkit|com.docker" }
    if ($usado -and -not (docker compose ps -q proxy 2>$null)) { Aviso "El puerto $($script:Puerto) está ocupado; uso el 8080."; $script:Puerto = "8080"; Fijar-Env "HTTP_PORT" "8080" }
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notmatch "^(127\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)" -and $_.InterfaceAlias -notmatch "vEthernet|WSL|Loopback|Docker" } |
      Sort-Object -Property InterfaceMetric | Select-Object -First 1).IPAddress
    if (-not $ip) { $ip = "localhost" }
    $suf = if ($script:Puerto -ne "80") { ":$($script:Puerto)" } else { "" }
    $script:Local = "http://localhost$suf"; $script:Red = "http://$ip$suf"
    if (-not (Valor-Env "PUBLIC_URL")) { $env:PUBLIC_URL = $script:Red }
  } else { $script:Local = "https://$($script:Site)"; $script:Red = $script:Local }
}

function Esperar {
  Write-Host -NoNewline "  … preparando IGNIS"
  for ($i = 0; $i -lt 120; $i++) {
    $id = docker compose ps -q alerta 2>$null
    if ($id -and ((docker inspect -f "{{.State.Health.Status}}" $id 2>$null) -eq "healthy")) { Write-Host ""; Ok "IGNIS en línea"; return }
    Write-Host -NoNewline "."; Start-Sleep 2
  }
  Write-Host ""; Aviso "Tarda más de lo normal. Revisa los registros con la opción 'registros'."
}

function Enlace-Tunel {
  Write-Host -NoNewline "  … creando enlace público"
  for ($i = 0; $i -lt 45; $i++) {
    $m = (docker compose --profile tunel logs tunel 2>&1 | Out-String) | Select-String -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches
    if ($m) { Write-Host ""; return $m.Matches[-1].Value }
    Write-Host -NoNewline "."; Start-Sleep 2
  }
  Write-Host ""; return $null
}

function Resumen($url) {
  Titulo "lista"
  Write-Host "  Celulares (misma Wi-Fi):  $($script:Red)"
  Write-Host "  Centro de control:        $($script:Local)/control"
  Write-Host "  Incendios reconstruidos:  $($script:Local)/eventos"
  Write-Host "  Laboratorio:              $($script:Local)/laboratorio/"
  if ($url) { Write-Host ""; Write-Host "  Enlace público (HTTPS, GPS real):  $url" -ForegroundColor Green; Write-Host "  Compártelo: cualquiera con internet entra desde su celular." }
  $clave = Valor-Env "CONTROL_CLAVE"
  if ($clave) { Write-Host ""; Write-Host "  Contraseña del centro de control:  $clave" -ForegroundColor Yellow }
  Write-Host ""
  Write-Host "  La base de detecciones FIRMS se carga en segundo plano la primera vez (unos minutos)."
  Write-Host "  Si los celulares no abren la página, permite 'Docker Desktop Backend' en el Firewall de Windows."
}

switch ($Accion) {
  { $_ -in "iniciar", "publico" } {
    Titulo "arrancando"; Revisar-Docker; Preparar-Env; $url = $null
    if ($Accion -eq "publico") {
      docker compose --profile tunel up -d --build; if ($LASTEXITCODE -ne 0) { Aviso "Si dice read-only file system o no space left: libera espacio y reinicia Docker Desktop."; Falla "No se pudo levantar IGNIS." }
      Esperar; $url = Enlace-Tunel
      if ($url) { $env:PUBLIC_URL = $url; docker compose up -d alerta *> $null; Ok "Enlace público: $url"; Esperar; $abrir = "$url/control" }
      else { Aviso "No se pudo crear el enlace público (¿sin internet?)."; $abrir = "$($script:Local)/control" }
    } else {
      docker compose up -d --build; if ($LASTEXITCODE -ne 0) { Aviso "Si dice read-only file system o no space left: libera espacio y reinicia Docker Desktop."; Falla "No se pudo levantar IGNIS." }
      Esperar; $abrir = "$($script:Local)/control"
    }
    Resumen $url; Start-Process $abrir
  }
  "reiniciar-datos" { Titulo "reiniciando la base de detecciones"; Revisar-Docker; docker compose --profile tunel down; docker volume rm ignis_pg_datos 2>$null; Ok "Base borrada. Arranca de nuevo con la opción iniciar." }
  "detener"   { Titulo "deteniendo"; docker compose --profile tunel stop; Ok "Detenido. La base de datos se conserva." }
  "estado"    { docker compose --profile tunel ps }
  "registros" { docker compose --profile tunel logs -f --tail=100 }
  "actualizar" { Titulo "actualizando"; git pull --ff-only; Revisar-Docker; Preparar-Env; docker compose up -d --build; Esperar; Resumen $null }
  default { Write-Host "Uso: scripts\ignis.ps1 [iniciar|publico|detener|estado|registros|actualizar|reiniciar-datos]"; exit 1 }
}
