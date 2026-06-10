/**
 * map.js — MapLibre GL JS engine
 * Camadas de municípios, moldura de estados (MG/RS/ES/SC/PR/SP/RJ), fitBounds,
 * hover/tooltip, seleção, dim por região.
 */

const MapEngine = (() => {
  const SOURCE_ID            = 'municipios';
  const LAYER_FILL_OUTROS    = 'fill-outros';
  const LAYER_FILL_LIMITROFE = 'fill-limitrofe';
  const LAYER_FILL_ATUACAO   = 'fill-atuacao';
  const LAYER_LINE           = 'line-municipios';
  const LAYER_LABELS         = 'labels-municipios';
  const LAYER_LABELS_OUTROS  = 'labels-outros';

  // Zoom mínimo garantido ao focar uma região, para que os nomes dos
  // municípios de atuação (LAYER_LABELS, minzoom: 7) fiquem visíveis
  const REGION_LABEL_ZOOM   = 7.3;

  const SOURCE_ESTADOS      = 'estados';
  const LAYER_FILL_ESTADOS  = 'fill-estados';
  const LAYER_LINE_ESTADOS  = 'line-estados';
  const ESTADOS_URL         = './data/estados.json';

  // Temas de basemap — "lusystem" (CARTO dark-matter completo, recolorido
  // com a identidade da marca, mantendo nomes de cidades, rios etc.) é o
  // padrão; "classic" é o dark-matter original do CARTO, mantido como
  // opção alternável.
  const STYLE_LUSYSTEM = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const STYLE_CLASSIC  = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const THEME_KEY      = 'mapacoop-theme';

  let map              = null;
  let features         = [];
  let onSelectCallback = null;
  let selectedId       = null;
  let hoveredId        = null;
  let activeRegion     = null;
  let homeBounds       = null;
  let handlersBound    = false;
  let regionZoom       = null; // zoom da view atual (home ou região focada)
  let currentTheme     = (localStorage.getItem(THEME_KEY) === 'classic') ? 'classic' : 'lusystem';

  /* ── Lê cores da marca a partir das CSS custom properties ────── */
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function styleUrlFor(theme) {
    return theme === 'classic' ? STYLE_CLASSIC : STYLE_LUSYSTEM;
  }

  /* ── Constrói GeoJSON FeatureCollection ──────────────────── */
  function buildGeoJSON(feats) {
    return {
      type: 'FeatureCollection',
      features: feats.map(f => ({
        type: 'Feature',
        id: f.id,
        properties: { id: f.id, nome: f.nome, uf: f.uf, tipo: f.tipo, regiao: f.regiao },
        geometry: f.geometry
      }))
    };
  }

  /* ── Centro de uma feature (centroide ou bbox da geometria) ── */
  function centerOf(feat) {
    if (feat.centroide) return feat.centroide;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    function scan(c) {
      if (typeof c[0] === 'number') {
        if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0];
        if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1];
      } else {
        c.forEach(scan);
      }
    }
    if (feat.geometry && feat.geometry.coordinates) scan(feat.geometry.coordinates);
    return isFinite(w) ? [(w + e) / 2, (s + n) / 2] : null;
  }

  /* ── Calcula bbox a partir dos centroides ────────────────── */
  function calcBounds(feats) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    feats.forEach(f => {
      if (!f.centroide) return;
      const [lng, lat] = f.centroide;
      if (lng < w) w = lng; if (lng > e) e = lng;
      if (lat < s) s = lat; if (lat > n) n = lat;
    });
    if (!isFinite(w)) return null;
    return [[w - 0.3, s - 0.3], [e + 0.3, n + 0.3]];
  }

  /* ── Expressão de opacidade que respeita dim por região ─── */
  function opacityExpr(normalVal, dimVal, regionMatchExpr, selectedVal) {
    const base = regionMatchExpr ? ['case', regionMatchExpr, normalVal, dimVal] : normalVal;
    if (selectedVal === undefined) return base;
    return ['case', ['boolean', ['feature-state', 'selected'], false], selectedVal, base];
  }

  /* ── Expressão de match para o filtro de região ─────────── */
  function regionMatchExpr(regiao) {
    if (!regiao) return null;
    const uf = (regiao === 'rs') ? 'RS' : 'MG';
    return ['any',
      ['==', ['get', 'regiao'], regiao],
      ['all', ['==', ['get', 'tipo'], 'limitrofe'], ['==', ['get', 'uf'], uf]]
    ];
  }

  /* ── Adiciona source + layers ────────────────────────────── */
  function addLayers() {
    const primary   = cssVar('--lu-primary',   '#C8FF00'); // Lima Lunar — selecionado
    const secondary = cssVar('--lu-secondary', '#7BFF6A'); // Verde Neon — atuação
    const accent    = cssVar('--lu-accent',    '#00E5FF'); // Ciano Orbital — limítrofe
    const muted     = cssVar('--lu-muted',     '#8A9CB5'); // demais municípios
    const text      = cssVar('--lu-text',      '#FFFFFF');

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJSON(features),
      promoteId: 'id'
    });

    // Demais municípios (fora da área de cobertura) — mais discreto que tudo
    map.addLayer({
      id: LAYER_FILL_OUTROS,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'tipo'], 'outro'],
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], primary,
          muted
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.55,
          0.06
        ]
      }
    });

    // Limítrofes — fundo, tom neutro
    map.addLayer({
      id: LAYER_FILL_LIMITROFE,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'tipo'], 'limitrofe'],
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], primary,
          accent
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], 0.55,
          0.15
        ]
      }
    });

    // Municípios de atuação — destaque verde
    map.addLayer({
      id: LAYER_FILL_ATUACAO,
      type: 'fill',
      source: SOURCE_ID,
      filter: ['==', ['get', 'tipo'], 'atuacao'],
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'selected'], false], primary,
          secondary
        ],
        'fill-opacity': 0.65
      }
    });

    // Bordas de todos os municípios
    map.addLayer({
      id: LAYER_LINE,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': [
          'match', ['get', 'tipo'],
          'atuacao',   'rgba(11, 59, 38, 0.85)',
          'limitrofe', hexToRgba(accent, 0.50),
          'outro',     'rgba(220, 226, 235, 0.30)',
          'rgba(0, 0, 0, 0.3)'
        ],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 9, 0.9, 12, 1.5]
      }
    });

    // Labels dos municípios de atuação (aparecem a partir do zoom 7)
    map.addLayer({
      id: LAYER_LABELS,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'tipo'], 'atuacao'],
      minzoom: 7,
      layout: {
        'text-field': ['get', 'nome'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 9, 11, 13],
        'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
        'text-max-width': 8,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': text,
        'text-halo-color': 'rgba(0, 0, 0, 0.85)',
        'text-halo-width': 1.5
      }
    });

    // Labels dos demais municípios (limítrofes e outros) — discretos,
    // só aparecem com mais zoom para não competir com a área de atuação
    map.addLayer({
      id: LAYER_LABELS_OUTROS,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['!=', ['get', 'tipo'], 'atuacao'],
      minzoom: 9,
      layout: {
        'text-field': ['get', 'nome'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 8, 13, 11],
        'text-font': ['Noto Sans Regular', 'Arial Unicode MS Regular'],
        'text-max-width': 8,
        'text-allow-overlap': false,
        'text-optional': true
      },
      paint: {
        'text-color': muted,
        'text-halo-color': 'rgba(0, 0, 0, 0.75)',
        'text-halo-width': 1
      }
    });
  }

  /* ── Moldura dos estados — fundo, abaixo dos municípios ── */
  function addEstadosLayer(geojson) {
    if (map.getSource(SOURCE_ESTADOS)) return;

    const accent = cssVar('--lu-accent', '#00E5FF'); // Ciano Orbital

    map.addSource(SOURCE_ESTADOS, {
      type: 'geojson',
      data: geojson
    });

    // Preenchimento sutil — não compete com os municípios
    map.addLayer({
      id: LAYER_FILL_ESTADOS,
      type: 'fill',
      source: SOURCE_ESTADOS,
      paint: {
        'fill-color': accent,
        'fill-opacity': 0.04
      }
    }, LAYER_FILL_OUTROS);

    // Contorno de estado — mais marcado que as bordas de município
    map.addLayer({
      id: LAYER_LINE_ESTADOS,
      type: 'line',
      source: SOURCE_ESTADOS,
      paint: {
        'line-color': hexToRgba(accent, 0.55),
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.7, 8, 1.4, 12, 2.2],
        'line-dasharray': [2, 1.5]
      }
    }, LAYER_FILL_OUTROS);
  }

  function loadEstados() {
    if (map.getSource(SOURCE_ESTADOS)) return;
    fetch(ESTADOS_URL)
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then(geojson => addEstadosLayer(geojson))
      .catch(err => console.warn('[Mapa] Camada de estados falhou:', err));
  }

  /* ── Recolore o basemap CARTO com a paleta Lu System ─────────── */
  function applyBrandBasemap() {
    const bg    = cssVar('--lu-bg',     '#0A0F1E'); // Deep Space
    const bgMid = cssVar('--lu-bg-mid', '#132040'); // Midnight
    const muted = cssVar('--lu-muted',  '#8A9CB5');

    const style = map.getStyle();
    if (!style || !style.layers) return;

    style.layers.forEach(layer => {
      const id = layer.id;
      try {
        if (id === 'background') {
          map.setPaintProperty(id, 'background-color', bg);
        } else if (layer.type === 'fill' && /^(landcover|landuse|park)/.test(id)) {
          map.setPaintProperty(id, 'fill-color', bg);
        } else if (layer.type === 'fill' && /^water/.test(id)) {
          map.setPaintProperty(id, 'fill-color', bgMid);
        } else if (layer.type === 'fill' && id === 'building-top') {
          map.setPaintProperty(id, 'fill-color', bgMid);
        } else if (layer.type === 'line' && /^(road|bridge|tunnel|rail|boundary|aeroway|waterway)/.test(id)) {
          map.setPaintProperty(id, 'line-color', muted);
          map.setPaintProperty(id, 'line-opacity', 0.18);
        }
      } catch (err) {
        // algumas combinações layer/propriedade podem não existir — ignora
      }
    });
  }

  /* ── Hover: cursor + tooltip ─────────────────────────────── */
  function setupHover() {
    const layers = [LAYER_FILL_ATUACAO, LAYER_FILL_LIMITROFE, LAYER_FILL_OUTROS];

    layers.forEach(layer => {
      map.on('mousemove', layer, e => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features[0];
        if (hoveredId !== null && hoveredId !== f.id) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
        }
        hoveredId = f.id;
        map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: true });
        const p = f.properties;
        if (typeof UI !== 'undefined') {
          UI.showTooltip(p.nome, p.uf, p.tipo);
          UI.moveTooltip(e.originalEvent);
        }
      });

      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = '';
        if (hoveredId !== null) {
          map.setFeatureState({ source: SOURCE_ID, id: hoveredId }, { hover: false });
        }
        hoveredId = null;
        if (typeof UI !== 'undefined') UI.hideTooltip();
      });
    });
  }

  /* ── Click: seleciona município ──────────────────────────── */
  function setupClick() {
    const layers = [LAYER_FILL_ATUACAO, LAYER_FILL_LIMITROFE, LAYER_FILL_OUTROS];
    layers.forEach(layer => {
      map.on('click', layer, e => {
        if (!e.features.length) return;
        e.originalEvent.stopPropagation();
        const f = e.features[0];
        const feat = features.find(ft => ft.id === f.id);
        selectById(f.id, feat || f.properties);
      });
    });

    // Click fora dos municípios: deseleciona
    map.on('click', e => {
      const hits = map.queryRenderedFeatures(e.point, { layers });
      if (!hits.length) {
        if (selectedId !== null) selectById(selectedId, null);
      }
    });
  }

  /* ── fitBounds na view home ──────────────────────────────── */
  function fitHome(opts) {
    if (homeBounds && map) {
      map.fitBounds(homeBounds, Object.assign({ padding: 40, duration: 400 }, opts || {}));
      map.once('moveend', () => { regionZoom = map.getZoom(); });
    }
  }

  /* ── Reaplica seleção e filtro de região após troca de estilo ── */
  function reapplyState() {
    if (selectedId !== null && map.getSource(SOURCE_ID)) {
      map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: true });
    }
    if (activeRegion) filterByRegion(activeRegion);
  }

  /* ── Executado a cada (re)carregamento de estilo ─────────── */
  function onStyleLoad() {
    if (currentTheme === 'lusystem') applyBrandBasemap();
    addLayers();
    loadEstados();
    if (!handlersBound) {
      setupHover();
      setupClick();
      handlersBound = true;
    }
    if (regionZoom === null) regionZoom = map.getZoom();
    reapplyState();
  }

  /* ── init / render ───────────────────────────────────────── */
  function init(data, _ignoredEl, onSelect) {
    features         = (data && data.features) ? data.features : [];
    onSelectCallback = onSelect || null;
    homeBounds       = calcBounds(features);

    map = new maplibregl.Map({
      container: 'map',
      style: styleUrlFor(currentTheme),
      bounds: homeBounds,
      fitBoundsOptions: { padding: 40 },
      attributionControl: { compact: true }
    });

    map.on('style.load', onStyleLoad);

    return map;
  }

  function render(data, _el, onSelect) {
    init(data, null, onSelect);
    return features.length;
  }

  /* ── Seleciona feature ───────────────────────────────────── */
  function selectById(id, data) {
    if (selectedId !== null) {
      if (map && map.getSource(SOURCE_ID)) {
        map.setFeatureState({ source: SOURCE_ID, id: selectedId }, { selected: false });
      }
    }

    if (selectedId === id) {
      selectedId = null;
      if (typeof UI !== 'undefined') { UI.hideInfoPanel(); UI.deselectListItem(); }
      return;
    }

    selectedId = id;
    if (map && map.getSource(SOURCE_ID)) {
      map.setFeatureState({ source: SOURCE_ID, id }, { selected: true });
    }
    if (typeof UI !== 'undefined') { UI.showInfoPanel(data || {}); UI.selectListItem(id); }

    // Centraliza no município selecionado, mantendo o zoom da região (+1)
    const feat = features.find(f => f.id === id);
    const center = feat ? centerOf(feat) : null;
    if (center && map) {
      const baseZoom = (regionZoom !== null) ? regionZoom : map.getZoom();
      map.easeTo({ center, zoom: baseZoom + 1, duration: 600 });
    }

    if (onSelectCallback) onSelectCallback(id, data);
  }

  /* ── Filtra por região (dim) ─────────────────────────────── */
  function filterByRegion(regiao) {
    if (!map) return;
    activeRegion = regiao || null;
    const matchEx = regionMatchExpr(regiao);

    const atuOpacity    = opacityExpr(0.65, 0.07,  matchEx);
    const limOpacity    = opacityExpr(0.15, 0.05,  matchEx, 0.55);
    const outrosOpacity = opacityExpr(0.06, 0.015, matchEx, 0.55);
    const lineOpacity   = opacityExpr(1.0,  0.07,  matchEx);

    if (map.getLayer(LAYER_FILL_ATUACAO))   map.setPaintProperty(LAYER_FILL_ATUACAO,   'fill-opacity', atuOpacity);
    if (map.getLayer(LAYER_FILL_LIMITROFE)) map.setPaintProperty(LAYER_FILL_LIMITROFE, 'fill-opacity', limOpacity);
    if (map.getLayer(LAYER_FILL_OUTROS))    map.setPaintProperty(LAYER_FILL_OUTROS,    'fill-opacity', outrosOpacity);
    if (map.getLayer(LAYER_LINE))           map.setPaintProperty(LAYER_LINE,            'line-opacity', lineOpacity);
  }

  /* ── Fit para uma região ─────────────────────────────────── */
  function fitToRegion(regiao) {
    if (!map) return;
    if (regiao === 'todos') {
      activeRegion = null;
      fitHome();
      return;
    }
    activeRegion = regiao;
    // Usa apenas os municípios de atuação da própria zona — limítrofes têm
    // regiao vazia e cobrem o estado inteiro, o que centralizava o foco
    // no meio de MG em vez da zona oeste/leste específica.
    const regional = features.filter(f => f.regiao === regiao);
    const bounds = calcBounds(regional);
    if (!bounds) return;
    map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 500 });
    // Garante zoom suficiente para os nomes dos municípios aparecerem
    // (rótulos de atuação a partir do zoom 7)
    map.once('moveend', () => {
      if (map.getZoom() < REGION_LABEL_ZOOM) {
        map.easeTo({ zoom: REGION_LABEL_ZOOM, duration: 300 });
        map.once('moveend', () => { regionZoom = map.getZoom(); });
      } else {
        regionZoom = map.getZoom();
      }
    });
  }

  /* ── API pública ─────────────────────────────────────────── */
  return {
    render,
    init,
    loadBrasil:     () => Promise.resolve(),
    zoomIn:         () => map && map.zoomIn(),
    zoomOut:        () => map && map.zoomOut(),
    reset:          () => { activeRegion = null; fitHome(); },
    resize:         () => map && map.resize(),

    /* Re-enquadra após mudança real de viewport (resize/orientação) —
       mantém o município selecionado em foco, ou volta à área home. */
    refitOnResize: () => {
      if (!map) return;
      if (selectedId !== null) {
        const feat = features.find(f => f.id === selectedId);
        const center = feat ? centerOf(feat) : null;
        if (center) {
          const baseZoom = (regionZoom !== null) ? regionZoom : map.getZoom();
          map.easeTo({ center, zoom: baseZoom + 1, duration: 0 });
          return;
        }
      }
      if (!activeRegion) fitHome({ duration: 0 });
    },
    filter:         filterByRegion,
    fitToRegion,
    select:         selectById,
    getFeatureById: id => features.find(f => f.id === id),
    getTheme:       () => currentTheme,
    setTheme: theme => {
      const next = (theme === 'classic') ? 'classic' : 'lusystem';
      if (next === currentTheme) return;
      currentTheme = next;
      localStorage.setItem(THEME_KEY, currentTheme);
      if (map) map.setStyle(styleUrlFor(currentTheme));
    }
  };
})();
