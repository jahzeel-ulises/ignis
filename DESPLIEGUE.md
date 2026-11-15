# Cómo poner IGNIS en línea

Tres caminos, de más fácil a más profesional. Los tres usan el mismo `docker-compose.yml`.

| | Para qué | Costo | Tiempo | HTTPS y GPS |
|---|---|---|---|---|
| **A. Laptop en la sala** | Demo en vivo con los celulares en la misma Wi-Fi | $0 | 5 min | No (ubicación de demo) |
| **B. Laptop + enlace público** | Que cualquiera entre desde internet hoy mismo | $0 | 5 min | Sí |
| **C. Servidor con dominio** | Sitio permanente: `https://tu-dominio.mx` | ~$5–12 USD/mes | 20 min | Sí |

En los tres necesitas **Docker Desktop** (Mac o Windows) o **Docker** (Linux): https://www.docker.com/products/docker-desktop/

---

## A. Laptop en la sala (Mac o Windows)

1. Instala y abre Docker Desktop.
2. Doble clic en **`IGNIS-Mac.command`** (Mac) o **`IGNIS-Windows.bat`** (Windows) y elige **1**.
   - En Mac, la primera vez: clic derecho → **Abrir** (macOS pide confirmar archivos descargados).
3. Se abre el centro de control. Proyéctalo; los celulares escanean el QR.

El lanzador crea `.env` con una contraseña aleatoria, detecta la IP de la laptop, cambia al puerto 8080 si el 80 está ocupado y espera a que todo esté listo.
Para detener: **`Detener-IGNIS-Mac.command`** o **`Detener-IGNIS-Windows.bat`**.

> Windows: si los celulares no abren la página, permite **Docker Desktop Backend** en el Firewall de Windows (redes privadas).

## B. Laptop + enlace público (sin servidor ni dominio)

Igual que A, pero elige **2**. Se crea un enlace como `https://algo-al-azar.trycloudflare.com` con HTTPS real:
- Cualquier persona con internet entra desde su celular, aunque no esté en tu Wi-Fi.
- Funciona el GPS real, el botón Compartir y la pantalla siempre encendida.
- El QR del centro de control apunta solo al enlace público.
- El centro de control queda protegido con contraseña (aparece en pantalla).

El enlace cambia cada vez que se inicia y depende de que la laptop siga encendida. Es ideal para la presentación y para que los jueces lo prueben.

## C. Servidor con dominio propio

### 1. Consigue un servidor y un dominio
- **Servidor (VPS) Linux** con al menos **2 GB de RAM** y 20 GB de disco: DigitalOcean, Hetzner, AWS Lightsail, Google Cloud, Azure (estudiantes: GitHub Student Pack trae créditos).
  Ubuntu 24.04 es la opción más sencilla.
- **Dominio**: en tu proveedor de dominios crea un registro **A** que apunte a la IP del servidor, por ejemplo `ignis.tu-dominio.mx → 203.0.113.10`.

### 2. Instala Docker en el servidor
```bash
ssh usuario@IP-del-servidor
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

### 3. Baja el proyecto y configúralo
```bash
git clone https://github.com/TU-USUARIO/ignis.git
cd ignis
cp .env.example .env
nano .env
```
En `.env` cambia:
```
SITE_ADDRESS=ignis.tu-dominio.mx
POSTGRES_PASSWORD=una-contraseña-larga-y-única
CONTROL_CLAVE=contraseña-del-centro-de-control
```

### 4. Arranca
```bash
bash scripts/ignis.sh iniciar
```
Caddy obtiene el certificado HTTPS solo (abre los puertos **80 y 443** en el firewall del proveedor). En unos minutos:
- `https://ignis.tu-dominio.mx` — app para todos
- `https://ignis.tu-dominio.mx/control` — centro de control (pide la contraseña)
- `https://ignis.tu-dominio.mx/eventos` — incendios reconstruidos
- `https://ignis.tu-dominio.mx/laboratorio/` — laboratorio

### 5. Actualizar después de un `git push`
```bash
cd ignis && bash scripts/ignis.sh actualizar
```

---

## Comandos útiles (cualquier sistema)

| Acción | Mac / Linux | Windows (PowerShell) |
|---|---|---|
| Iniciar | `bash scripts/ignis.sh iniciar` | `.\scripts\ignis.ps1 iniciar` |
| Enlace público | `bash scripts/ignis.sh publico` | `.\scripts\ignis.ps1 publico` |
| Estado | `bash scripts/ignis.sh estado` | `.\scripts\ignis.ps1 estado` |
| Registros | `bash scripts/ignis.sh registros` | `.\scripts\ignis.ps1 registros` |
| Detener | `bash scripts/ignis.sh detener` | `.\scripts\ignis.ps1 detener` |

## Preguntas frecuentes

**¿Cuánto tarda la primera vez?** Construir las imágenes, 3–6 minutos. La base de detecciones FIRMS (3.6 millones de filas) se carga sola en segundo plano en ~10 minutos; mientras tanto todo lo demás ya funciona.

**¿Se pierden los datos al apagar?** No. La base vive en un volumen de Docker. Solo `docker compose down -v` la borra.

**¿Qué está expuesto a internet?** Solo el proxy (puertos 80/443). PostgreSQL, la API de datos y el motor de eventos viven en una red privada.

**¿Puedo usar otro puerto?** Sí: `HTTP_PORT=8080` en `.env`.
