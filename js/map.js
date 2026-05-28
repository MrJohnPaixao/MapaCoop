/**
 * map.js — Motor de renderização do mapa SVG
 * Zoom/pan via SVG group transform. Labels com tamanho visual fixo (compensação).
 * Bordas com espessura fixa via vector-effect: non-scaling-stroke (CSS).
 */

const MapEngine = (() => {
  const VW = 960;
  const VH = 600;
  const MIN_ZOOM          = 0.75;
  const MAX_ZOOM          = 120;
  const WHEEL_ZOOM_IN     = 1.14;
  const WHEEL_ZOOM_OUT    = 0.88;
  const BUTTON_ZOOM_IN    = 1.40;
  const BUTTON_ZOOM_OUT   = 0.72;
  const REGION_FIT_PAD    = 18;
  const REGION_FIT_BOOST  = 10;
  const REGION_MAX_ZOOM   = 90;
  const LABEL_VIEW_PAD     = 24;
  const CULL_MIN_ZOOM      = 1.5;
  const CULL_VIEW_PAD      = 50;
  const LABEL_PX          = 11;   // tamanho visual desejado dos labels em px de tela
  const LABEL_ZOOM_THRESH = 2.5;  // zoom mínimo para mostrar labels na visão geral

  let features         = [];
  let projection       = null;
  let svgEl            = null;
  let groupEl          = null;
  let groupPais        = null;
  let groupEstados     = null;
  let groupLabels      = null;
  let containerEl      = null;
  let brasilData       = null;
  let transform        = { x: 0, y: 0, k: 1 };
  const homeTransform  = { x: 0, y: 0, k: 1 };
  let activeRegion     = null;
  let isDragging       = false;
  let dragStart        = null;
  let dragTransformStart = null;
  let lastTouchDist    = null;
  let onSelectCallback = null;
  let selectedId       = null;
  let interactionSetup = false;
  let animFrame        = null;
  let cullTimer        = null;

  /* ─── Projeção (bbox real das geometrias) ─────────────── */
  function buildProjection(feats, W, H, padding = 32) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;

    function scanCoords(c) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number') {
        if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
        if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      } else c.forEach(scanCoords);
    }

    feats.forEach(f => {
      if (f.geometry?.coordinates) scanCoords(f.geometry.coordinates);
    });
    if (!isFinite(x0)) {
      feats.forEach(f => {
        const c = f.centroide; if (!c) return;
        if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
        if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
      });
    }

    const bx = (x1 - x0) * 0.05, by = (y1 - y0) * 0.05;
    x0 -= bx; x1 += bx; y0 -= by; y1 += by;
    const sx = (W - padding * 2) / (x1 - x0);
    const sy = (H - padding * 2) / (y1 - y0);
    const s  = Math.min(sx, sy);
    const ox = padding + ((W - padding * 2) - (x1 - x0) * s) / 2;
    const oy = padding + ((H - padding * 2) - (y1 - y0) * s) / 2;
    return (lon, lat) => [ox + (lon - x0) * s, oy + (y1 - lat) * s];
  }

  /* ─── Geometry → SVG path string ─────────────────────── */
  function ringToPath(ring, proj) {
    if (!ring || ring.length < 2) return '';
    return ring.map((pt, i) => {
      const [x, y] = proj(pt[0], pt[1]);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join('') + 'Z';
  }

  function geometryToPath(geom, proj) {
    if (!geom) return '';
    const { type, coordinates } = geom;
    if (type === 'Polygon')      return coordinates.map(r => ringToPath(r, proj)).join(' ');
    if (type === 'MultiPolygon') return coordinates.map(p => p.map(r => ringToPath(r, proj)).join(' ')).join(' ');
    return '';
  }

  function makeSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  function projectionFeatures() {
    const estados = (brasilData?.estados || []).map(estado => ({ geometry: estado.geometry }));
    return features.concat(estados);
  }

  function createGroups() {
    svgEl.innerHTML = '';

    groupPais = makeSvgEl('g');
    groupPais.id = 'g-brasil-pais';
    svgEl.appendChild(groupPais);

    groupEstados = makeSvgEl('g');
    groupEstados.id = 'g-brasil-estados';
    svgEl.appendChild(groupEstados);

    groupEl = makeSvgEl('g');
    groupEl.id = 'map-g';
    svgEl.appendChild(groupEl);

    groupLabels = makeSvgEl('g');
    groupLabels.id = 'g-labels';
    svgEl.appendChild(groupLabels);
  }

  function renderBrasil() {
    if (!brasilData || !projection || !groupPais || !groupEstados) return;

    const paisPath = makeSvgEl('path');
    paisPath.setAttribute('d', geometryToPath(brasilData.pais.geometry, projection));
    paisPath.setAttribute('class', 'brasil-pais');
    groupPais.appendChild(paisPath);

    const destaques = new Set(brasilData.estados_destaque || ['MG', 'RS']);
    brasilData.estados.forEach(estado => {
      const d = geometryToPath(estado.geometry, projection);
      if (!d) return;
      const path = makeSvgEl('path');
      path.setAttribute('d', d);
      path.setAttribute('class', `brasil-estado${destaques.has(estado.id) ? ' estado-destaque' : ''}`);
      path.dataset.uf = estado.id;
      groupEstados.appendChild(path);
    });
  }

  /* ─── Render ──────────────────────────────────────────── */
  function renderMunicipios() {
    const sorted = [...features].sort((a, b) => {
      if (a.tipo === 'limitrofe' && b.tipo === 'atuacao') return -1;
      if (a.tipo === 'atuacao'  && b.tipo === 'limitrofe') return 1;
      return 0;
    });

    sorted.forEach(feat => {
      const d = geometryToPath(feat.geometry, projection);
      if (!d) return;
      const path = makeSvgEl('path');
      path.setAttribute('d', d);
      path.setAttribute('class', `muni-path ${feat.tipo}`);
      path.dataset.id     = feat.id;
      path.dataset.nome   = feat.nome;
      path.dataset.uf     = feat.uf;
      path.dataset.tipo   = feat.tipo;
      path.dataset.regiao = feat.regiao;
      path.addEventListener('mouseenter', onPathHover);
      path.addEventListener('mousemove',  onPathMove);
      path.addEventListener('mouseleave', onPathLeave);
      path.addEventListener('click',      onPathClick);
      path.addEventListener('touchstart', onPathTouchStart, { passive: true });
      path.addEventListener('touchend',   onPathTouchEnd, { passive: true });
      groupEl.appendChild(path);
    });

    features.filter(f => f.tipo === 'atuacao').forEach(feat => {
      if (!feat.centroide) return;
      const [cx, cy] = projection(feat.centroide[0], feat.centroide[1]);
      addLabel(cx, cy, feat.nome, feat.regiao);
    });

  }

  function drawLayers() {
    createGroups();
    renderBrasil();
    renderMunicipios();
    applyTransform();
  }

  function render(data, svg, onSelect) {
    features         = data.features || [];
    svgEl            = svg;
    onSelectCallback = onSelect || onSelectCallback;
    activeRegion     = null;
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }

    containerEl = svg.closest('#map-container');

    svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    projection = buildProjection(projectionFeatures(), VW, VH);
    interactionSetup = false;
    Object.assign(transform, homeTransform);
    drawLayers();
    setupInteraction(containerEl);
    return features.length;
  }

  async function loadBrasil(path = './data/brasil.json') {
    if (window.__BRASIL_DATA__) {
      brasilData = window.__BRASIL_DATA__;
    } else {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      brasilData = await res.json();
    }

    if (!svgEl || !features.length) return;
    projection = buildProjection(projectionFeatures(), VW, VH);
    drawLayers();
  }

  /* ─── Labels ──────────────────────────────────────────── */
  function addLabel(cx, cy, nome, regiao) {
    const text = makeSvgEl('text');
    text.setAttribute('class', 'muni-label');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
    text.setAttribute('data-regiao', regiao);
    text.dataset.svgX = cx.toFixed(2);
    text.dataset.svgY = cy.toFixed(2);
    text.style.display = 'none';

    const words = nome.split(' ');
    if (nome.length > 11 && words.length > 1) {
      const mid   = Math.ceil(words.length / 2);
      const line1 = words.slice(0, mid).join(' ');
      const line2 = words.slice(mid).join(' ');
      const mkTs  = (txt, dy) => {
        const ts = makeSvgEl('tspan');
        ts.setAttribute('x', cx.toFixed(2));
        ts.setAttribute('dy', dy);
        ts.textContent = txt;
        text.appendChild(ts);
      };
      text.setAttribute('x', cx.toFixed(2));
      text.setAttribute('y', cy.toFixed(2));
      mkTs(line1, '-0.55em');
      mkTs(line2, '1.1em');
    } else {
      text.setAttribute('x', cx.toFixed(2));
      text.setAttribute('y', cy.toFixed(2));
      text.textContent = nome;
    }

    groupLabels.appendChild(text);
  }

  /* ─── SVG group transform + compensação de labels ─────── */
  function applyTransform() {
    if (!groupEl) return;
    const transformValue = `translate(${transform.x.toFixed(2)},${transform.y.toFixed(2)}) scale(${transform.k.toFixed(4)})`;
    [groupPais, groupEstados, groupEl, groupLabels].forEach(group => {
      if (group) group.setAttribute('transform', transformValue);
    });
    updateLabelVisibility();
    scheduleCullOffscreenPaths();
  }

  function clampZoom(k) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
  }

  function updateLabelVisibility() {
    if (!groupLabels) return;
    const hasFilter = activeRegion !== null;
    const zoomedIn  = transform.k >= LABEL_ZOOM_THRESH;
    const visible = hasFilter || zoomedIn;
    const fontSize = LABEL_PX / transform.k;
    const strokeWidth = 0.45 / transform.k;
    const vx0 = -transform.x / transform.k;
    const vy0 = -transform.y / transform.k;
    const vx1 = vx0 + VW / transform.k;
    const vy1 = vy0 + VH / transform.k;

    groupLabels.querySelectorAll('.muni-label').forEach(el => {
      const regionOk = hasFilter
        ? el.getAttribute('data-regiao') === activeRegion
        : visible;
      if (!regionOk) {
        el.style.display = 'none';
        return;
      }

      const lx = Number.parseFloat(el.dataset.svgX || el.getAttribute('x') || '0');
      const ly = Number.parseFloat(el.dataset.svgY || el.getAttribute('y') || '0');
      const inView = lx > vx0 - LABEL_VIEW_PAD && lx < vx1 + LABEL_VIEW_PAD &&
                     ly > vy0 - LABEL_VIEW_PAD && ly < vy1 + LABEL_VIEW_PAD;

      el.style.display = inView ? '' : 'none';
      if (!inView) return;

      el.setAttribute('font-size', fontSize.toFixed(4));
      el.setAttribute('stroke-width', strokeWidth.toFixed(4));
      el.querySelectorAll('tspan').forEach(ts => {
        ts.setAttribute('x', lx.toFixed(2));
      });
      const tspans = el.querySelectorAll('tspan');
      if (tspans.length === 2) {
        tspans[0].setAttribute('dy', (-fontSize * 0.65).toFixed(3));
        tspans[1].setAttribute('dy', (fontSize * 1.3).toFixed(3));
      }
    });
  }

  function scheduleCullOffscreenPaths() {
    clearTimeout(cullTimer);
    cullTimer = setTimeout(cullOffscreenPaths, 80);
  }

  function cullOffscreenPaths() {
    if (!groupEl) return;

    const limitrofePaths = groupEl.querySelectorAll('.muni-path.limitrofe');
    if (transform.k < CULL_MIN_ZOOM) {
      limitrofePaths.forEach(path => { path.style.display = ''; });
      return;
    }

    const vx0 = -transform.x / transform.k - CULL_VIEW_PAD;
    const vy0 = -transform.y / transform.k - CULL_VIEW_PAD;
    const vx1 = vx0 + VW / transform.k + CULL_VIEW_PAD * 2;
    const vy1 = vy0 + VH / transform.k + CULL_VIEW_PAD * 2;

    limitrofePaths.forEach(path => {
      try {
        const bbox = path.getBBox();
        const inView = bbox.x < vx1 && bbox.x + bbox.width > vx0 &&
                       bbox.y < vy1 && bbox.y + bbox.height > vy0;
        path.style.display = inView ? '' : 'none';
      } catch (_) {
        path.style.display = '';
      }
    });
  }

  /* ─── Animação suave (easeInOut 380ms) ───────────────── */
  function animateTo(target, duration = 380) {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    const start = { ...transform };
    const t0    = performance.now();

    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      const e = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;
      transform.x = start.x + (target.x - start.x) * e;
      transform.y = start.y + (target.y - start.y) * e;
      transform.k = start.k + (target.k - start.k) * e;
      applyTransform();
      if (p < 1) animFrame = requestAnimationFrame(step);
      else animFrame = null;
    }

    animFrame = requestAnimationFrame(step);
  }

  /* ─── Converte coord de tela → espaço do viewBox ──────── */
  function toVB(svg, clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VW, rect.height / VH);
    const offsetX = (rect.width - VW * scale) / 2;
    const offsetY = (rect.height - VH * scale) / 2;
    return {
      x: (clientX - rect.left - offsetX) / scale,
      y: (clientY - rect.top - offsetY) / scale
    };
  }

  /* ─── Zoom centrado num ponto do viewBox ──────────────── */
  function zoomAt(factor, vbX, vbY) {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    const nextK = clampZoom(transform.k * factor);
    const effectiveFactor = nextK / transform.k;
    transform.x = vbX - (vbX - transform.x) * effectiveFactor;
    transform.y = vbY - (vbY - transform.y) * effectiveFactor;
    transform.k = nextK;
    applyTransform();
  }

  function resetView() {
    activeRegion = null;
    animateTo({ ...homeTransform });
  }

  /* ─── Fit animado para uma região ────────────────────── */
  function fitToRegion(regiao) {
    if (!groupEl) return;

    if (regiao === 'todos') {
      activeRegion = null;
      animateTo({ ...homeTransform });
      return;
    }

    activeRegion = regiao;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    features.filter(f => f.regiao === regiao).forEach(f => {
      const el = groupEl.querySelector(`.muni-path[data-id="${f.id}"]`);
      if (!el) return;
      try {
        const b = el.getBBox();
        if (b.x           < minX) minX = b.x;
        if (b.x + b.width  > maxX) maxX = b.x + b.width;
        if (b.y           < minY) minY = b.y;
        if (b.y + b.height > maxY) maxY = b.y + b.height;
      } catch (_) {}
    });

    if (!isFinite(minX) || maxX <= minX || maxY <= minY) return;

    const pad  = REGION_FIT_PAD;
    const kFit = Math.min(
      (VW - pad * 2) / (maxX - minX),
      (VH - pad * 2) / (maxY - minY)
    );
    const k  = Math.min(REGION_MAX_ZOOM, Math.max(LABEL_ZOOM_THRESH, kFit * REGION_FIT_BOOST));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    animateTo({ x: VW / 2 - cx * k, y: VH / 2 - cy * k, k });
  }

  /* ─── Interação ──────────────────────────────────────── */
  function setupInteraction(container) {
    if (interactionSetup) return;
    interactionSetup = true;

    // Wheel → zoom centrado no cursor
    container.addEventListener('wheel', e => {
      e.preventDefault();
      const pt = toVB(svgEl, e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? WHEEL_ZOOM_IN : WHEEL_ZOOM_OUT, pt.x, pt.y);
    }, { passive: false });

    // Mouse → pan
    container.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      isDragging = true;
      dragStart = toVB(svgEl, e.clientX, e.clientY);
      dragTransformStart = { ...transform };
      container.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', e => {
      if (!isDragging) return;
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      const pt = toVB(svgEl, e.clientX, e.clientY);
      transform.x = dragTransformStart.x + (pt.x - dragStart.x);
      transform.y = dragTransformStart.y + (pt.y - dragStart.y);
      applyTransform();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
      if (containerEl) containerEl.style.cursor = '';
    });

    // Touch → pan + pinch-zoom
    container.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStart = toVB(svgEl, e.touches[0].clientX, e.touches[0].clientY);
        dragTransformStart = { ...transform };
        lastTouchDist = null;
      }
      if (e.touches.length === 2) {
        isDragging = false;
        lastTouchDist = touchDist(e.touches);
      }
    }, { passive: true });

    container.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        const pt = toVB(svgEl, e.touches[0].clientX, e.touches[0].clientY);
        transform.x = dragTransformStart.x + (pt.x - dragStart.x);
        transform.y = dragTransformStart.y + (pt.y - dragStart.y);
        applyTransform();
      }
      if (e.touches.length === 2 && lastTouchDist) {
        const dist = touchDist(e.touches);
        const t0 = toVB(svgEl, e.touches[0].clientX, e.touches[0].clientY);
        const t1 = toVB(svgEl, e.touches[1].clientX, e.touches[1].clientY);
        zoomAt(dist / lastTouchDist, (t0.x + t1.x) / 2, (t0.y + t1.y) / 2);
        lastTouchDist = dist;
      }
    }, { passive: false });

    container.addEventListener('touchend', () => {
      isDragging = false;
      lastTouchDist = null;
    }, { passive: true });
  }

  function touchDist(touches) {
    return Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY
    );
  }

  /* ─── Hover / Select ──────────────────────────────────── */
  function onPathHover(e) {
    const d = e.currentTarget.dataset;
    UI.showTooltip(d.nome, d.uf, d.tipo);
    UI.moveTooltip(e);
  }
  function onPathMove(e)  { UI.moveTooltip(e); }
  function onPathLeave()  { UI.hideTooltip(); }

  function onPathClick(e) {
    e.stopPropagation();
    selectById(e.currentTarget.dataset.id, e.currentTarget.dataset);
  }
  function onPathTouchStart(e) {
    e.stopPropagation();
    const d = e.currentTarget.dataset;
    UI.showTooltip(d.nome, d.uf, d.tipo);
    if (e.touches.length) UI.moveTooltip(e.touches[0]);
  }
  function onPathTouchEnd(e) {
    setTimeout(() => UI.hideTooltip(), 1200);
    if (e.changedTouches.length === 1) {
      selectById(e.currentTarget.dataset.id, e.currentTarget.dataset);
    }
  }

  function selectById(id, data) {
    document.querySelectorAll('.muni-path.selected').forEach(p => p.classList.remove('selected'));
    if (selectedId === id) {
      selectedId = null;
      UI.hideInfoPanel();
      UI.deselectListItem();
      return;
    }
    selectedId = id;
    const path = groupEl && groupEl.querySelector(`.muni-path[data-id="${id}"]`);
    if (path) path.classList.add('selected');
    UI.showInfoPanel(data || {});
    UI.selectListItem(id);
    if (onSelectCallback) onSelectCallback(id, data);
  }

  /* ─── Filter / dim ────────────────────────────────────── */
  function filterByRegion(regiao) {
    document.querySelectorAll('.muni-path').forEach(path => {
      if (!regiao) { path.classList.remove('dimmed'); return; }
      const matches = path.dataset.regiao === regiao ||
        (path.dataset.tipo === 'limitrofe' &&
         (regiao === 'rs' ? path.dataset.uf === 'RS' : path.dataset.uf === 'MG'));
      path.classList.toggle('dimmed', !matches);
    });
  }

  /* ─── API pública ─────────────────────────────────────── */
  return {
    render,
    loadBrasil,
    zoomIn:  () => zoomAt(BUTTON_ZOOM_IN, VW / 2, VH / 2),
    zoomOut: () => zoomAt(BUTTON_ZOOM_OUT, VW / 2, VH / 2),
    reset:   resetView,
    filter:  filterByRegion,
    fitToRegion,
    select:  selectById,
    getFeatureById: id => features.find(f => f.id === id)
  };
})();
