# 🌿 Mapa de Atuação — Cooperativa

Mapa interativo PWA da área de atuação das cooperativas Sicredi em MG e RS.

## 📁 Estrutura do Projeto

```
mapa-coop/
├── index.html          # Página principal (entry point PWA)
├── manifest.json       # Manifesto PWA (ícones, nome, cor)
├── sw.js               # Service Worker (cache offline)
├── process_data.py     # Script para reprocessar dados geográficos
│
├── css/
│   └── style.css       # Estilos completos (responsivo, mobile-first)
│
├── js/
│   ├── map.js          # Motor de mapa: projeção, SVG, pan/zoom
│   ├── ui.js           # Interface: sidebar, tooltip, painel, lista
│   └── app.js          # Orquestrador: init, PWA install, eventos
│
├── data/
│   ├── municipios.json # Dados processados (gerado pelo script Python)
│   ├── mg_raw.json     # GeoJSON bruto MG (fonte: geodata-br GitHub)
│   └── rs_raw.json     # GeoJSON bruto RS (fonte: geodata-br GitHub)
│
└── icons/
    ├── icon-72.png
    ├── icon-96.png
    ├── icon-128.png
    ├── icon-144.png
    ├── icon-152.png
    ├── icon-192.png
    ├── icon-384.png
    └── icon-512.png
```

## 🚀 Como usar

### Opção 1 — Servidor local simples (recomendado para teste)

**Python:**
```bash
cd mapa-coop
python3 -m http.server 8080
# Acesse: http://localhost:8080
```

**Node.js:**
```bash
npx serve .
```

### Opção 2 — Hospedar gratuitamente

**GitHub Pages:**
1. Crie um repositório no GitHub
2. Faça upload de todos os arquivos
3. Ative GitHub Pages em Settings → Pages

**Netlify (drag & drop):**
1. Acesse netlify.com
2. Arraste a pasta `mapa-coop` para a área de deploy
3. Pronto — URL pública gerada automaticamente

**Vercel:**
```bash
npx vercel deploy
```

## 📱 PWA — Instalar no celular

Após acessar via HTTPS:
- **Android (Chrome):** Toque no banner "Instalar como app" ou menu → "Adicionar à tela inicial"
- **iPhone (Safari):** Toque em Compartilhar → "Adicionar à Tela de Início"
- Funciona **offline** após o primeiro acesso

## 🔄 Atualizar dados geográficos

Se precisar adicionar/remover municípios, edite `process_data.py` e execute:

```bash
cd mapa-coop

# Baixar dados atualizados do IBGE (via geodata-br)
curl -o data/mg_raw.json https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-31-mun.json
curl -o data/rs_raw.json https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-43-mun.json

# Reprocessar
python3 process_data.py
```

## 🎨 Personalização

### Cores (css/style.css)
```css
:root {
  --verde:       #2d6a4f;  /* cor principal */
  --verde-claro: #52b788;  /* municípios de atuação */
  --verde-bg:    #d8f3dc;  /* municípios limítrofes */
  --amarelo:     #f4a261;  /* município selecionado */
}
```

### Nome da cooperativa (index.html)
```html
<h1>Área de Atuação</h1>
<p>Mapa Interativo · Cooperativa</p>
```

### Municípios (process_data.py → rodar novamente)
Edite o dicionário `ATUACAO` no script e reprocesse.

## 🛠️ Funcionalidades

- [x] Mapa SVG interativo com 661 municípios (80 de atuação + 581 limítrofes)
- [x] Pan (arrastar) e zoom (scroll / pinch no mobile)
- [x] Clique no município → painel de informações
- [x] Sidebar com lista de municípios por região
- [x] Busca por nome de município
- [x] Filtro por região (MG Oeste, MG Leste, RS)
- [x] Legenda e estatísticas
- [x] PWA instalável no celular
- [x] Funciona offline após primeiro acesso
- [x] Responsivo (mobile / tablet / desktop)
- [x] Dados geográficos reais (IBGE via geodata-br)

## 📊 Dados

| Região | Municípios de atuação |
|---|---|
| MG Oeste / Sul | 28 |
| MG Leste / Caratinga | 39 |
| RS Noroeste | 13 |
| **Total** | **80** |

Fonte geográfica: [geodata-br](https://github.com/tbrugz/geodata-br) (dados IBGE)
