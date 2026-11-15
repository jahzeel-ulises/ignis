# IGNIS Alerta — simulación en vivo

Una laptop corre el servidor. Todos los celulares de la sala se conectan con el QR y, cuando el centro de control lanza un incendio, la alerta "viaja" desde el foco como una onda: a cada celular le suena según su distancia.

## Arrancar (en la laptop)

```
pip3 install fastapi "uvicorn[standard]" httpx pandas pyarrow "qrcode[pil]"
python3 server.py
```

- Centro de control (proyectarlo): http://localhost:8000/control
- Celulares: escanean el QR del control (misma red Wi-Fi).

La tabla `data/calendario_celdas.parquet` es la serie armonizada MODIS→VIIRS. Si la regeneran, solo reemplácenla.

## Ubicación en los celulares

Los navegadores solo dan el GPS en páginas HTTPS. Hay dos opciones:

1. **Demo rápida (sin HTTPS):** cada persona toca el mapa o presiona "Ubicarme en la zona de demo" (Tierra Caliente, Guerrero, la zona #1 del país).
2. **GPS real:** abrir un túnel HTTPS gratuito y usar esa URL en el QR:
   ```
   cloudflared tunnel --url http://localhost:8000
   PUBLIC_URL=https://<la-url-que-da-cloudflared> python3 server.py
   ```

## Guion de la demo (2 minutos)

1. Proyectar el control y pedir a la sala que escanee el QR, ponga su nombre y elija perfil.
2. Elegir el mes (abril) y tocar el punto del incendio.
3. **LANZAR ALERTA.** La onda sale del foco y los celulares suenan en orden de distancia: rojo dentro del radio, ámbar al doble del radio.
4. En un celular: "Ver ruta de salida" → abrir en Google Maps. En uno de personal especializado: "Qué hacer" muestra viento, pendiente, personas en zona y propagación estimada.
5. **Avanzar 30 min:** el fuego se mueve con el viento y las rutas se recalculan.

## Acceso

- **Ciudadano:** solo nombre.
- **Personal especializado:** nombre y código de credencial. Código de demo: `CONAFOR-2026` (se cambia con la variable `IGNIS_CODIGO`). En producción se validaría contra el padrón de CONAFOR o Protección Civil.

La portada del login es una animación con datos reales: 24 años de fuego armonizado en México, mes a mes, dibujados sobre la costa (Natural Earth, dominio público). No requiere internet.

## Lo que verá el público

- **Pre-alerta con cuenta regresiva:** mientras la onda viaja, el celular muestra "Alerta de incendio en camino · 3, 2, 1" con el borde de la pantalla latiendo en rojo. Después llega la alerta completa con sirena.
- **Bitácora en vivo** en el centro de control: quién se unió, quién recibió la alerta (con distancia y segundos) y quién marcó "Estoy a salvo". Los puntos se pintan de rojo al alertarse y de verde al estar a salvo.
- **Interruptor día/noche con fuego:** de día, una llama viva sobre cielo de atardecer; de noche, una brasa con chispas y estrellas. Cambia también el mapa base.
- Chispas animadas en la bienvenida, foco con ondas expansivas, vuelo del mapa hacia el incendio, avisos flotantes, carga con siluetas y cifras que se animan al aparecer.
- Respeta "reducir movimiento" del sistema: quien lo tenga activo ve la app sin animaciones.

## Prueba automática

Antes de entregar se corrió una prueba de punta a punta con un centro de control y 4 celulares simulados (peligro, precaución, aviso lejano y sin ubicación): 21 de 21 comprobaciones correctas, sin errores de JavaScript y sin respuestas fallidas del servidor.

## Lo que el reto exige y dónde está

| Requisito del reto | Dónde está en IGNIS | Estado |
|---|---|---|
| Serie armonizada MODIS + VIIRS donde el sensor ya no importa | `armonizar.py` → `data/calendario_celdas.parquet` (eventos ≥20 MW en unidades VIIRS) | ✅ Validado: R² 0.917 en 2022–2025 por celda y mes |
| Calendario de actividad de quema mes × año desde inicios de los 2000 | Explorar → "Calendario del área" (jul 2002 → hoy) | ✅ |
| Elegir un área en el mapa | Explorar → "Analizar el área visible" (zoom a la zona) | ✅ |
| Elegir un área con lat/lon | Explorar → "O escribe coordenadas" (latitud, longitud, radio) | ✅ |
| Elegir rango de fechas | Explorar → Desde / Hasta | ✅ (por año) |
| Comparar el mes actual contra la mediana histórica | Tarjeta de anomalía (% contra la mediana y percentil) | ✅ |
| Descargar analíticas | Calendario CSV + Resumen analítico JSON | ✅ |
| Descargar CSV de hotspots | "Detecciones CSV" (requiere `data/modis.parquet` y `data/viirs.parquet`) | ✅ |
| Rampas de color accesibles | Rampa secuencial de un solo tono (naranja) en mapa y calendario; valores también en texto | ✅ |
| Usar datos de NASA FIRMS | MODIS C6.1 Aqua + VIIRS 375 m S-NPP / NOAA-20 | ✅ |

Pendientes que conviene decir en la presentación: el rango de fechas es por año (no por día) y la región es el rectángulo de México.

## Mapas base

Igual que la app Streamlit del equipo, el mapa usa **OpenStreetMap**. En la esquina superior derecha se cambia a **satélite (Esri)** u **oscuro (CARTO)**. Los tres necesitan internet.

## Qué es real y qué es simulado

| Real | Simulado / orientativo |
|---|---|
| Historia de la zona (calendario armonizado NASA FIRMS 2002–2026) | El incendio y su posición |
| Viento actual y elevación (Open-Meteo, si hay internet) | Velocidad y dirección de propagación (heurística viento + pendiente) |
| Rutas en Google Maps | El radio de peligro |

Sin internet, el viento usa un valor de respaldo (12 km/h desde el este) y el control lo marca como "(simulado)".
