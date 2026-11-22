/**
 * Mulch Advisory Platform — Frontend Application
 * Single-file SPA: handles routing, API calls, map drawing, and UI rendering.
 */

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  farmer:      null,   // current logged-in farmer object
  plots:       [],     // farmer's plots
  regions:     [],     // all regions from API
  crops:       [],     // all crops from API
  soilTypes:   [],     // all soil types from API
  demoState:   null,   // { currentDate, dayOffset, isHeatWave, forecastLabel }

  // Signup flow
  signupStep:  1,
  signupData:  { name: '', phone: '', region_id: null },
  drawnPolygon: null,  // GeoJSON polygon from map drawing
  drawnAreaHa:  null,

  // Maps
  signupMap:    null,
  dashMap:      null,
};

// ─── API helpers ─────────────────────────────────────────────────────────────
const BASE = '';   // same origin

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const GET  = (p)    => api('GET',  p);
const POST = (p, b) => api('POST', p, b);

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ─── Page routing ─────────────────────────────────────────────────────────────
const PAGES = ['page-auth', 'page-dashboard', 'page-alerts'];

function showPage(id) {
  PAGES.forEach(p => {
    const el = document.getElementById(p);
    if (el) el.style.display = (p === id) ? 'block' : 'none';
  });

  // Update desktop nav links
  document.getElementById('nav-dashboard').classList.toggle('active', id === 'page-dashboard');
  document.getElementById('nav-alerts').classList.toggle('active', id === 'page-alerts');

  // Update mobile bottom nav
  document.querySelectorAll('.nav-btn-mobile').forEach(b => {
    b.classList.toggle('active', b.dataset.target === id);
    b.style.color = b.dataset.target === id ? 'var(--accent-color)' : '#6c757d';
  });

  if (id === 'page-alerts') loadAlerts();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Auth views ───────────────────────────────────────────────────────────────
function showLoginView() {
  document.getElementById('auth-login-view').style.display  = 'block';
  document.getElementById('auth-signup-view').style.display = 'none';
}

function showSignupView() {
  document.getElementById('auth-login-view').style.display  = 'none';
  document.getElementById('auth-signup-view').style.display = 'block';
  setSignupStep(1);
  populateSignupDropdowns();
}

function setSignupStep(step) {
  state.signupStep = step;
  [1, 2, 3].forEach(n => {
    document.getElementById(`signup-step${n}`).style.display = (n === step) ? 'block' : 'none';
    const dot = document.getElementById(`step${n}-dot`);
    dot.classList.toggle('active', n === step);
    dot.classList.toggle('done', n < step);
    if (n < 3) {
      document.getElementById(`step${n}-line`).classList.toggle('done', n < step);
    }
  });
  if (step === 2) {
    // Show step first, THEN init map so Leaflet can measure the div correctly
    setTimeout(() => {
      initSignupMap();
      // Always invalidate size in case the div was hidden before
      if (state.signupMap) state.signupMap.invalidateSize();
    }, 50);
  }
}

// ─── Seed dropdowns ───────────────────────────────────────────────────────────
async function loadReferenceData() {
  [state.regions, state.crops, state.soilTypes] = await Promise.all([
    GET('/api/regions'),
    GET('/api/crops'),
    GET('/api/soil-types'),
  ]);
}

function populateSignupDropdowns() {
  // No region dropdown anymore — region is auto-detected from map polygon centroid.
  // Just populate crop and soil selects.

  const cropSel = document.getElementById('signup-crop');
  cropSel.innerHTML = '<option value="">Select crop…</option>';
  state.crops.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name} / ${c.name_ar} / ${c.name_fr}`;
    cropSel.appendChild(o);
  });

  const soilSel = document.getElementById('signup-soil');
  soilSel.innerHTML = '<option value="">Select soil…</option>';
  state.soilTypes.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.name} / ${s.name_ar} / ${s.name_fr}`;
    soilSel.appendChild(o);
  });
}

// ─── Signup Map & Polygon Drawing ────────────────────────────────────────────
let drawPoints    = [];   // array of [lat, lng] clicked so far
let drawMarkers   = [];   // Leaflet circle markers for each point
let drawPolyline  = null; // live preview polyline
let drawnLayer    = null; // final polygon layer

/**
 * Auto-detect which seeded region a centroid [lat, lng] belongs to.
 * Uses simple nearest-centre distance — good enough for 3 Tunisian regions.
 * Returns the matching region object, or the nearest one if the centroid
 * falls outside all bounding boxes.
 */
function detectRegion(centroidLat, centroidLng) {
  if (!state.regions.length) return null;
  let best = null, bestDist = Infinity;
  for (const r of state.regions) {
    const dist = Math.hypot(centroidLat - r.center_lat, centroidLng - r.center_lng);
    if (dist < bestDist) { bestDist = dist; best = r; }
  }
  return best;
}

function initSignupMap() {
  if (state.signupMap) {
    state.signupMap.invalidateSize();
    return;
  }

  // Open on Tunisia — farmer navigates to their own location
  state.signupMap = L.map('signup-map').setView([34.0, 9.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.signupMap);

  // Click handler: add polygon corners
  state.signupMap.on('click', (e) => {
    if (drawnLayer) return; // polygon already closed

    const point = [e.latlng.lat, e.latlng.lng];
    drawPoints.push(point);

    const marker = L.circleMarker(point, {
      radius: 6, color: '#1a7a2e', fillColor: '#2da84a', fillOpacity: 1, weight: 2,
    }).addTo(state.signupMap);
    drawMarkers.push(marker);

    updateDrawPreview();
  });
}

function updateDrawPreview() {
  if (drawPolyline) state.signupMap.removeLayer(drawPolyline);
  if (drawPoints.length < 2) return;
  drawPolyline = L.polyline(drawPoints, { color: '#1a7a2e', weight: 2, dashArray: '5,5' })
    .addTo(state.signupMap);
}

function closePolygon() {
  if (drawPoints.length < 3) {
    showError('signup-step2-error', 'You need at least 3 points to draw a polygon.');
    return false;
  }
  if (drawnLayer) return true; // already closed

  // Remove preview elements
  if (drawPolyline) { state.signupMap.removeLayer(drawPolyline); drawPolyline = null; }
  drawMarkers.forEach(m => state.signupMap.removeLayer(m));
  drawMarkers = [];

  // Create polygon
  drawnLayer = L.polygon(drawPoints, { color: '#1a7a2e', fillColor: '#2da84a', fillOpacity: 0.3, weight: 2 })
    .addTo(state.signupMap);

  state.signupMap.fitBounds(drawnLayer.getBounds());

  // Compute area in hectares
  const areaHa = computeAreaHa(drawPoints);
  state.drawnAreaHa = areaHa;

  // Build GeoJSON
  const coords = drawPoints.map(p => [p[1], p[0]]); // GeoJSON: [lng, lat]
  coords.push(coords[0]);
  state.drawnPolygon = { type: 'Polygon', coordinates: [coords] };

  // ── Auto-detect region from polygon centroid ──────────────────
  const centroidLat = drawPoints.reduce((s, p) => s + p[0], 0) / drawPoints.length;
  const centroidLng = drawPoints.reduce((s, p) => s + p[1], 0) / drawPoints.length;
  const detectedRegion = detectRegion(centroidLat, centroidLng);

  if (detectedRegion) {
    state.signupData.region_id = detectedRegion.id;
    document.getElementById('region-detected-label').textContent =
      `${detectedRegion.name} / ${detectedRegion.name_ar}`;

    // Show warning if plot is far from all region centres (>2 degrees ~ 220km)
    const dist = Math.hypot(centroidLat - detectedRegion.center_lat, centroidLng - detectedRegion.center_lng);
    document.getElementById('region-outside-warning').style.display = dist > 2 ? 'block' : 'none';
  }

  // Show area + detected region
  document.getElementById('area-value').textContent = areaHa.toFixed(2);
  const areaEl = document.getElementById('area-display');
  areaEl.classList.remove('d-none');
  areaEl.classList.add('d-flex');
  hideError('signup-step2-error');
  return true;
}

/**
 * Compute area in hectares using the Shoelace formula.
 * Converts lat/lng to approximate meters using a local flat-earth projection.
 * Accurate enough for small agricultural plots.
 */
function computeAreaHa(points) {
  if (points.length < 3) return 0;
  const R = 6371000; // Earth radius in metres
  const toRad = d => d * Math.PI / 180;
  const latC = toRad(points.reduce((s, p) => s + p[0], 0) / points.length);

  // Project to local X/Y (metres)
  const xy = points.map(p => [
    R * toRad(p[1]) * Math.cos(latC),
    R * toRad(p[0]),
  ]);

  // Shoelace formula
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const j = (i + 1) % xy.length;
    area += xy[i][0] * xy[j][1];
    area -= xy[j][0] * xy[i][1];
  }
  return Math.abs(area) / 2 / 10000; // m² → ha
}

function undoLastPoint() {
  if (drawnLayer) {
    // Already closed — reopen
    state.signupMap.removeLayer(drawnLayer); drawnLayer = null;
    const areaElUndo = document.getElementById('area-display');
    areaElUndo.classList.add('d-none'); areaElUndo.classList.remove('d-flex');
    state.drawnPolygon = null; state.drawnAreaHa = null;
    // Re-add markers
    drawMarkers = drawPoints.map(p =>
      L.circleMarker(p, { radius: 6, color: '#1a7a2e', fillColor: '#2da84a', fillOpacity: 1, weight: 2 })
        .addTo(state.signupMap)
    );
    updateDrawPreview();
    return;
  }
  if (!drawPoints.length) return;
  drawPoints.pop();
  const m = drawMarkers.pop();
  if (m) state.signupMap.removeLayer(m);
  updateDrawPreview();
}

function clearPolygon() {
  if (drawnLayer) { state.signupMap.removeLayer(drawnLayer); drawnLayer = null; }
  if (drawPolyline) { state.signupMap.removeLayer(drawPolyline); drawPolyline = null; }
  drawMarkers.forEach(m => state.signupMap.removeLayer(m));
  drawMarkers = []; drawPoints = [];
  document.getElementById('region-detected-label').textContent = '—';
  document.getElementById('region-outside-warning').style.display = 'none';
  const areaEl = document.getElementById('area-display');
  areaEl.classList.add('d-none');
  areaEl.classList.remove('d-flex');
  state.drawnPolygon = null; state.drawnAreaHa = null;
  state.signupData.region_id = null;
}

// ─── Error helpers ────────────────────────────────────────────────────────────
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = el.querySelector('span') || el;
  target.textContent = msg;
  el.style.display = 'block';
  el.classList.add('visible');
}
function hideError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = el.querySelector('span') || el;
  target.textContent = '';
  el.style.display = 'none';
  el.classList.remove('visible');
}

// ─── Thermal map — OWM tile layer + mode switching ───────────────────────────

const CARTO_KEY = 'cb1_5djm_1_29f0c4bd960e621dd6e91d08';
const OWM_KEY   = 'fcb78829abc31180ff24a6a4bd7fbf6a';

const TILE_PROVIDERS = {
  normal: {
    url:  `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=${CARTO_KEY}`,
    attr: '© CARTO, © OpenStreetMap contributors',
    opts: { maxZoom: 20 },
  },
  thermal: {
    // CARTO dark base — OWM temp layer overlaid on top
    url:  `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_KEY}`,
    attr: '© CARTO, © OpenStreetMap contributors',
    opts: { maxZoom: 20 },
  },
};

// OpenWeatherMap temperature tile layer — real weather data, no canvas needed
const OWM_TEMP_URL = `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${OWM_KEY}`;

let currentMapMode = 'normal';
let baseTileLayer  = null;
let owmTempLayer   = null;   // OWM temperature overlay

function setMapMode(mode) {
  if (!state.dashMap) return;
  currentMapMode = mode;

  // Update toggle buttons
  const btnNormal  = document.getElementById('map-btn-normal');
  const btnThermal = document.getElementById('map-btn-thermal');
  if (btnNormal && btnThermal) {
    const isN = mode === 'normal';
    btnNormal.style.background  = isN  ? 'var(--accent-color)' : 'transparent';
    btnNormal.style.color       = isN  ? '#fff'                : '#555';
    btnThermal.style.background = !isN ? '#d62828'             : 'transparent';
    btnThermal.style.color      = !isN ? '#fff'                : '#555';
  }

  // Legend
  const legend = document.getElementById('thermal-legend');
  if (legend) legend.style.display = mode === 'thermal' ? 'block' : 'none';

  // Swap base tile layer
  if (baseTileLayer) state.dashMap.removeLayer(baseTileLayer);
  const cfg = TILE_PROVIDERS[mode] || TILE_PROVIDERS.normal;
  baseTileLayer = L.tileLayer(cfg.url, { attribution: cfg.attr, ...cfg.opts });
  baseTileLayer.addTo(state.dashMap);
  baseTileLayer.bringToBack();

  // Add / remove OWM temperature overlay
  if (mode === 'thermal') {
    if (!owmTempLayer) {
      owmTempLayer = L.tileLayer(OWM_TEMP_URL, {
        attribution: '© OpenWeatherMap',
        opacity: 0.75,
        maxZoom: 20,
        zIndex: 350,
      });
    }
    if (!state.dashMap.hasLayer(owmTempLayer)) {
      owmTempLayer.addTo(state.dashMap);
    }
  } else {
    if (owmTempLayer && state.dashMap.hasLayer(owmTempLayer)) {
      state.dashMap.removeLayer(owmTempLayer);
    }
  }

  // Recolour / restore plot polygons above the temperature layer
  updatePlotLayerStyles();
}

function updatePlotLayerStyles() {
  dashMapLayers.forEach(layer => {
    if (currentMapMode === 'thermal') {
      // White outline only — OWM tiles provide the colour signal
      layer.setStyle({ color: '#fff', weight: 2.5, fillOpacity: 0, opacity: 1 });
      layer.eachLayer(l => { if (l.setStyle) l.setStyle({ color: '#fff', weight: 2.5, fillOpacity: 0, opacity: 1 }); });
    } else {
      const col = layer._applyMulch ? '#c0392b' : '#2da84a';
      layer.setStyle({ color: col, fillColor: col, fillOpacity: 0.3, weight: 2, opacity: 1 });
      layer.eachLayer(l => { if (l.setStyle) l.setStyle({ color: col, fillColor: col, fillOpacity: 0.3, weight: 2, opacity: 1 }); });
    }
    layer.bringToFront();
  });
}

function updateThermalHeatData(isHeatWave) {
  // Update legend indicator
  const indicator = document.getElementById('thermal-hw-indicator');
  if (indicator) {
    indicator.textContent = isHeatWave ? '🔥 Heat wave active' : '🌤 Normal conditions';
    indicator.style.color = isHeatWave ? '#d62828' : '#06d6a0';
  }
  // OWM tiles update automatically — nothing else to do
}

// ─── Dashboard rendering ──────────────────────────────────────────────────────
let dashMapLayers = [];   // polygon layers on dashboard map

async function loadDashboard() {
  if (!state.farmer) return;
  try {
    const data = await GET(`/api/farmers/${state.farmer.id}/dashboard`);
    state.demoState = {
      currentDate:   data.currentDate,
      dayOffset:     data.dayOffset,
      isHeatWave:    data.isHeatWave,
      forecastLabel: data.forecastLabel,
    };
    renderDemoBanner();
    renderDashMap(data);
    renderPlotCards(data.plotCards);
  } catch (e) {
    showToast('Error loading dashboard: ' + e.message);
  }
}

function renderDemoBanner() {
  const ds = state.demoState;
  document.getElementById('demo-date-display').textContent = ds.currentDate;
  document.getElementById('demo-forecast-display').textContent = ds.forecastLabel;
  const flag = document.getElementById('heat-wave-flag');
  flag.style.display = ds.isHeatWave ? 'inline-block' : 'none';
}

function renderDashMap(data) {
  // Initialize or reuse
  if (!state.dashMap) {
    const region = data.region || { center_lat: 35.8, center_lng: 9.5 };
    state.dashMap = L.map('dashboard-map').setView([region.center_lat, region.center_lng], 10);
    const cfg = TILE_PROVIDERS[currentMapMode] || TILE_PROVIDERS.normal;
    baseTileLayer = L.tileLayer(cfg.url, { attribution: cfg.attr, ...cfg.opts });
    baseTileLayer.addTo(state.dashMap);
  }

  // Update thermal legend indicator with current heat wave state
  updateThermalHeatData(data.isHeatWave);

  // If thermal layer is active, tiles update automatically — just refresh opacity indicator
  if (owmTempLayer && state.dashMap.hasLayer(owmTempLayer)) {
    owmTempLayer.setOpacity(0.75);
  }

  // Remove old plot layers
  dashMapLayers.forEach(l => state.dashMap.removeLayer(l));
  dashMapLayers = [];

  const bounds = [];

  data.plotCards.forEach(({ plot, crop, recommendation }) => {
    let geojson;
    try { geojson = JSON.parse(plot.polygon_geojson); } catch(e) { return; }

    // In thermal mode: white outline only (canvas provides the heat signal)
    // In normal mode: green/red fill
    const isThermal = currentMapMode === 'thermal';
    const col = recommendation.applyMulch ? '#c0392b' : '#2da84a';
    const style = isThermal
      ? { color: '#fff', weight: 2, fillOpacity: 0, opacity: 0.85 }
      : { color: col, fillColor: col, fillOpacity: 0.3, weight: 2, opacity: 1 };

    const layer = L.geoJSON(geojson, { style }).addTo(state.dashMap);

    layer._applyMulch = recommendation.applyMulch;
    layer._evapRate   = recommendation.evapRate;

    layer.bindPopup(`
      <strong>${crop.name}</strong><br>
      Evaporation: <strong>${recommendation.evapRate} mm/day</strong><br>
      Area: ${plot.area_ha} ha<br>
      Degradation: ${recommendation.degradationPct}%<br>
      ${recommendation.applyMulch ? '⚠️ Apply mulch now' : '✅ Mulch OK'}
    `);

    dashMapLayers.push(layer);
    layer.bringToFront();

    try {
      const b = layer.getBounds();
      bounds.push(b.getNorthWest(), b.getSouthEast());
    } catch(_) {}
  });

  if (bounds.length) state.dashMap.fitBounds(L.latLngBounds(bounds), { padding: [30, 30] });
}

function renderPlotCards(plotCards) {
  const container = document.getElementById('plot-cards-container');

  if (!plotCards.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="icon">🌱</span>
        <p>No plots yet. Sign up and draw your plot to see recommendations.</p>
      </div>`;
    return;
  }

  // Crop photography (Unsplash)
  const CROP_PHOTOS = {
    'Tomato':           'https://images.unsplash.com/photo-1592841200221-a6898f307baa?w=800&q=70&auto=format&fit=crop',
    'Pepper':           'https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=800&q=70&auto=format&fit=crop',
    'Eggplant':         'https://images.unsplash.com/photo-1659618143782-b400c92e7fe5?w=800&q=70&auto=format&fit=crop',
    'Zucchini':         'https://images.unsplash.com/photo-1587334274328-64186a80aeee?w=800&q=70&auto=format&fit=crop',
    'Potato':           'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800&q=70&auto=format&fit=crop',
    'Onion':            'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&q=70&auto=format&fit=crop',
    'Garlic':           'https://images.unsplash.com/photo-1540148426945-6cf22a6b2383?w=800&q=70&auto=format&fit=crop',
    'Carrot':           'https://images.unsplash.com/photo-1582515073490-39981397c445?w=800&q=70&auto=format&fit=crop',
    'Watermelon':       'https://images.unsplash.com/photo-1508747703725-719777637510?w=800&q=70&auto=format&fit=crop',
    'Melon':            'https://images.unsplash.com/photo-1571575173700-afb9492e6a50?w=800&q=70&auto=format&fit=crop',
    'Strawberry':       'https://images.unsplash.com/photo-1464965911861-746a04b4bca6?w=800&q=70&auto=format&fit=crop',
    'Young Olive Tree': 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=70&auto=format&fit=crop',
    'Citrus':           'https://images.unsplash.com/photo-1611080626919-7cf5a9dbab12?w=800&q=70&auto=format&fit=crop',
    'Fig Tree':         'https://images.unsplash.com/photo-1601379327928-bedfaf9da2d0?w=800&q=70&auto=format&fit=crop',
    'Pomegranate':      'https://images.unsplash.com/photo-1514756331096-242fdeb70d4a?w=800&q=70&auto=format&fit=crop',
    'Date Palm':        'https://images.unsplash.com/photo-1593101900567-9a4c0da47e72?w=800&q=70&auto=format&fit=crop',
    'Almond Tree':      'https://images.unsplash.com/photo-1608797178974-15b35a64ede9?w=800&q=70&auto=format&fit=crop',
  };

  container.innerHTML = plotCards.map(({ plot, crop, soil, recommendation, serviceRequest }) => {
    const rec = recommendation;
    const cardClass  = rec.isHeatWave ? 'heat-wave' : (rec.applyMulch ? 'apply-yes' : 'apply-no');
    const verdictIcon = rec.applyMulch ? '⚠️' : '✅';
    const verdictText = rec.applyMulch ? `Apply ${rec.mulchThicknessCm} cm mulch` : `Mulch OK — no action needed`;
    const fillClass   = rec.degradationPct < 40 ? 'fill-green' : rec.degradationPct < 60 ? 'fill-amber' : 'fill-red';
    const seasonIcon  = { summer: '☀️', spring: '🌱', winter: '❄️' }[rec.season] || '🌤';
    const photo       = CROP_PHOTOS[crop.name] || CROP_PHOTOS['Tomato'];
    const moistureMap = {
      high:   { label: '💧 High',   cls: 'badge-green' },
      medium: { label: '🟡 Medium', cls: 'badge-amber' },
      low:    { label: '🔴 Low',    cls: 'badge-red'   },
    };
    const moisture = moistureMap[rec.soilMoisture] || moistureMap.medium;

    let reqHtml = '';
    if (serviceRequest) {
      const sc = { pending: 'badge-amber', scheduled: 'badge-blue', completed: 'badge-green' };
      const sched = serviceRequest.scheduled_at ? ` · ${serviceRequest.scheduled_at}` : '';
      reqHtml = `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <span class="status-pill ${sc[serviceRequest.status] || 'badge-amber'}">
          🚜 ${serviceRequest.status.charAt(0).toUpperCase()+serviceRequest.status.slice(1)}${sched}
        </span></div>`;
    }

    return `
    <div class="plot-block">
      <div class="plot-img-band">
        <img src="${photo}" alt="${crop.name} field" loading="lazy" />
        <div class="plot-img-band-overlay">
          <div>
            <div class="plot-img-title">${crop.name} <span style="font-size:.78rem;font-weight:400;opacity:.7;">/ ${crop.name_ar}</span></div>
            <div class="plot-img-meta">${seasonIcon} ${rec.season} · 🪨 ${soil.name} · 📐 ${plot.area_ha} ha</div>
          </div>
        </div>
        ${rec.isHeatWave ? '<div style="position:absolute;top:12px;right:12px;"><span class="status-pill badge-amber">🔥 Heat wave</span></div>' : ''}
        <div style="position:absolute;bottom:12px;right:12px;">
          <span class="status-pill ${moisture.cls}">${moisture.label}</span>
        </div>
      </div>
      <div class="plot-body">
        <div class="rec-card ${cardClass}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
            <div class="rec-verdict">${verdictIcon} ${verdictText}</div>
            <small style="color:var(--text-muted);">Apply before <strong style="color:var(--text);">${rec.deadlineDate}</strong></small>
          </div>
          <div class="progress-wrap">
            <div class="progress-label"><span>Mulch degradation</span><strong>${rec.degradationPct}%</strong></div>
            <div class="progress-bar"><div class="progress-fill ${fillClass}" style="width:${rec.degradationPct}%"></div></div>
          </div>
          <div class="stat-grid">
            <div class="stat-box"><div class="s-label">Evaporation</div><div class="s-value">${rec.evapRate}</div><div class="s-unit">mm / day</div></div>
            <div class="stat-box"><div class="s-label">Thickness</div><div class="s-value">${rec.mulchThicknessCm}</div><div class="s-unit">cm recommended</div></div>
            <div class="stat-box hi"><div class="s-label">Water saved</div><div class="s-value">${rec.waterSavedM3.toLocaleString()}</div><div class="s-unit">m³ / season</div></div>
            <div class="stat-box hi"><div class="s-label">Cost saved</div><div class="s-value">${rec.electricitySavedTND}</div><div class="s-unit">TND / season</div></div>
          </div>
        </div>
        ${rec.applyMulch && !serviceRequest ? `
          <button class="btn btn-primary btn-full" onclick="requestApplication(${plot.id})" style="margin-top:4px;">
            🚜 Request Mulch Application <span class="btn-arrow">→</span>
          </button>` : ''}
        ${reqHtml}
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button class="btn btn-outline-secondary btn-sm" onclick="openEditModal(${plot.id})" style="border-radius:99px;font-size:.78rem;">
            ✏️ Edit Plot
          </button>
        </div>
        <div class="data-disclaimer" style="margin-top:12px;">
          Savings: 33% evap reduction (Univ. of Florida IFAS) · 0.45 kWh/m³ pumping · 0.320 TND/kWh STEG tariff
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Service request ──────────────────────────────────────────────────────────
async function requestApplication(plotId) {
  try {
    await POST('/api/service-requests', { plot_id: plotId, farmer_id: state.farmer.id });
    showToast('✅ Request submitted. Status: Pending');
    loadDashboard();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ─── Alerts page ──────────────────────────────────────────────────────────────
async function loadAlerts() {
  if (!state.farmer) return;
  try {
    const alerts = await GET(`/api/farmers/${state.farmer.id}/alerts`);
    renderAlerts(alerts);
    updateAlertBadge(alerts);
  } catch (e) {
    showToast('Error loading alerts: ' + e.message);
  }
}

function renderAlerts(alerts) {
  const container = document.getElementById('alerts-container');
  if (!alerts.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="icon">📭</span>
        <p>No alerts yet.<br>Click <strong>Next Day</strong> on the dashboard to trigger one.</p>
      </div>`;
    return;
  }

  const bubbles = alerts.map(alert => {
    const isHeatWave   = alert.trigger_type === 'heat_wave';
    const heatClass    = isHeatWave ? 'heat-wave-alert' : '';
    const time = new Date(alert.sent_at).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    const triggerLabel = isHeatWave ? '🔥 Heat wave alert' : '🌿 Degradation alert';
    const unreadDot    = !alert.read ? '<span class="unread-dot"></span>' : '';

    const replyBtn = !alert.replied
      ? `<button class="btn btn-primary btn-sm" onclick="replyToAlert(${alert.id})" style="font-size:.78rem;min-height:32px;padding:5px 13px;">
           Reply 1 — Schedule
         </button>
         <button class="btn btn-secondary btn-sm" onclick="markAlertRead(${alert.id})" style="font-size:.75rem;min-height:32px;padding:5px 11px;background:rgba(255,255,255,.1);color:rgba(255,255,255,.6);border:none;">
           Dismiss
         </button>`
      : `<div class="sms-replied-badge">✓ Scheduled</div>`;

    return `
      <div class="sms-bubble ${heatClass} ${alert.replied ? 'replied' : ''}" id="alert-${alert.id}">
        <div class="sms-time">${unreadDot}${triggerLabel} · Plot #${alert.plot_id} (${alert.crop_name}) · ${time}</div>
        <div class="sms-text">${escHtml(alert.message)}</div>
        <div class="sms-actions">${replyBtn}</div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="sms-phone-frame">
      <div class="sms-phone-header">
        <div class="sms-phone-label">SMS — Mulch Advisory Service</div>
        <div class="sms-phone-status"><span class="live-dot"></span> ${alerts.length} message${alerts.length !== 1 ? 's' : ''}</div>
      </div>
      ${bubbles}
    </div>`;
}

function updateAlertBadge(alerts) {
  const unread = alerts.filter(a => !a.read && !a.replied).length;
  // Desktop nav badge
  const badge = document.getElementById('alert-badge');
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'inline-block' : 'none';
  }
  // Mobile nav badge
  const mBadge = document.getElementById('mobile-alert-badge');
  if (mBadge) {
    mBadge.textContent = unread;
    mBadge.style.display = unread > 0 ? 'inline-block' : 'none';
  }
}

async function replyToAlert(alertId) {
  try {
    const res = await POST(`/api/alerts/${alertId}/reply`);
    showToast(`✅ ${res.message}`);
    loadAlerts();
    loadDashboard();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function markAlertRead(alertId) {
  try {
    await POST(`/api/alerts/${alertId}/mark-read`);
    loadAlerts();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Demo controls ────────────────────────────────────────────────────────────
async function simulateDay() {
  const btn = document.getElementById('simulate-day-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Simulating…';
  try {
    const res = await POST('/api/demo/simulate-day');
    state.demoState = {
      currentDate:   res.newDate,
      dayOffset:     res.dayOffset,
      isHeatWave:    res.isHeatWave,
      forecastLabel: res.forecastLabel,
    };
    renderDemoBanner();
    await loadDashboard();
    if (res.alertsGenerated > 0) {
      showToast(`🔔 ${res.alertsGenerated} new alert(s) generated!`, 3500);
      // Update badge without navigating away
      const alerts = await GET(`/api/farmers/${state.farmer.id}/alerts`);
      updateAlertBadge(alerts);
    } else {
      showToast(`Day advanced → ${res.newDate}. No new alerts.`);
    }
  } catch (e) {
    showToast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⏭ Simulate Day';
  }
}

async function resetDemo() {
  if (!confirm('Reset all demo alerts and service requests?')) return;
  try {
    const res = await POST('/api/demo/reset');
    showToast('↺ Demo reset. Alerts cleared.');
    await loadDashboard();
    const alerts = await GET(`/api/farmers/${state.farmer.id}/alerts`);
    updateAlertBadge(alerts);
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

// ─── Session management ───────────────────────────────────────────────────────
function saveSession(farmer) {
  localStorage.setItem('farmer', JSON.stringify(farmer));
}
function clearSession() {
  localStorage.removeItem('farmer');
}
function restoreSession() {
  try { return JSON.parse(localStorage.getItem('farmer')); } catch { return null; }
}

function onLoggedIn(farmer) {
  state.farmer = farmer;
  saveSession(farmer);

  // Update nav
  document.getElementById('nav-farmer-name').textContent = farmer.name;
  document.getElementById('nav-farmer-name').style.display = 'inline';
  document.getElementById('nav-dashboard').style.display   = 'list-item';
  document.getElementById('nav-alerts').style.display      = 'list-item';
  document.getElementById('nav-logout').style.display      = 'list-item';

  // Show mobile bottom nav & footer
  const mbn = document.getElementById('mobile-bottom-nav');
  if (mbn) { mbn.style.display = 'flex'; mbn.style.setProperty('display', 'flex', 'important'); }
  const footer = document.getElementById('app-footer');
  if (footer) footer.classList.add('visible');

  showPage('page-dashboard');
  loadDashboard();
}

function onLogout() {
  state.farmer = null;
  clearSession();

  document.getElementById('nav-farmer-name').style.display = 'none';
  document.getElementById('nav-dashboard').style.display   = 'none';
  document.getElementById('nav-alerts').style.display      = 'none';
  document.getElementById('nav-logout').style.display      = 'none';

  const mbn = document.getElementById('mobile-bottom-nav');
  if (mbn) mbn.style.setProperty('display', 'none', 'important');
  const footer = document.getElementById('app-footer');
  if (footer) footer.classList.remove('visible');

  document.getElementById('plot-cards-container').innerHTML = '';
  showPage('page-auth');
  showLoginView();
}

// ─── Dark / Light mode (farmer app) ──────────────────────────────────────────
function toggleFarmerTheme() {
  const cur  = document.documentElement.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('farmer-theme', next);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

function initFarmerTheme() {
  const saved = localStorage.getItem('farmer-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
}

function setLoaderStatus(msg) {
  const el = document.getElementById('loader-status');
  if (el) el.textContent = msg;
}

function hideLoader() {
  const loader = document.getElementById('ecoray-loader');
  if (!loader) return;
  loader.classList.add('fade-out');
  setTimeout(() => loader.remove(), 600);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    initFarmerTheme();
    setLoaderStatus('Loading…');
    // Load reference data
    await loadReferenceData();
    setLoaderStatus('Setting up…');

  // Wire desktop nav links
  document.getElementById('nav-dashboard').addEventListener('click', e => { e.preventDefault(); showPage('page-dashboard'); });
  document.getElementById('nav-alerts').addEventListener('click',   e => { e.preventDefault(); showPage('page-alerts'); });
  document.getElementById('nav-logout').addEventListener('click',   e => { e.preventDefault(); onLogout(); });

  // Wire mobile bottom nav
  document.querySelectorAll('.nav-btn-mobile').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.target));
  });

  // Smooth scroll for hero CTA
  document.querySelectorAll('.scrollto').forEach(a => {
    a.addEventListener('click', e => {
      const target = document.querySelector(a.getAttribute('href'));
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }
    });
  });

  // ── Auth: Login ──────────────────────────────────────────────────
  document.getElementById('login-btn').addEventListener('click', async () => {
    hideError('login-error');
    const phone = '+216' + document.getElementById('login-phone').value.trim();
    if (!phone) { showError('login-error', 'Please enter your phone number.'); return; }
    try {
      const { farmer } = await POST('/api/login', { phone });
      onLoggedIn(farmer);
    } catch (e) {
      showError('login-error', e.message);
    }
  });

  document.getElementById('login-phone').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });

  document.getElementById('go-signup-btn').addEventListener('click', showSignupView);
  document.getElementById('back-to-login-btn').addEventListener('click', showLoginView);
  // nav-logout is wired above in the nav section

  // ── Auth: Signup step 1 ──────────────────────────────────────────
  document.getElementById('signup-next1-btn').addEventListener('click', () => {
    hideError('signup-step1-error');
    const name  = document.getElementById('signup-name').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    if (!name)  { showError('signup-step1-error', 'Please enter your name.'); return; }
    if (!phone) { showError('signup-step1-error', 'Please enter your phone number.'); return; }
    state.signupData = { name, phone: '+216' + phone, region_id: null }; // region_id set after map drawing
    setSignupStep(2);
  });

  // ── Auth: Signup step 2 (map) ────────────────────────────────────
  document.getElementById('undo-point-btn').addEventListener('click', undoLastPoint);
  document.getElementById('clear-polygon-btn').addEventListener('click', clearPolygon);
  document.getElementById('close-polygon-btn').addEventListener('click', closePolygon);

  document.getElementById('back-step1-btn').addEventListener('click', () => setSignupStep(1));
  document.getElementById('signup-next2-btn').addEventListener('click', () => {
    hideError('signup-step2-error');
    if (!state.drawnPolygon) {
      // Try to close the polygon first
      if (drawPoints.length >= 3) {
        if (!closePolygon()) return;
      } else {
        showError('signup-step2-error', 'Please draw your plot on the map (at least 3 points).');
        return;
      }
    }
    setSignupStep(3);
  });

  // ── Auth: Signup step 3 (crop/soil) ─────────────────────────────
  document.getElementById('back-step2-btn').addEventListener('click', () => setSignupStep(2));
  document.getElementById('signup-submit-btn').addEventListener('click', async () => {
    hideError('signup-step3-error');
    const cropId  = document.getElementById('signup-crop').value;
    const soilId  = document.getElementById('signup-soil').value;
    if (!cropId) { showError('signup-step3-error', 'Please select a crop type.'); return; }
    if (!soilId) { showError('signup-step3-error', 'Please select a soil type.'); return; }
    if (!state.signupData.region_id) {
      showError('signup-step3-error', 'Region could not be detected. Please go back and draw your plot on the map.');
      return;
    }

    const btn = document.getElementById('signup-submit-btn');
    btn.disabled = true; btn.textContent = '⏳ Creating account…';

    try {
      // Create farmer
      const { farmer } = await POST('/api/signup', state.signupData);

      // Create plot
      await POST('/api/plots', {
        farmer_id:       farmer.id,
        region_id:       state.signupData.region_id,
        crop_id:         parseInt(cropId),
        soil_type_id:    parseInt(soilId),
        polygon_geojson: state.drawnPolygon,
        area_ha:         parseFloat(state.drawnAreaHa.toFixed(4)),
      });

      showToast('✅ Account created!');
      onLoggedIn(farmer);
    } catch (e) {
      showError('signup-step3-error', e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🌿 Create Account';
    }
  });

  // ── Demo controls ────────────────────────────────────────────────
  document.getElementById('simulate-day-btn').addEventListener('click', simulateDay);
  document.getElementById('reset-demo-btn').addEventListener('click', resetDemo);

  // ── Restore session ──────────────────────────────────────────────
  const saved = restoreSession();
  if (saved) {
    setLoaderStatus('Restoring session…');
    onLoggedIn(saved);
  }
  setLoaderStatus('Ready!');
  setTimeout(hideLoader, 400);
  } catch(err) {
    console.error('init() failed:', err);
    hideLoader();
  }
}

// Expose functions used in inline event handlers
// ─── Edit plot modal ──────────────────────────────────────────────────────────
let editMap        = null;
let editPoints     = [];
let editMarkers    = [];
let editPolyline   = null;
let editLayer      = null;
let editNewPolygon = null;
let editNewAreaHa  = null;

async function openEditModal(plotId) {
  // Load latest plot data
  const dash = await GET(`/api/farmers/${state.farmer.id}/dashboard`);
  const card = dash.plotCards.find(c => c.plot.id === plotId);
  if (!card) { showToast('Plot not found'); return; }

  const { plot, crop, soil } = card;

  // Reset edit state
  editNewPolygon = null; editNewAreaHa = null;
  editPoints = []; editMarkers = []; editPolyline = null; editLayer = null;

  document.getElementById('edit-plot-id').value      = plot.id;
  document.getElementById('edit-plot-subtitle').textContent =
    `Plot #${plot.id} · ${crop.name} · ${plot.area_ha} ha`;
  document.getElementById('edit-last-app').value     = plot.last_application_date || '';
  document.getElementById('edit-area-display').style.display = 'none';
  document.getElementById('edit-error').style.display = 'none';

  // Populate crop dropdown
  const cropSel = document.getElementById('edit-crop-id');
  cropSel.innerHTML = '';
  state.crops.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = `${c.name} / ${c.name_ar}`;
    if (c.id === plot.crop_id) o.selected = true;
    cropSel.appendChild(o);
  });

  // Populate soil dropdown
  const soilSel = document.getElementById('edit-soil-id');
  soilSel.innerHTML = '';
  state.soilTypes.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = `${s.name} / ${s.name_ar}`;
    if (s.id === plot.soil_type_id) o.selected = true;
    soilSel.appendChild(o);
  });

  // Show modal
  document.getElementById('edit-plot-modal').style.display = 'block';

  // Init edit map (after modal visible so Leaflet can measure size)
  setTimeout(() => {
    if (!editMap) {
      editMap = L.map('edit-map').setView([35.0, 9.5], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 19,
      }).addTo(editMap);
      editMap.on('click', e => {
        if (editLayer) return;
        const pt = [e.latlng.lat, e.latlng.lng];
        editPoints.push(pt);
        editMarkers.push(
          L.circleMarker(pt, { radius:6, color:'#116530', fillColor:'#2ea359', fillOpacity:1, weight:2 })
            .addTo(editMap)
        );
        editUpdatePreview();
      });
    } else {
      editMap.invalidateSize();
    }

    // Show existing polygon
    try {
      const geo = JSON.parse(plot.polygon_geojson);
      L.geoJSON(geo, { style: { color:'#116530', fillColor:'#2ea359', fillOpacity:.2, weight:2, dashArray:'5,5' } })
        .addTo(editMap);
      editMap.fitBounds(L.geoJSON(geo).getBounds(), { padding:[20,20] });
    } catch(_) {}
  }, 80);
}

function editUpdatePreview() {
  if (editPolyline) editMap.removeLayer(editPolyline);
  if (editPoints.length < 2) return;
  editPolyline = L.polyline(editPoints, { color:'#116530', weight:2, dashArray:'4,4' }).addTo(editMap);
}

function editClosePolygon() {
  if (editPoints.length < 3) { showToast('Need at least 3 points'); return; }
  if (editLayer) return;
  if (editPolyline) { editMap.removeLayer(editPolyline); editPolyline = null; }
  editMarkers.forEach(m => editMap.removeLayer(m)); editMarkers = [];
  editLayer = L.polygon(editPoints, { color:'#116530', fillColor:'#2ea359', fillOpacity:.3, weight:2 }).addTo(editMap);
  editMap.fitBounds(editLayer.getBounds());

  editNewAreaHa = computeAreaHa(editPoints);
  const coords = editPoints.map(p => [p[1], p[0]]); coords.push(coords[0]);
  editNewPolygon = { type:'Polygon', coordinates:[coords] };

  document.getElementById('edit-area-value').textContent = editNewAreaHa.toFixed(2);
  document.getElementById('edit-area-display').style.display = 'block';
}

function editUndoPoint() {
  if (editLayer) {
    editMap.removeLayer(editLayer); editLayer = null;
    editNewPolygon = null; editNewAreaHa = null;
    document.getElementById('edit-area-display').style.display = 'none';
    editMarkers = editPoints.map(p =>
      L.circleMarker(p, { radius:6, color:'#116530', fillColor:'#2ea359', fillOpacity:1, weight:2 }).addTo(editMap)
    );
    editUpdatePreview(); return;
  }
  if (!editPoints.length) return;
  editPoints.pop();
  const m = editMarkers.pop(); if (m) editMap.removeLayer(m);
  editUpdatePreview();
}

function editClearPolygon() {
  if (editLayer)    { editMap.removeLayer(editLayer);    editLayer = null; }
  if (editPolyline) { editMap.removeLayer(editPolyline); editPolyline = null; }
  editMarkers.forEach(m => editMap.removeLayer(m));
  editMarkers = []; editPoints = [];
  editNewPolygon = null; editNewAreaHa = null;
  document.getElementById('edit-area-display').style.display = 'none';
}

function closeEditModal() {
  document.getElementById('edit-plot-modal').style.display = 'none';
  editClearPolygon();
}

async function saveEditPlot() {
  const plotId    = document.getElementById('edit-plot-id').value;
  const cropId    = document.getElementById('edit-crop-id').value;
  const soilId    = document.getElementById('edit-soil-id').value;
  const lastApp   = document.getElementById('edit-last-app').value;
  const errEl     = document.getElementById('edit-error');
  errEl.style.display = 'none';

  const btn = document.getElementById('edit-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    const body = {
      crop_id:              parseInt(cropId),
      soil_type_id:         parseInt(soilId),
      last_application_date: lastApp || null,
    };
    if (editNewPolygon) {
      body.polygon_geojson = editNewPolygon;
      body.area_ha         = parseFloat(editNewAreaHa.toFixed(4));
    }

    await api('PUT', `/api/plots/${plotId}`, body);
    showToast('✅ Plot updated!');
    closeEditModal();
    loadDashboard();
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes →';
  }
}

window.requestApplication = requestApplication;
window.replyToAlert       = replyToAlert;
window.markAlertRead      = markAlertRead;
window.setMapMode         = setMapMode;
window.toggleFarmerTheme  = toggleFarmerTheme;
window.openEditModal      = openEditModal;
window.closeEditModal     = closeEditModal;
window.saveEditPlot       = saveEditPlot;
window.editUndoPoint      = editUndoPoint;
window.editClearPolygon   = editClearPolygon;
window.editClosePolygon   = editClosePolygon;

// Boot when DOM is ready
document.addEventListener('DOMContentLoaded', init);
