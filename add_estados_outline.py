#!/usr/bin/env python3
"""
Adiciona o contorno (dissolve dos municípios) de SC, PR e SP ao
estados.json, para diferenciar visualmente cada estado no mapa,
do mesmo jeito que já existe para MG/ES/RS.
"""
import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

ESTADOS_PATH = 'data/estados.json'
TOL = 0.01  # graus — simplificação leve do contorno final

UFS = [
    ('42', 'SC', 'Santa Catarina', '_tmp/sc_geojs.json'),
    ('41', 'PR', 'Paraná', '_tmp/pr_geojs.json'),
    ('35', 'SP', 'São Paulo', '_tmp/sp_geojs.json'),
    ('33', 'RJ', 'Rio de Janeiro', '_tmp/rj_geojs.json'),
]


def round_geom(geom, casas=4):
    def rnd(coords):
        if isinstance(coords[0], (int, float)):
            return [round(c, casas) for c in coords]
        return [rnd(c) for c in coords]
    g = mapping(geom)
    g['coordinates'] = rnd(g['coordinates'])
    return g


def main():
    with open(ESTADOS_PATH, encoding='utf-8') as f:
        estados = json.load(f)

    existing_siglas = {f['properties']['sigla'] for f in estados['features']}

    for codigo_uf, sigla, nome, path in UFS:
        if sigla in existing_siglas:
            print(f"{sigla}: já presente, pulando")
            continue
        with open(path, encoding='utf-8') as f:
            geojs = json.load(f)
        polys = [shape(feat['geometry']).buffer(0) for feat in geojs['features']]
        dissolved = unary_union(polys)
        simplified = dissolved.simplify(TOL, preserve_topology=True)
        geom = round_geom(simplified)
        estados['features'].append({
            'type': 'Feature',
            'properties': {'codigo_uf': codigo_uf, 'sigla': sigla, 'nome': nome},
            'geometry': geom
        })
        print(f"{sigla}: {geom['type']}, {len(geom['coordinates'])} parte(s)")

    with open(ESTADOS_PATH, 'w', encoding='utf-8') as f:
        json.dump(estados, f, ensure_ascii=False, separators=(',', ':'))

    kb = len(open(ESTADOS_PATH, encoding='utf-8').read()) / 1024
    print(f"\nSalvo: {ESTADOS_PATH} ({kb:.0f} KB), total estados: {len(estados['features'])}")


if __name__ == '__main__':
    main()
