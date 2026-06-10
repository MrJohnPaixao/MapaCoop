"""
enrich_indicadores.py — Enriquece data/municipios.json com indicadores do IBGE
(Censo Demográfico 2022 + PIB dos Municípios), casando por código IBGE de
7 dígitos via SIDRA API (apisidra.ibge.gov.br).

Uso:
  python enrich_indicadores.py             # usa cache em data/ibge_raw/, baixa o que faltar
  python enrich_indicadores.py --refresh   # ignora cache e rebaixa tudo

Tabelas usadas (validadas no Passo 1):
  4714  - População residente, área e densidade demográfica (Censo 2022)
  9514  - População residente por sexo e idade (Censo 2022)
  9923  - População residente por situação do domicílio (urbana/rural) (Censo 2022)
  10268 - Pessoas de 10 anos+ ocupadas e nível de ocupação (Censo 2022 - Trabalho e Rendimento)
  5938  - PIB dos Municípios (ano mais recente: 2023)

PIB per capita não existe em nível municipal -> calculado aqui (opção A
aprovada): PIB(2023) x 1000 / população(2022), marcado como estimativa.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

MUNICIPIOS_PATH = 'data/municipios.json'
CACHE_DIR = 'data/ibge_raw'
SIDRA = 'https://apisidra.ibge.gov.br/values'
BATCH = 100
SLEEP = 0.3

FONTE_CENSO = 'IBGE - Censo Demográfico 2022'
FONTE_TRABALHO = 'IBGE - Censo Demográfico 2022 (Trabalho e Rendimento)'
FONTE_PIB = 'IBGE - PIB dos Municípios'

# Faixas etárias agregadas a partir das categorias quinquenais da tabela 9514
AGE_BUCKETS = {
    '0_14':   [93070, 93084, 93085],
    '15_64':  [93086, 93087, 93088, 93089, 93090, 93091, 93092, 93093, 93094, 93095],
    '65_mais': [93096, 93097, 93098, 49108, 49109, 60040, 60041],
}
ALL_AGE_CODES = [c for codes in AGE_BUCKETS.values() for c in codes]

NAO_DISPONIVEL = {'', None, '...', '..', '-', 'X'}


def fetch(url, cache_key, refresh=False):
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, cache_key + '.json')
    if os.path.exists(path) and not refresh:
        with open(path, encoding='utf-8') as f:
            return json.load(f)

    req = urllib.request.Request(url, headers={'User-Agent': 'MapaCoop-LuSystem/1.0'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            time.sleep(SLEEP)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            print(f'    tentativa {attempt + 1} falhou ({cache_key}): {e}')
            time.sleep(1)
    print(f'    ERRO: falha definitiva em {cache_key} -- {url}')
    return None


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


def main():
    refresh = '--refresh' in sys.argv

    with open(MUNICIPIOS_PATH, encoding='utf-8') as f:
        data = json.load(f)
    feats = data['features']
    ids = [f['id'] for f in feats]

    result = {i: {} for i in ids}

    print(f'{len(ids)} municípios a enriquecer\n')

    # 1. Demografia: população, área, densidade (tabela 4714)
    print('Baixando demografia (população / área / densidade)...')
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/4714/n6/{codigos}/v/93,6318,614/p/2022'
        d = fetch(url, f'demografia_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, var, val = row['D1C'], row['D2C'], row['V']
            if val in NAO_DISPONIVEL:
                continue
            if var == '93':
                result[mid]['populacao'] = int(val)
            elif var == '6318':
                result[mid]['area_km2'] = float(val)
            elif var == '614':
                result[mid]['densidade'] = float(val)

    # 2. População por sexo (tabela 9514, c2=4/5 Homens/Mulheres, idade=Total)
    print('Baixando população por sexo...')
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/9514/n6/{codigos}/v/93/p/2022/c2/4,5/c287/100362/c286/113635'
        d = fetch(url, f'sexo_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, val = row['D1C'], row['V']
            if val in NAO_DISPONIVEL:
                continue
            key = 'populacao_homens' if row['D4C'] == '4' else 'populacao_mulheres'
            result[mid][key] = int(val)

    # 3. Faixa etária (tabela 9514, sexo=Total, idade=categorias quinquenais)
    print('Baixando faixa etária...')
    age_codes = ','.join(str(c) for c in ALL_AGE_CODES)
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/9514/n6/{codigos}/v/93/p/2022/c2/6794/c287/{age_codes}/c286/113635'
        d = fetch(url, f'idade_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, val = row['D1C'], row['V']
            if val in NAO_DISPONIVEL:
                continue
            age_cat = int(row['D5C'])
            for bucket, codes in AGE_BUCKETS.items():
                if age_cat in codes:
                    fe = result[mid].setdefault('faixa_etaria', {})
                    fe[bucket] = fe.get(bucket, 0) + int(val)
                    break

    # 4. População urbana/rural (tabela 9923, c1=1 Urbana / 2 Rural)
    print('Baixando população urbana/rural...')
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/9923/n6/{codigos}/v/93/p/2022/c1/1,2'
        d = fetch(url, f'urbano_rural_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, val = row['D1C'], row['V']
            key = 'populacao_urbana' if row['D4C'] == '1' else 'populacao_rural'
            if val == '-':
                # "-" = não se aplica (município 100% urbano ou 100% rural)
                result[mid][key] = 0
            elif val not in NAO_DISPONIVEL:
                result[mid][key] = int(val)

    # 5. Ocupação / Trabalho e Rendimento (tabela 10268)
    print('Baixando ocupação (Trabalho e Rendimento)...')
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/10268/n6/{codigos}/v/140,696,675/p/2022/c2/6794/c86/95251/c58/95253'
        d = fetch(url, f'ocupacao_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, var, val = row['D1C'], row['D2C'], row['V']
            if val in NAO_DISPONIVEL:
                continue
            if var == '140':
                result[mid]['pop_10_mais'] = int(val)
            elif var == '696':
                result[mid]['pop_ocupada'] = int(val)
            elif var == '675':
                result[mid]['nivel_ocupacao_pct'] = float(val)

    # 6. PIB dos Municípios (tabela 5938, ano mais recente disponível: 2023)
    print('Baixando PIB municipal (2023)...')
    for bi, batch in enumerate(chunks(ids, BATCH)):
        codigos = ','.join(batch)
        url = f'{SIDRA}/t/5938/n6/{codigos}/v/37/p/2023'
        d = fetch(url, f'pib_{bi}', refresh)
        if not d:
            continue
        for row in d[1:]:
            mid, val = row['D1C'], row['V']
            if val in NAO_DISPONIVEL:
                continue
            result[mid]['pib_mil_reais'] = float(val)

    # ── Monta o bloco "indicadores" de cada feature ────────────────────────
    cobertura = {
        'populacao': 0, 'area_km2': 0, 'densidade': 0,
        'populacao_urbana_rural': 0, 'populacao_por_sexo': 0, 'faixa_etaria': 0,
        'trabalho': 0, 'pib': 0, 'pib_per_capita': 0,
    }
    sem_trabalho = []
    sem_pib = []

    for f in feats:
        r = result[f['id']]
        ind = {}

        if 'populacao' in r:
            ind['populacao'] = {'valor': r['populacao'], 'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_CENSO}
            cobertura['populacao'] += 1
        else:
            ind['populacao'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        if 'area_km2' in r:
            ind['area_km2'] = {'valor': r['area_km2'], 'unidade': 'km²', 'ano': 2022, 'fonte': FONTE_CENSO}
            cobertura['area_km2'] += 1
        else:
            ind['area_km2'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        if 'densidade' in r:
            ind['densidade'] = {'valor': r['densidade'], 'unidade': 'hab/km²', 'ano': 2022, 'fonte': FONTE_CENSO}
            cobertura['densidade'] += 1
        else:
            ind['densidade'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        if 'populacao_urbana' in r and 'populacao_rural' in r:
            ind['populacao_urbana'] = {'valor': r['populacao_urbana'], 'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_CENSO}
            ind['populacao_rural'] = {'valor': r['populacao_rural'], 'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_CENSO}
            cobertura['populacao_urbana_rural'] += 1
        else:
            ind['populacao_urbana'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}
            ind['populacao_rural'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        if 'populacao_homens' in r and 'populacao_mulheres' in r:
            ind['populacao_por_sexo'] = {
                'homens': r['populacao_homens'], 'mulheres': r['populacao_mulheres'],
                'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_CENSO,
            }
            cobertura['populacao_por_sexo'] += 1
        else:
            ind['populacao_por_sexo'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        fe = r.get('faixa_etaria', {})
        if len(fe) == 3:
            ind['faixa_etaria'] = {
                '0_14': fe['0_14'], '15_64': fe['15_64'], '65_mais': fe['65_mais'],
                'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_CENSO,
            }
            cobertura['faixa_etaria'] += 1
        else:
            ind['faixa_etaria'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_CENSO}

        if 'pop_ocupada' in r:
            ind['trabalho'] = {
                'pop_10_anos_ou_mais': r.get('pop_10_mais'),
                'populacao_ocupada': r['pop_ocupada'],
                'nivel_ocupacao_pct': r.get('nivel_ocupacao_pct'),
                'unidade': 'habitantes', 'ano': 2022, 'fonte': FONTE_TRABALHO,
            }
            cobertura['trabalho'] += 1
        else:
            ind['trabalho'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_TRABALHO}
            sem_trabalho.append(f['nome'])

        if 'pib_mil_reais' in r:
            ind['pib'] = {'valor': r['pib_mil_reais'], 'unidade': 'mil R$', 'ano': 2023, 'fonte': FONTE_PIB}
            cobertura['pib'] += 1
            if 'populacao' in r and r['populacao'] > 0:
                per_capita = (r['pib_mil_reais'] * 1000) / r['populacao']
                ind['pib_per_capita'] = {
                    'valor': round(per_capita, 2), 'unidade': 'R$',
                    'ano': '2023/2022', 'estimativa': True,
                    'calculo': 'PIB 2023 ÷ população residente 2022',
                    'fonte': f'{FONTE_PIB} + {FONTE_CENSO}',
                }
                cobertura['pib_per_capita'] += 1
            else:
                ind['pib_per_capita'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_PIB}
        else:
            ind['pib'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_PIB}
            ind['pib_per_capita'] = {'valor': None, 'disponivel': False, 'fonte': FONTE_PIB}
            sem_pib.append(f['nome'])

        f['indicadores'] = ind

    with open(MUNICIPIOS_PATH, 'w', encoding='utf-8') as out:
        json.dump(data, out, ensure_ascii=False, separators=(',', ':'))

    total = len(feats)
    print(f'\n=== Cobertura ({total} municípios) ===')
    for k, v in cobertura.items():
        print(f'  {k:24s}: {v}/{total} ({v / total * 100:.1f}%)')

    if sem_trabalho:
        print(f'\nSem dado de "trabalho" (sigilo amostral do Censo 2022): {len(sem_trabalho)} município(s)')
        print('  ' + ', '.join(sem_trabalho[:30]) + (' ...' if len(sem_trabalho) > 30 else ''))

    if sem_pib:
        print(f'\nSem dado de PIB: {len(sem_pib)} município(s)')
        print('  ' + ', '.join(sem_pib[:30]) + (' ...' if len(sem_pib) > 30 else ''))

    kb = os.path.getsize(MUNICIPIOS_PATH) / 1024
    print(f'\nSalvo: {MUNICIPIOS_PATH} ({kb:.0f} KB)')


if __name__ == '__main__':
    main()
