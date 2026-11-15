"""Armoniza la intensidad del fuego (FRP, Fire Radiative Power) de MODIS a escala VIIRS.

Por qué: MODIS (1 km, desde 2002) y VIIRS (375 m, desde 2012) miden la misma energía radiada
con píxeles distintos, así que el FRP por detección no es comparable entre sensores. Igual que
la serie de eventos armonizados (calendario_celdas.parquet), aquí se ajusta la relación entre
ambos en los años en que vuelan juntos y se convierte MODIS a "unidades VIIRS".

Método
1. Celdas de 0.1° (las mismas del calendario armonizado) y meses.
2. Por celda-mes y sensor: FRP total (MW), FRP máximo, número de detecciones.
3. Ajuste log-log en 2012-2025 sobre celda-mes con ambos sensores:
       log(FRP_VIIRS) = a + b · log(FRP_MODIS)
4. Serie armonizada: VIIRS desde 2012; MODIS convertido con el ajuste antes de 2012.

Salida: data/frp_celdas.parquet  y  data/frp_ajuste.json (coeficientes y R²).
Uso:    python herramientas/armonizar_frp.py        (desde la carpeta alerta/)
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[1] / 'data'


def agregar(nombre: str) -> pd.DataFrame:
    d = pd.read_parquet(DATA / f'{nombre}.parquet', columns=['latitude', 'longitude', 'acq_date', 'frp', 'year'])
    d = d[d.frp.notna() & (d.frp > 0)]
    d['lat_c'] = (np.floor(d.latitude * 10) / 10 + .05).round(2)
    d['lon_c'] = (np.floor(d.longitude * 10) / 10 + .05).round(2)
    d['month'] = pd.to_datetime(d.acq_date).dt.month.astype('int8')
    g = d.groupby(['lat_c', 'lon_c', 'year', 'month']).frp.agg(frp_total='sum', frp_max='max', detecciones='size').reset_index()
    print(f'{nombre}: {len(d):,} detecciones → {len(g):,} celda-mes')
    return g


def main():
    m, v = agregar('modis'), agregar('viirs')
    llaves = ['lat_c', 'lon_c', 'year', 'month']
    par = m.merge(v, on=llaves, suffixes=('_m', '_v'))
    par = par[(par.year >= 2012) & (par.year <= 2025)]
    x, y = np.log(par.frp_total_m), np.log(par.frp_total_v)
    b, a = np.polyfit(x, y, 1)
    r2_celda = 1 - np.sum((y - (a + b * x)) ** 2) / np.sum((y - y.mean()) ** 2)
    # validación a escala nacional mensual: MODIS convertido contra VIIRS observado
    conv = m.assign(frp_conv=np.exp(a) * m.frp_total ** b)
    nac_m = conv[(conv.year >= 2012) & (conv.year <= 2025)].groupby(['year', 'month']).frp_conv.sum()
    nac_v = v[(v.year >= 2012) & (v.year <= 2025)].groupby(['year', 'month']).frp_total.sum()
    j = pd.concat([nac_m, nac_v], axis=1, keys=['m', 'v']).dropna()
    r2_nac = float(np.corrcoef(j.m, j.v)[0, 1] ** 2)
    ajuste = {'a': float(a), 'b': float(b), 'r2_celda_mes': round(float(r2_celda), 3), 'r2_nacional_mensual': round(r2_nac, 3),
              'pares': int(len(par)), 'periodo_ajuste': [2012, 2025],
              'formula': 'FRP_VIIRS ≈ exp(a) · FRP_MODIS^b  (FRP total por celda 0.1° y mes, MW)'}
    print(json.dumps(ajuste, indent=2, ensure_ascii=False))

    # serie armonizada: VIIRS desde 2012, MODIS convertido antes
    pre = conv[conv.year < 2012].rename(columns={'frp_conv': 'frp_armonizado'})
    pre['frp_max_armonizado'] = np.exp(a) * pre.frp_max ** b
    pre['fuente'] = 'MODIS convertido'
    post = v[v.year >= 2012].assign(frp_armonizado=lambda d: d.frp_total, frp_max_armonizado=lambda d: d.frp_max, fuente='VIIRS')
    cols = llaves + ['frp_armonizado', 'frp_max_armonizado', 'detecciones', 'fuente']
    out = pd.concat([pre[cols], post[cols]], ignore_index=True)
    out['frp_armonizado'] = out.frp_armonizado.astype('float32').round(2)
    out['frp_max_armonizado'] = out.frp_max_armonizado.astype('float32').round(2)
    out['detecciones'] = out.detecciones.astype('int32')
    out['year'] = out.year.astype('int16')
    out['fuente'] = out.fuente.astype('category')
    out.sort_values(llaves).to_parquet(DATA / 'frp_celdas.parquet', index=False, compression='zstd')
    (DATA / 'frp_ajuste.json').write_text(json.dumps(ajuste, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'frp_celdas.parquet: {len(out):,} filas')


if __name__ == '__main__':
    main()
