/**
 * ui.js — Módulo de interface: sidebar, tooltip, painel de info, lista
 */

const UI = (() => {
  const REGIAO_CORES = {
    'mg-oeste': '#C8FF00',
    'mg-leste': '#7BFF6A',
    'rs':       '#00E5FF'
  };

  const REGIAO_LABELS = {
    'mg-oeste': 'MG Oeste / Sul',
    'mg-leste': 'MG Leste / Caratinga',
    'rs':       'RS Noroeste'
  };

  const UF_LABELS = {
    MG: 'Minas Gerais', RS: 'Rio Grande do Sul', ES: 'Espírito Santo',
    SC: 'Santa Catarina', PR: 'Paraná', SP: 'São Paulo', RJ: 'Rio de Janeiro'
  };

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

  const TIPO_ICONS = { atuacao: '📍', limitrofe: '○', outro: '·' };
  const MAX_RESULTADOS_BUSCA = 100;

  /* ─── Lista Sidebar ───────────────────────────────────── */
  function buildList(query = '') {
    const list = document.getElementById('municipio-list');
    list.innerHTML = '';
    const q = normalize(query);

    // Busca: procura em TODOS os municípios (atuação, limítrofe e outros),
    // independente da aba selecionada.
    if (q) {
      const resultados = allFeatures
        .filter(f => normalize(f.nome).includes(q))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

      if (!resultados.length) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:#9ca3af;font-size:0.8rem">Nenhum município encontrado</div>';
        return;
      }

      const hdr = document.createElement('div');
      hdr.className = 'region-header';
      hdr.textContent = `${resultados.length} resultado${resultados.length > 1 ? 's' : ''}`;
      list.appendChild(hdr);

      resultados.slice(0, MAX_RESULTADOS_BUSCA).forEach(f => {
        list.appendChild(makeListItem(f.nome, f.id, TIPO_ICONS[f.tipo] || '·'));
      });

      if (resultados.length > MAX_RESULTADOS_BUSCA) {
        const more = document.createElement('div');
        more.style.cssText = 'padding:8px 12px;text-align:center;color:#9ca3af;font-size:0.72rem';
        more.textContent = `+${resultados.length - MAX_RESULTADOS_BUSCA} outros — refine a busca`;
        list.appendChild(more);
      }
      return;
    }

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
        hdr.innerHTML = `<div class="region-dot" style="background:rgba(0,229,255,.22);border:1px solid #00E5FF"></div>${UF_LABELS[uf]}`;
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
    tagEl.textContent = tipo === 'atuacao'   ? '✅ Área de atuação'
                       : tipo === 'limitrofe' ? '📍 Município limítrofe'
                       : '⚪ Fora da área de cobertura';
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
    document.getElementById('ip-tipo').textContent   = data.tipo === 'atuacao'   ? '✅ Área de Atuação'
                                                       : data.tipo === 'limitrofe' ? '📍 Limítrofe'
                                                       : '⚪ Fora da área de cobertura';
    document.getElementById('ip-indicadores').innerHTML = renderIndicadores(data.indicadores);
    document.getElementById('info-panel').classList.add('visible');
    document.getElementById('info-panel-overlay').classList.add('open');
  }

  /* ─── Indicadores técnicos (Censo 2022 / PIB Municípios) ─ */
  function fmtInt(n) {
    return Math.round(n).toLocaleString('pt-BR');
  }
  function fmtDec(n, casas = 1) {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
  }
  function fmtBRL(n) {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  function indRow(label, valueHtml, available = true) {
    const cls = available ? 'ind-val' : 'ind-val na';
    const val = available ? valueHtml : 'dado indisponível';
    return `<div class="ind-row"><span>${label}</span><span class="${cls}">${val}</span></div>`;
  }

  function renderIndicadores(ind) {
    if (!ind) return '';
    let html = '';

    // População
    html += '<div class="ind-section"><div class="ind-section-title">População</div>';
    const pop = ind.populacao || {};
    html += indRow('Total', pop.valor != null ? `${fmtInt(pop.valor)} hab.` : null, pop.valor != null);

    const urb = ind.populacao_urbana || {}, rur = ind.populacao_rural || {};
    if (urb.valor != null && rur.valor != null) {
      html += indRow('Urbana', `${fmtInt(urb.valor)} hab.`);
      html += indRow('Rural', `${fmtInt(rur.valor)} hab.`);
    } else {
      html += indRow('Urbana / Rural', null, false);
    }

    const sexo = ind.populacao_por_sexo || {};
    if (sexo.homens != null && sexo.mulheres != null) {
      html += indRow('Homens', `${fmtInt(sexo.homens)} hab.`);
      html += indRow('Mulheres', `${fmtInt(sexo.mulheres)} hab.`);
    } else {
      html += indRow('Por sexo', null, false);
    }

    const fe = ind.faixa_etaria || {};
    if (fe['0_14'] != null && fe['15_64'] != null && fe['65_mais'] != null) {
      html += indRow('0–14 anos', `${fmtInt(fe['0_14'])} hab.`);
      html += indRow('15–64 anos', `${fmtInt(fe['15_64'])} hab.`);
      html += indRow('65+ anos', `${fmtInt(fe['65_mais'])} hab.`);
    } else {
      html += indRow('Faixa etária', null, false);
    }
    html += `<div class="ind-source">Fonte: ${pop.fonte || 'IBGE'}${pop.ano ? ` (${pop.ano})` : ''}</div>`;
    html += '</div>';

    // Território
    html += '<div class="ind-section"><div class="ind-section-title">Território</div>';
    const area = ind.area_km2 || {}, dens = ind.densidade || {};
    html += indRow('Área', area.valor != null ? `${fmtDec(area.valor, 1)} km²` : null, area.valor != null);
    html += indRow('Densidade', dens.valor != null ? `${fmtDec(dens.valor, 1)} hab/km²` : null, dens.valor != null);
    html += `<div class="ind-source">Fonte: ${area.fonte || 'IBGE'}${area.ano ? ` (${area.ano})` : ''}</div>`;
    html += '</div>';

    // Trabalho
    html += '<div class="ind-section"><div class="ind-section-title">Trabalho</div>';
    const trab = ind.trabalho || {};
    if (trab.populacao_ocupada != null) {
      html += indRow('Pessoas ocupadas', `${fmtInt(trab.populacao_ocupada)} hab.`);
      html += indRow('Pop. 10 anos+', `${fmtInt(trab.pop_10_anos_ou_mais)} hab.`);
      html += indRow('Nível de ocupação', `${fmtDec(trab.nivel_ocupacao_pct, 1)}%`);
    } else {
      html += indRow('Ocupação', null, false);
    }
    html += `<div class="ind-source">Fonte: ${trab.fonte || 'IBGE'}${trab.ano ? ` (${trab.ano})` : ''}</div>`;
    html += '</div>';

    // Economia
    html += '<div class="ind-section"><div class="ind-section-title">Economia</div>';
    const pib = ind.pib || {}, pibPc = ind.pib_per_capita || {};
    html += indRow('PIB municipal', pib.valor != null ? fmtBRL(pib.valor * 1000) : null, pib.valor != null);
    html += indRow('PIB per capita', pibPc.valor != null ? `${fmtBRL(pibPc.valor)} *` : null, pibPc.valor != null);
    html += `<div class="ind-source">Fonte: ${pib.fonte || 'IBGE'}${pib.ano ? ` (${pib.ano})` : ''}`;
    if (pibPc.valor != null) {
      html += `<br>* Estimativa: ${pibPc.calculo} (${pibPc.ano})`;
    }
    html += '</div></div>';

    return html;
  }

  function hideInfoPanel() {
    document.getElementById('info-panel').classList.remove('visible');
    document.getElementById('info-panel-overlay').classList.remove('open');
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
