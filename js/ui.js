/**
 * ui.js — Módulo de interface: sidebar, tooltip, painel de info, lista
 */

const UI = (() => {
  const REGIAO_CORES = {
    'mg-oeste': '#3FA110',
    'mg-leste': '#64C832',
    'rs':       '#2F7D0C'
  };

  const REGIAO_LABELS = {
    'mg-oeste': 'MG Oeste / Sul',
    'mg-leste': 'MG Leste / Caratinga',
    'rs':       'RS Noroeste'
  };

  const UF_LABELS = { MG: 'Minas Gerais', RS: 'Rio Grande do Sul' };

  let currentTab = 'atuacao';
  let allFeatures = [];
  let metaRegioes = {};
  let selectedListId = null;

  /* ─── Init ────────────────────────────────────────────── */
  function init(features, meta) {
    allFeatures = features;
    metaRegioes = meta.municipios_atuacao || {};

    // Stats
    document.getElementById('s-atu').textContent = meta.atuacao;
    document.getElementById('s-lim').textContent = meta.limitrofe;
    document.getElementById('s-mg').textContent  = features.filter(f => f.uf === 'MG' && f.tipo === 'atuacao').length;
    document.getElementById('s-rs').textContent  = features.filter(f => f.uf === 'RS' && f.tipo === 'atuacao').length;
    document.getElementById('badge-atu').textContent = meta.atuacao;

    buildList();
  }

  /* ─── Tabs ────────────────────────────────────────────── */
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    buildList();
  }

  /* ─── Lista Sidebar ───────────────────────────────────── */
  function buildList(query = '') {
    const list = document.getElementById('municipio-list');
    list.innerHTML = '';
    const q = normalize(query);

    if (currentTab === 'atuacao') {
      ['mg-oeste', 'mg-leste', 'rs'].forEach(regId => {
        const nomes = (metaRegioes[regId] || []).filter(n => !q || normalize(n).includes(q));
        if (!nomes.length) return;

        const hdr = document.createElement('div');
        hdr.className = 'region-header';
        hdr.innerHTML = `<div class="region-dot" style="background:${REGIAO_CORES[regId]}"></div>${REGIAO_LABELS[regId]}`;
        list.appendChild(hdr);

        nomes.forEach(nome => {
          const feat = allFeatures.find(f => normalize(f.nome) === normalize(nome));
          const item = makeListItem(nome, feat ? feat.id : null, '📍');
          list.appendChild(item);
        });
      });
    } else {
      // Limítrofes agrupados por UF
      ['MG', 'RS'].forEach(uf => {
        const grupo = allFeatures
          .filter(f => f.tipo === 'limitrofe' && f.uf === uf && (!q || normalize(f.nome).includes(q)))
          .sort((a, b) => a.nome.localeCompare(b.nome));
        if (!grupo.length) return;

        const hdr = document.createElement('div');
        hdr.className = 'region-header';
        hdr.innerHTML = `<div class="region-dot" style="background:#EAF6E4;border:1px solid #3FA110"></div>${UF_LABELS[uf]}`;
        list.appendChild(hdr);

        grupo.forEach(feat => {
          const item = makeListItem(feat.nome, feat.id, '○');
          list.appendChild(item);
        });
      });
    }

    if (list.children.length === 0) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:0.8rem">Nenhum município encontrado</div>';
    }
  }

  function makeListItem(nome, id, icon) {
    const item = document.createElement('div');
    item.className = 'muni-item' + (id === selectedListId ? ' selected' : '');
    item.dataset.id = id || '';
    item.innerHTML = `<span class="muni-icon">${icon}</span>${nome}`;
    item.addEventListener('click', () => {
      if (id) {
        const feat = allFeatures.find(f => f.id === id);
        MapEngine.select(id, feat || {});
        closeSidebar();
      }
    });
    return item;
  }

  function selectListItem(id) {
    selectedListId = id;
    document.querySelectorAll('.muni-item.selected').forEach(el => el.classList.remove('selected'));
    if (!id) return;
    const el = document.querySelector(`.muni-item[data-id="${id}"]`);
    if (el) {
      el.classList.add('selected');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function deselectListItem() {
    selectedListId = null;
    document.querySelectorAll('.muni-item.selected').forEach(el => el.classList.remove('selected'));
  }

  /* ─── Tooltip ─────────────────────────────────────────── */
  const tt = () => document.getElementById('tooltip');

  function showTooltip(nome, uf, tipo) {
    document.getElementById('tt-name').textContent = nome;
    document.getElementById('tt-uf').textContent = UF_LABELS[uf] || uf;
    const tagEl = document.getElementById('tt-tag');
    tagEl.className = `tt-tag ${tipo}`;
    tagEl.textContent = tipo === 'atuacao' ? '✅ Área de atuação' : '📍 Município limítrofe';
    tt().classList.add('visible');
  }

  function moveTooltip(e) {
    const el = tt();
    const container = document.getElementById('map-container');
    const rect = container.getBoundingClientRect();
    const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    const ttW = 210;
    const ttH = 80;
    let x = clientX - rect.left + 16;
    let y = clientY - rect.top - 14;
    if (x + ttW > rect.width) x = x - ttW - 32;
    if (y + ttH > rect.height) y = y - ttH - 10;
    if (x < 0) x = 8;
    if (y < 0) y = 8;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
  }

  function hideTooltip() {
    tt().classList.remove('visible');
  }

  /* ─── Info Panel ──────────────────────────────────────── */
  function showInfoPanel(data) {
    document.getElementById('ip-nome').textContent   = data.nome || '—';
    document.getElementById('ip-estado').textContent = UF_LABELS[data.uf] || data.uf || '—';
    document.getElementById('ip-regiao').textContent = REGIAO_LABELS[data.regiao] || (data.tipo === 'limitrofe' ? 'Limítrofe' : '—');
    document.getElementById('ip-tipo').textContent   = data.tipo === 'atuacao' ? '✅ Área de Atuação' : '📍 Limítrofe';
    document.getElementById('info-panel').classList.add('visible');
  }

  function hideInfoPanel() {
    document.getElementById('info-panel').classList.remove('visible');
  }

  /* ─── Sidebar mobile ──────────────────────────────────── */
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
  }

  /* ─── Toast ───────────────────────────────────────────── */
  function toast(msg, duration = 2500) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), duration);
  }

  /* ─── Helpers ─────────────────────────────────────────── */
  function normalize(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }

  /* ─── API pública ─────────────────────────────────────── */
  return {
    init,
    switchTab,
    buildList,
    selectListItem,
    deselectListItem,
    showTooltip, moveTooltip, hideTooltip,
    showInfoPanel, hideInfoPanel,
    openSidebar, closeSidebar,
    toast,
    normalize
  };
})();
