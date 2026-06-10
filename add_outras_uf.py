#!/usr/bin/env python3
"""
Adiciona os municípios de SC, PR e SP ao municipios.json como tipo 'outro'
(fora da área de cobertura), com geometria simplificada, para que suas
bordas apareçam no mapa junto com os demais "outros" (MG/RS/ES).

Fonte da geometria: tbrugz/geodata-br (geojs-<uf>-mun.json), já cacheada
em _tmp/<uf>_geojs.json.
"""
import json
import math

UFS = [
    ('42', 'SC', '_tmp/sc_geojs.json'),
    ('41', 'PR', '_tmp/pr_geojs.json'),
    ('35', 'SP', '_tmp/sp_geojs.json'),
    ('33', 'RJ', '_tmp/rj_geojs.json'),
]

MUNICIPIOS_PATH = 'data/municipios.json'
TOL = 0.006


def centroide(geometry):
    coords = []
    def flatten(c):
        if isinstance(c[0], (int, float)):
            coords.append(c)
        else:
            for sub in c:
                flatten(sub)
    flatten(geometry['coordinates'])
    if not coords:
        return None
    lon = sum(c[0] for c in coords) / len(coords)
    lat = sum(c[1] for c in coords) / len(coords)
    return [round(lon, 5), round(lat, 5)]


def point_line_dist(p, a, b):
    if a == b:
        return math.hypot(p[0]-a[0], p[1]-a[1])
    dx, dy = b[0]-a[0], b[1]-a[1]
    t = ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)
    t = max(0, min(1, t))
    return math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy)


def douglas_peucker(coords, tol=TOL):
    if len(coords) <= 2:
        return coords
    dmax, idx = 0, 0
    for i in range(1, len(coords)-1):
        d = point_line_dist(coords[i], coords[0], coords[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        left = douglas_peucker(coords[:idx+1], tol)
        right = douglas_peucker(coords[idx:], tol)
        return left[:-1] + right
    return [coords[0], coords[-1]]


def simplify_ring(ring, tol=TOL):
    pts = [[p[0], p[1]] for p in ring]
    simplified = douglas_peucker(pts, tol)
    return [[round(p[0], 4), round(p[1], 4)] for p in simplified]


def simplify_geometry(geom, tol=TOL):
    t = geom['type']
    if t == 'Polygon':
        new_coords = [simplify_ring(ring, tol) for ring in geom['coordinates']]
        return {'type': 'Polygon', 'coordinates': new_coords}
    elif t == 'MultiPolygon':
        new_coords = [
            [simplify_ring(ring, tol) for ring in poly]
            for poly in geom['coordinates']
        ]
        return {'type': 'MultiPolygon', 'coordinates': new_coords}
    return geom


def main():
    with open(MUNICIPIOS_PATH, encoding='utf-8') as f:
        data = json.load(f)

    existing_ids = {f['id'] for f in data['features']}
    novos = []
    import os
    for codigo_uf, sigla, path in UFS:
        if not os.path.exists(path):
            print(f"{sigla}: arquivo {path} não encontrado, pulando")
            continue
        with open(path, encoding='utf-8') as f:
            geojs = json.load(f)
        count = 0
        for feat in geojs['features']:
            p = feat['properties']
            cod = p.get('id', '')
            if cod in existing_ids:
                continue
            nome = p.get('name', '')
            geom_simple = simplify_geometry(feat['geometry'])
            ct = centroide(feat['geometry'])
            novos.append({
                'id': cod,
                'nome': nome,
                'uf': sigla,
                'tipo': 'outro',
                'regiao': None,
                'centroide': ct,
                'geometry': geom_simple
            })
            count += 1
        print(f"{sigla}: {count} municípios adicionados")

    data['features'].extend(novos)
    data['meta']['total'] = len(data['features'])

    with open(MUNICIPIOS_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))

    kb = len(open(MUNICIPIOS_PATH, encoding='utf-8').read()) / 1024
    print(f"\nSalvo: {MUNICIPIOS_PATH} ({kb:.0f} KB), total de features: {data['meta']['total']}")


if __name__ == '__main__':
    main()
