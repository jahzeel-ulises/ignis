CREATE SCHEMA IF NOT EXISTS fireprint;

CREATE TABLE IF NOT EXISTS fireprint.detections (
    id                   BIGSERIAL PRIMARY KEY,
    fingerprint          CHAR(64) NOT NULL UNIQUE,
    sensor               TEXT NOT NULL CHECK (sensor IN ('MODIS', 'VIIRS')),
    satellite            TEXT,
    instrument           TEXT,
    source_file          TEXT NOT NULL,
    source_row           INTEGER NOT NULL,
    detected_at          TIMESTAMPTZ NOT NULL,
    latitude             DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude            DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    brightness_k         DOUBLE PRECISION,
    background_brightness_k DOUBLE PRECISION,
    frp_mw               DOUBLE PRECISION,
    scan_km              DOUBLE PRECISION,
    track_km             DOUBLE PRECISION,
    confidence_raw       TEXT,
    confidence_pct       DOUBLE PRECISION,
    version              TEXT,
    daynight             TEXT,
    type_code            TEXT,
    raw_record           JSONB NOT NULL,
    ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detections_time
    ON fireprint.detections (detected_at);
CREATE INDEX IF NOT EXISTS idx_detections_sensor_time
    ON fireprint.detections (sensor, detected_at);
CREATE INDEX IF NOT EXISTS idx_detections_lat_lon
    ON fireprint.detections (latitude, longitude);

CREATE TABLE IF NOT EXISTS fireprint.ingestion_files (
    source_file          TEXT PRIMARY KEY,
    file_sha256          CHAR(64) NOT NULL,
    sensor               TEXT NOT NULL CHECK (sensor IN ('MODIS', 'VIIRS')),
    rows_read            BIGINT NOT NULL DEFAULT 0,
    rows_inserted        BIGINT NOT NULL DEFAULT 0,
    rows_invalid         BIGINT NOT NULL DEFAULT 0,
    invalid_samples      JSONB NOT NULL DEFAULT '[]'::jsonb,
    status               TEXT NOT NULL DEFAULT 'completed',
    processed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
