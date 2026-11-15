"""Limpieza de FIRMS sin mezclar artificialmente magnitudes MODIS/VIIRS."""

from datetime import date, datetime, time, timezone
import hashlib
import json
import math
from pathlib import Path


class InvalidDetection(ValueError):
    pass


def sensor_from_path(path: Path) -> str | None:
    """Admite data/virs (nombre pedido), data/viirs y variantes de mayúsculas."""
    for part in reversed(path.parts[:-1]):
        folder = part.lower()
        if folder == "modis":
            return "MODIS"
        if folder in {"viirs", "virs"}:
            return "VIIRS"
    return None


def optional_text(value) -> str | None:
    if value is None:
        return None
    value = str(value).strip()
    return value if value else None


def optional_float(value) -> float | None:
    s = optional_text(value)
    if s is None:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def required_float(value, field: str, low: float, high: float) -> float:
    number = optional_float(value)
    if number is None or not low <= number <= high:
        raise InvalidDetection(f"{field} inválido: {value!r}")
    return number


def parse_timestamp(acq_date, acq_time) -> datetime:
    """FIRMS usa HHMM en UTC, p. ej. 31 -> 00:31 y 631 -> 06:31."""
    try:
        d = date.fromisoformat(str(acq_date).strip())
        raw = str(acq_time).strip()
        if ":" in raw:
            hh, mm = (int(x) for x in raw.split(":", maxsplit=1))
        else:
            if raw.endswith(".0"):
                raw = raw[:-2]
            if not raw.isdigit() or len(raw) > 4:
                raise ValueError("se esperaba formato HHMM")
            raw = raw.zfill(4)
            hh, mm = int(raw[:2]), int(raw[2:])
        return datetime.combine(d, time(hour=hh, minute=mm, tzinfo=timezone.utc))
    except (ValueError, TypeError) as exc:
        raise InvalidDetection(f"fecha/hora inválida: {acq_date!r} {acq_time!r}") from exc


def clean_row(raw_row: dict, sensor: str, source_file: str, source_row: int) -> dict:
    """Devuelve columnas tipadas para PostgreSQL; lanza InvalidDetection si lo esencial falta."""
    if sensor not in {"MODIS", "VIIRS"}:
        raise InvalidDetection(f"sensor desconocido: {sensor}")
    # Los nombres de FIRMS son insensibles a mayúsculas y espacios.
    row = {str(k).strip().lower(): v for k, v in raw_row.items() if k is not None}
    lat = required_float(row.get("latitude"), "latitude", -90, 90)
    lon = required_float(row.get("longitude"), "longitude", -180, 180)
    when = parse_timestamp(row.get("acq_date"), row.get("acq_time"))
    satellite = optional_text(row.get("satellite"))
    instrument = optional_text(row.get("instrument")) or sensor
    confidence_raw = optional_text(row.get("confidence"))
    confidence_pct = optional_float(confidence_raw) if sensor == "MODIS" else None
    if confidence_pct is not None and not 0 <= confidence_pct <= 100:
        confidence_pct = None
    brightness = optional_float(row.get("brightness" if sensor == "MODIS" else "bright_ti4"))
    background = optional_float(row.get("bright_t31" if sensor == "MODIS" else "bright_ti5"))
    scan = optional_float(row.get("scan"))
    track = optional_float(row.get("track"))
    frp = optional_float(row.get("frp"))
    # Dimensiones y FRP negativas no son valores físicamente válidos.
    if scan is not None and scan <= 0:
        scan = None
    if track is not None and track <= 0:
        track = None
    if frp is not None and frp < 0:
        frp = None

    identity = [sensor, satellite, instrument, when.isoformat(), lat, lon,
                brightness, background, frp, scan, track, optional_text(row.get("version"))]
    fingerprint = hashlib.sha256(json.dumps(identity, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
    return {
        "fingerprint": fingerprint,
        "sensor": sensor,
        "satellite": satellite,
        "instrument": instrument,
        "source_file": source_file,
        "source_row": source_row,
        "detected_at": when,
        "latitude": lat,
        "longitude": lon,
        "brightness_k": brightness,
        "background_brightness_k": background,
        "frp_mw": frp,
        "scan_km": scan,
        "track_km": track,
        "confidence_raw": confidence_raw,
        "confidence_pct": confidence_pct,
        "version": optional_text(row.get("version")),
        "daynight": optional_text(row.get("daynight")),
        "type_code": optional_text(row.get("type")),
        "raw_record": row,
    }
