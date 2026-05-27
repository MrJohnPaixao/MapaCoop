#!/usr/bin/env python3
"""
Processa os GeoJSONs brutos do IBGE e gera o arquivo municipios.json otimizado
para uso no PWA da cooperativa.
"""
import json
import math
import unicodedata

ATUACAO = {
    "mg-oeste": {
        "label": "MG Oeste / Sul",
        "municipios": [
            "Passos","Guaxupé","Muzambinho","Monte Belo","Cabo Verde","Nova Resende",
            "Alpinópolis","Cássia","Delfinópolis","São Sebastião do Paraíso","Itamogi",
            "Monte Santo de Minas","Guaranésia","Juruaia","Bom Jesus da Penha",
            "São Pedro da União","Jacuí","Fortaleza de Minas","Pratápolis","Itaú de Minas",
            "Capetinga","São Tomás de Aquino","Claraval","Ibiraci","São José da Barra",
            "Capitólio","São João Batista do Glória","Arceburgo"
        ]
    },
    "mg-leste": {
        "label": "MG Leste / Caratinga",
        "municipios": [
            "Caratinga","Piedade de Caratinga","Inhápim","São Domingos das Dores",
            "São Sebastião do Anta","Imbé de Minas","Ubaporanga","Simonésia",
            "Santa Rita de Minas","Santa Bárbara do Leste","Manhuaçu",
            "Santana do Manhuaçu","Manhumirim","Reduto","Martins Soares",
            "São João do Manhuaçu","Luisburgo","Alto Jequitibá","Alto Caparaó",
            "Caparaó","Matipó","Abre Campo","Pedra Bonita","Santa Margarida",
            "Caputira","Durandé","São José do Mantimento","Conceição de Ipanema",
            "Ipanema","Chalé","Lajinha","Mutum","Taparuba","Pocrane","Alvarenga",
            "Entre Folhas","Bom Jesus do Galho","Córrego Novo","Vargem Alegre"
        ]
    },
    "rs": {
        "label": "RS Noroeste",
        "municipios": [
            "Santo Augusto","Coronel Bicaco","São Valério do Sul","Chiapetta",
            "Nova Ramada","Condor","Ajuricaba","Panambi","Bozano","Ijuí",
            "Coronel Barros","Augusto Pestana","Jóia"
        ]
    }
}


def norm(s):
    s = s.lower().strip()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s


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


def douglas_peucker(coords, tol=0.006):
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


def simplify_ring(ring, tol):
    pts = [[p[0], p[1]] for p in ring]
    simplified = douglas_peucker(pts, tol)
    return [[round(p[0], 4), round(p[1], 4)] for p in simplified]


def simplify_geometry(geom, tol=0.006):
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


def process_state(filepath, uf, lookup, tol=0.006):
    print(f"Processando {uf}...")
    with open(filepath, encoding='utf-8') as f:
        data = json.load(f)
    features = []
    for feat in data['features']:
        p = feat['properties']
        nome = p.get('name', '')
        cod = p.get('id', '')
        regiao = lookup.get(norm(nome))
        tipo = 'atuacao' if regiao else 'limitrofe'
        geom_simple = simplify_geometry(feat['geometry'], tol)
        ct = centroide(feat['geometry'])
        features.append({
            'id': cod,
            'nome': nome,
            'uf': uf,
            'tipo': tipo,
            'regiao': regiao or '',
            'centroide': ct,
            'geometry': geom_simple
        })
    n_atu = sum(1 for f in features if f['tipo'] == 'atuacao')
    print(f"  {uf}: {len(features)} total, {n_atu} atuação, {len(features)-n_atu} limítrofes")
    return features


def main():
    # Build lookup: norm(nome) -> regiao_id
    lookup = {}
    for reg_id, reg in ATUACAO.items():
        for m in reg['municipios']:
            lookup[norm(m)] = reg_id

    mg_features = process_state('data/mg_raw.json', 'MG', lookup)
    rs_features = process_state('data/rs_raw.json', 'RS', lookup)

    all_features = mg_features + rs_features
    n_atu = sum(1 for f in all_features if f['tipo'] == 'atuacao')

    output = {
        'meta': {
            'total': len(all_features),
            'atuacao': n_atu,
            'limitrofe': len(all_features) - n_atu,
            'regioes': {k: v['label'] for k, v in ATUACAO.items()},
            'municipios_atuacao': {k: v['municipios'] for k, v in ATUACAO.items()}
        },
        'features': all_features
    }

    out_path = 'data/municipios.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',', ':'))

    kb = len(open(out_path).read()) / 1024
    print(f"\nSalvo: {out_path} ({kb:.0f} KB)")

    # Verificação
    encontrados = {norm(f['nome']) for f in all_features if f['tipo'] == 'atuacao'}
    faltando = []
    for reg_id, reg in ATUACAO.items():
        for m in reg['municipios']:
            if norm(m) not in encontrados:
                faltando.append(f"{m} ({reg_id})")
    if faltando:
        print(f"\n⚠️  Não encontrados: {faltando}")
    else:
        print("✅ Todos os municípios de atuação mapeados com sucesso!")

    return output['meta']


if __name__ == '__main__':
    import os
    os.chdir('/home/claude/mapa-coop')
    meta = main()
    print(f"\nResumo: {meta['atuacao']} municípios de atuação, {meta['limitrofe']} limítrofes")
