"""
Baixa e simplifica os limites dos estados brasileiros para a camada de fundo.

Fonte:
https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-00-uf.json
"""

import json
import math
import os
import struct
from collections import defaultdict
from urllib.error import HTTPError, URLError
import urllib.request


ESTADOS_URL = "https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-00-uf.json"
BRASIL_MUN_URL = "https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-100-mun.json"
RAW_PATH = os.path.join("data", "estados_raw.json")
OUT_PATH = os.path.join("data", "brasil.json")
PAIS_SHP_PATH = os.path.join("BR_Pais_2025", "BR_Pais_2025.shp")
ESTADOS_TOLERANCE = 0.025
PAIS_TOLERANCE = 0.015
PAIS_MIN_AREA = 0.0005


UF_NOMES = {
    "AC": "Acre",
    "AL": "Alagoas",
    "AP": "Amapa",
    "AM": "Amazonas",
    "BA": "Bahia",
    "CE": "Ceara",
    "DF": "Distrito Federal",
    "ES": "Espirito Santo",
    "GO": "Goias",
    "MA": "Maranhao",
    "MT": "Mato Grosso",
    "MS": "Mato Grosso do Sul",
    "MG": "Minas Gerais",
    "PA": "Para",
    "PB": "Paraiba",
    "PR": "Parana",
    "PE": "Pernambuco",
    "PI": "Piaui",
    "RJ": "Rio de Janeiro",
    "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul",
    "RO": "Rondonia",
    "RR": "Roraima",
    "SC": "Santa Catarina",
    "SP": "Sao Paulo",
    "SE": "Sergipe",
    "TO": "Tocantins",
}

ID_TO_UF = {
    "12": "AC", "27": "AL", "16": "AP", "13": "AM", "29": "BA", "23": "CE",
    "53": "DF", "32": "ES", "52": "GO", "21": "MA", "51": "MT", "50": "MS",
    "31": "MG", "15": "PA", "25": "PB", "41": "PR", "26": "PE", "22": "PI",
    "33": "RJ", "24": "RN", "43": "RS", "11": "RO", "14": "RR", "42": "SC",
    "35": "SP", "28": "SE", "17": "TO",
}


def dist_point_to_segment(point, start, end):
    px, py = point
    sx, sy = start
    ex, ey = end
    dx = ex - sx
    dy = ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)
    t = max(0, min(1, ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)))
    nx = sx + t * dx
    ny = sy + t * dy
    return math.hypot(px - nx, py - ny)


def douglas_peucker(points, tolerance):
    if len(points) <= 2:
        return points

    max_dist = 0
    index = 0
    start = points[0]
    end = points[-1]
    for i in range(1, len(points) - 1):
        dist = dist_point_to_segment(points[i], start, end)
        if dist > max_dist:
            index = i
            max_dist = dist

    if max_dist > tolerance:
        left = douglas_peucker(points[: index + 1], tolerance)
        right = douglas_peucker(points[index:], tolerance)
        return left[:-1] + right
    return [start, end]


def validate_ring(ring):
    return len(ring) >= 4


def simplify_ring(ring, tolerance):
    if len(ring) <= 4:
        return ring if validate_ring(ring) else []

    closed = ring[0] == ring[-1]
    points = ring[:-1] if closed else ring
    simplified = douglas_peucker(points, tolerance)
    if len(simplified) < 3:
        simplified = points[:3]
    simplified = [[round(x, 4), round(y, 4)] for x, y in simplified]
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified if validate_ring(simplified) else []


def simplify_geometry(geometry, tolerance):
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if geom_type == "Polygon":
        rings = [simplify_ring(r, tolerance) for r in coords]
        return {"type": "Polygon", "coordinates": [r for r in rings if validate_ring(r)]}
    if geom_type == "MultiPolygon":
        polygons = []
        for poly in coords:
            rings = [simplify_ring(r, tolerance) for r in poly]
            rings = [r for r in rings if validate_ring(r)]
            if rings:
                polygons.append(rings)
        return {
            "type": "MultiPolygon",
            "coordinates": polygons,
        }
    raise ValueError(f"Tipo de geometria nao suportado: {geom_type}")


def ring_area(ring):
    if len(ring) < 4:
        return 0
    area = 0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2


def read_shp_polygon_rings(path):
    rings = []
    with open(path, "rb") as fh:
        fh.read(100)
        while True:
            record_header = fh.read(8)
            if not record_header:
                break

            _, record_length = struct.unpack(">2i", record_header)
            content = fh.read(record_length * 2)
            shape_type = struct.unpack("<i", content[:4])[0]
            if shape_type == 0:
                continue
            if shape_type not in (5, 15, 25):
                raise ValueError(f"Tipo de shape nao suportado: {shape_type}")

            offset = 4 + 32
            num_parts, num_points = struct.unpack("<2i", content[offset: offset + 8])
            offset += 8
            parts = list(struct.unpack(f"<{num_parts}i", content[offset: offset + 4 * num_parts]))
            offset += 4 * num_parts
            points = [
                struct.unpack("<2d", content[offset + index * 16: offset + index * 16 + 16])
                for index in range(num_points)
            ]
            parts.append(num_points)

            for start, end in zip(parts, parts[1:]):
                ring = [[x, y] for x, y in points[start:end]]
                if ring and ring[0] != ring[-1]:
                    ring.append(ring[0])
                if validate_ring(ring):
                    rings.append(ring)

    return rings


def country_geometry_from_shp(path):
    rings = []
    for ring in read_shp_polygon_rings(path):
        if ring_area(ring) < PAIS_MIN_AREA:
            continue
        simplified = simplify_ring(ring, PAIS_TOLERANCE)
        if validate_ring(simplified):
            rings.append(simplified)

    rings.sort(key=ring_area, reverse=True)
    return {
        "type": "MultiPolygon",
        "coordinates": [[ring] for ring in rings],
    }


def iter_polygons(geometry):
    geom_type = geometry.get("type")
    coords = geometry.get("coordinates", [])
    if geom_type == "Polygon":
        yield coords
    elif geom_type == "MultiPolygon":
        yield from coords


def norm_point(point):
    return (round(point[0], 4), round(point[1], 4))


def collect_boundary_segments(features):
    edges = {}
    for feature in features:
        for polygon in iter_polygons(feature["geometry"]):
            if not polygon:
                continue
            ring = polygon[0]
            for index in range(len(ring) - 1):
                start = norm_point(ring[index])
                end = norm_point(ring[index + 1])
                if start == end:
                    continue
                key = tuple(sorted((start, end)))
                if key in edges:
                    del edges[key]
                else:
                    edges[key] = (start, end)
    return list(edges.values())


def assemble_rings(segments):
    by_start = defaultdict(list)
    for start, end in segments:
        by_start[start].append(end)
        by_start[end].append(start)

    unused = {tuple(sorted((start, end))) for start, end in segments}
    rings = []

    while unused:
        edge = next(iter(unused))
        start, current = edge
        ring = [start, current]
        unused.remove(edge)

        while current != start:
            candidates = by_start[current]
            next_point = None
            for candidate in candidates:
                key = tuple(sorted((current, candidate)))
                if key in unused:
                    next_point = candidate
                    unused.remove(key)
                    break
            if next_point is None:
                break
            ring.append(next_point)
            current = next_point

        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append([[x, y] for x, y in ring])

    return rings


def state_geometry_from_municipios(features):
    rings = [simplify_ring(r, ESTADOS_TOLERANCE) for r in assemble_rings(collect_boundary_segments(features))]
    rings = [r for r in rings if validate_ring(r)]
    return {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]}


def build_from_municipios(raw):
    grouped = defaultdict(list)
    for feature in raw.get("features", []):
        mun_id = str(feature.get("properties", {}).get("id", ""))
        uf = ID_TO_UF.get(mun_id[:2])
        if uf:
            grouped[uf].append(feature)

    estados = []
    for uf, state_features in grouped.items():
        estados.append({
            "id": uf,
            "nome": UF_NOMES[uf],
            "geometry": state_geometry_from_municipios(state_features),
        })
    estados.sort(key=lambda item: item["id"])
    return estados


def feature_uf(feature):
    props = feature.get("properties", {})
    for key in ("sigla", "SIGLA", "uf", "UF"):
        value = props.get(key)
        if isinstance(value, str) and len(value) == 2:
            return value.upper()

    for key in ("id", "codarea", "CD_GEOCUF", "geocodigo", "GEOCODIGO"):
        value = feature.get(key, props.get(key))
        if value is not None:
            uf = ID_TO_UF.get(str(value)[:2])
            if uf:
                return uf

    feature_id = str(feature.get("id", ""))
    uf = ID_TO_UF.get(feature_id[:2])
    if uf:
        return uf
    raise ValueError(f"UF nao encontrada para feature: {props}")


def feature_name(feature, uf):
    props = feature.get("properties", {})
    for key in ("nome", "name", "NOME", "NM_ESTADO"):
        value = props.get(key)
        if value:
            return value
    return UF_NOMES[uf]


def state_to_polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def main():
    os.makedirs("data", exist_ok=True)
    source = ESTADOS_URL
    if not os.path.exists(RAW_PATH):
        try:
            urllib.request.urlretrieve(source, RAW_PATH)
        except HTTPError as err:
            if err.code != 404:
                raise
            source = BRASIL_MUN_URL
            urllib.request.urlretrieve(source, RAW_PATH)
        except URLError:
            raise FileNotFoundError(f"{RAW_PATH} nao encontrado e nao foi possivel baixar a fonte")

    with open(RAW_PATH, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    if source == BRASIL_MUN_URL or len(raw.get("features", [])) > 100:
        estados = build_from_municipios(raw)
    else:
        estados = []
        for feature in raw.get("features", []):
            uf = feature_uf(feature)
            estados.append({
                "id": uf,
                "nome": feature_name(feature, uf),
                "geometry": simplify_geometry(feature["geometry"], ESTADOS_TOLERANCE),
            })
        estados.sort(key=lambda item: item["id"])

    if os.path.exists(PAIS_SHP_PATH):
        pais_geometry = country_geometry_from_shp(PAIS_SHP_PATH)
    else:
        pais_polygons = []
        for estado in estados:
            pais_geometry = simplify_geometry(estado["geometry"], PAIS_TOLERANCE)
            pais_polygons.extend(state_to_polygons(pais_geometry))
        pais_geometry = {
            "type": "MultiPolygon",
            "coordinates": pais_polygons,
        }

    result = {
        "pais": {
            "geometry": pais_geometry,
        },
        "estados": estados,
        "estados_destaque": ["MG", "RS"],
    }

    with open(OUT_PATH, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"))

    size = os.path.getsize(OUT_PATH)
    print(f"Gerado {OUT_PATH} ({size / 1024:.1f} KB, {len(estados)} estados)")


if __name__ == "__main__":
    main()
