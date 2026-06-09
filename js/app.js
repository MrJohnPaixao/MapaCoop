/**
 * app.js — Orquestrador principal do PWA
 * Carrega dados, inicializa mapa e UI, gerencia PWA install
 */

(async function App() {
  /* ─── Registrar Service Worker ─────────────────────── */
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
      console.log('[PWA] Service Worker registrado');
    } catch (err) {
      console.warn('[PWA] SW falhou:', err);
    }
  }

  /* ─── Carregar dados ────────────────────────────────── */
  const loadingEl = document.getElementById('loading');
  let data;
  try {
    if (window.__MAPA_DATA__) {
      data = window.__MAPA_DATA__;
    } else {
      const res = await fetch('./data/municipios.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    }
  } catch (err) {
    loadingEl.innerHTML = `
      <div style="text-align:center;padding:20px;color:#C8FF00">
        <div style="font-size:2.5rem;margin-bottom:12px">⚠️</div>
        <p style="font-family:'Exo 2','Nunito',Arial,sans-serif;margin-bottom:6px;font-weight:700">Erro ao carregar dados</p>
        <small style="color:#6b7280">${err.message}</small><br>
        <button onclick="location.reload()" style="margin-top:14px;padding:8px 20px;background:#C8FF00;color:#0A0F1E;border-radius:20px;border:none;cursor:pointer;font-size:0.85rem">
          Tentar novamente
        </button>
      </div>`;
    return;
  }

  /* ─── Inicializar Mapa ──────────────────────────────── */
  const svg = document.getElementById('map-svg');

  // viewBox fixo — render não depende de dimensões de tela
  const totalRendered = MapEngine.render(data, svg, (id, feat) => {
    // Callback de seleção (extensível)
  });

  /* ─── Inicializar UI ────────────────────────────────── */
  try {
    await MapEngine.loadBrasil('./data/brasil.json');
  } catch (err) {
    console.warn('[Mapa] Camada Brasil falhou:', err);
  }

  UI.init(data.features, data.meta);

  /* ─── Esconder loading ──────────────────────────────── */
  loadingEl.classList.add('hidden');
  UI.toast(`✅ ${data.meta.atuacao} municípios carregados`);

  /* ─── Eventos de UI ─────────────────────────────────── */

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => UI.switchTab(btn.dataset.tab));
  });

  // Busca
  document.getElementById('search-input').addEventListener('input', e => {
    UI.buildList(e.target.value);
  });

  // Filtros de região — dim + zoom animado + labels da região
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const reg = btn.dataset.region;
      const isAll = reg === 'todos';
      MapEngine.filter(isAll ? null : reg);
      MapEngine.fitToRegion(reg);
    });
  });

  // Zoom
  document.getElementById('btn-zoom-in').addEventListener('click',  MapEngine.zoomIn);
  document.getElementById('btn-zoom-out').addEventListener('click', MapEngine.zoomOut);
  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    MapEngine.reset();
    MapEngine.filter(null);
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-region="todos"]').classList.add('active');
  });

  // Sidebar mobile
  document.getElementById('btn-menu').addEventListener('click', UI.openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', UI.closeSidebar);

  // Fechar info panel
  document.getElementById('btn-close-info').addEventListener('click', () => {
    UI.hideInfoPanel();
    UI.deselectListItem();
    document.querySelectorAll('.muni-path.selected').forEach(p => p.classList.remove('selected'));
  });

  // Click no mapa (fora de path) fecha info
  document.getElementById('map-container').addEventListener('click', e => {
    if (e.target.id === 'map-svg' || e.target.id === 'map-g' || e.target.id === 'map-wrapper') {
      UI.hideInfoPanel();
      UI.deselectListItem();
      document.querySelectorAll('.muni-path.selected').forEach(p => p.classList.remove('selected'));
    }
  });

  // Resize/orientação — recalcula o viewBox real e refaz o fit do mapa
  let resizeTimer;
  function handleViewportChange() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      MapEngine.resize();
      UI.init(data.features, data.meta);
    }, 180);
  }
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('orientationchange', handleViewportChange);

  /* ─── PWA Install Banner ────────────────────────────── */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = document.getElementById('install-banner');
    if (banner) banner.style.display = 'flex';
  });

  const btnInstall = document.getElementById('btn-install');
  if (btnInstall) {
    btnInstall.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        UI.toast('📱 App instalado com sucesso!');
      }
      deferredPrompt = null;
      document.getElementById('install-banner').style.display = 'none';
    });
  }

  const btnDismiss = document.getElementById('btn-dismiss-install');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      document.getElementById('install-banner').style.display = 'none';
    });
  }

  window.addEventListener('appinstalled', () => {
    UI.toast('✅ App adicionado à tela inicial!');
    deferredPrompt = null;
  });

  console.log('[App] Inicializado!', {
    total: data.features.length,
    atuacao: data.meta.atuacao,
    limitrofe: data.meta.limitrofe
  });
})();
