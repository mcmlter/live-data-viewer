/* =============================================================
   MCM Live — shared.js
   Chart engine shared by met.js and lake.js
   D3 v7  |  Static GitHub Pages deployment
   ============================================================= */

'use strict';

// ─── Constants ────────────────────────────────────────────────
const GAP_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours → line break
// 16 distinct accessible colors — ordered for maximum hue separation.
// First 4 (lakes): Teal, Red, Green, Purple.
const PALETTE = [
  '#0c8599', // 0: teal
  '#e03131', // 1: red
  '#2f9e44', // 2: green
  '#7048e8', // 3: purple
  '#e8590c', // 4: orange
  '#c2255c', // 5: magenta
  '#f08c00', // 6: amber
  '#495057', // 7: charcoal slate
  '#7d4037', // 8: brown
  '#5c940d', // 9: lime
  '#087f5b', // 10: emerald
  '#5f3dc4', // 11: indigo
  '#1971c2', // 12: deep blue (higher index)
  '#a61e4d', // 13: dark crimson
  '#9c36b5', // 14: grape
  '#d6336c', // 15: rose
];
const MARGIN = { top: 10, right: 20, bottom: 30, left: 58 };
const PANEL_HEIGHT = 160; // inner chart height in px

// ─── Helpers ─────────────────────────────────────────────────
function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = +v;
  return isNaN(n) ? null : n;
}

function toLocalISOString(d) {
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function setStatus(msg, isError = false) {
  const el = document.getElementById('status-bar');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

function siteColor(code, sites) {
  const idx = sites.indexOf(code);
  return PALETTE[idx % PALETTE.length];
}

// ─── State factory ────────────────────────────────────────────
function createState(panels, defaultVisible) {
  const panelVisible = Object.fromEntries(
    panels.map(p => [p.id, defaultVisible ? defaultVisible.includes(p.id) : true])
  );
  return {
    activeStations: [],
    cache: new Map(),
    timeDomain: null,
    panelVisible,
    manualY: {},
  };
}

// ─── Time domain helpers ──────────────────────────────────────
function globalExtent(state) {
  let min = Infinity, max = -Infinity;
  for (const rows of state.cache.values()) {
    if (!rows.length) continue;
    if (rows[0].time < min) min = rows[0].time;
    if (rows[rows.length - 1].time > max) max = rows[rows.length - 1].time;
  }
  if (!isFinite(min)) return null;
  return [new Date(min), new Date(max)];
}

function effectiveTimeDomain(state) {
  if (state.timeDomain) return state.timeDomain;
  const ext = globalExtent(state);
  if (!ext) return [new Date(Date.now() - 7 * 24 * 3600000), new Date()];
  const end = ext[1];
  return [new Date(end.getTime() - 7 * 24 * 3600000), end];
}

// ─── Data loading ─────────────────────────────────────────────
async function loadSite(code, appCtx) {
  const { state, dataUrlFn, parseRowFn, siteLabel } = appCtx;
  if (state.cache.has(code)) return state.cache.get(code);
  setStatus(`Loading ${siteLabel(code)}…`);
  try {
    const raw = await d3.csv(dataUrlFn(code));
    if (raw.length === 0) { state.cache.set(code, []); setStatus(''); return []; }
    const rows = raw
      .map(parseRowFn)
      .filter(r => r.time instanceof Date && !isNaN(r.time))
      .sort((a, b) => a.time - b.time);
    state.cache.set(code, rows);
    setStatus('');
    return rows;
  } catch (e) {
    setStatus(`Error loading ${siteLabel(code)}: ${e.message}`, true);
    state.cache.set(code, []);
    return [];
  }
}

// ─── Chart drawing ────────────────────────────────────────────
function getOrCreatePanelSvg(panelId, extraBottom = 0) {
  const container = document.querySelector(`#panel-${panelId} .panel-svg-container`);
  const W = container.clientWidth || 900;
  const innerW = W - MARGIN.left - MARGIN.right;
  const innerH = PANEL_HEIGHT;
  const totalH = innerH + MARGIN.top + MARGIN.bottom + extraBottom;

  let svg = d3.select(container).select('svg');
  if (svg.empty()) {
    svg = d3.select(container).append('svg').attr('width', W).attr('height', totalH);
    svg.append('g').attr('class', 'chart-root').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`);
  } else {
    svg.attr('width', W).attr('height', totalH);
  }

  let defs = svg.select('defs');
  if (defs.empty()) defs = svg.append('defs');
  let clip = defs.select(`#clip-${CSS.escape(panelId)}`);
  if (clip.empty()) { clip = defs.append('clipPath').attr('id', `clip-${panelId}`); clip.append('rect'); }
  clip.select('rect').attr('x', 0).attr('y', 0).attr('width', innerW).attr('height', innerH);

  return { svg, innerW, innerH };
}

function buildXScale(innerW, timeDomain) {
  return d3.scaleUtc().domain(timeDomain).range([0, innerW]);
}

/** DRY helper: add (or sync) Y-min/max manual controls to a panel header. */
function addYControls(panelEl, panelId, state, redrawFn) {
  let controls = panelEl.querySelector('.y-controls');
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'y-controls';
    controls.innerHTML = `
      <label>Y-Min <input type="number" class="y-min" step="any" placeholder="Auto"></label>
      <label>Y-Max <input type="number" class="y-max" step="any" placeholder="Auto"></label>
      <button class="y-auto-btn">Auto</button>
    `;
    panelEl.querySelector('.panel-header').appendChild(controls);

    const minIn = controls.querySelector('.y-min');
    const maxIn = controls.querySelector('.y-max');
    const updateManual = () => {
      const mn = parseFloat(minIn.value), mx = parseFloat(maxIn.value);
      if (isNaN(mn) && isNaN(mx)) { delete state.manualY[panelId]; }
      else {
        const cur = state.manualY[panelId] || [null, null];
        state.manualY[panelId] = [isNaN(mn) ? cur[0] : mn, isNaN(mx) ? cur[1] : mx];
      }
      redrawFn();
    };
    minIn.addEventListener('change', updateManual);
    maxIn.addEventListener('change', updateManual);
    controls.querySelector('.y-auto-btn').addEventListener('click', () => {
      minIn.value = ''; maxIn.value = '';
      delete state.manualY[panelId];
      redrawFn();
    });
  }
  const manual = state.manualY[panelId];
  controls.querySelector('.y-min').value = manual && manual[0] !== null ? manual[0] : '';
  controls.querySelector('.y-max').value = manual && manual[1] !== null ? manual[1] : '';
}

/** Split a row array into contiguous segments (break on time gaps or null value). */
function splitOnGaps(rows, valueGetter) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], v = valueGetter(r), prev = rows[i - 1];
    const gapTime = i > 0 && (r.time - prev.time) > GAP_THRESHOLD_MS;
    if (gapTime && cur.length) { segs.push(cur); cur = []; }
    if (v !== null) cur.push(r);
    else if (cur.length) { segs.push(cur); cur = []; }
  }
  if (cur.length) segs.push(cur);
  return segs;
}

/** Draw (or redraw) a scalar panel. */
function drawScalarPanel(panel, datasets, appCtx) {
  const { state, sites, fieldForPanel, redrawPanels } = appCtx;
  const panelEl = document.getElementById(`panel-${panel.id}`);
  if (!panelEl) return;
  const oldMsg = panelEl.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  const activeDatasets = datasets.filter(({ rows }) => rows.some(r => fieldForPanel(panel, r) !== null));
  addYControls(panelEl, panel.id, state, redrawPanels);

  if (activeDatasets.length === 0) {
    const container = panelEl.querySelector('.panel-svg-container');
    d3.select(container).select('svg').remove();
    container.innerHTML = `<p class="no-data-msg">No ${panel.label.toLowerCase()} data available for selected station(s).</p>`;
    return;
  }

  const td = effectiveTimeDomain(state);
  const [t0, t1] = td;
  const { svg, innerW, innerH } = getOrCreatePanelSvg(panel.id);
  const xScale = buildXScale(innerW, td);
  const root = svg.select('.chart-root');

  // Y domain
  let allVals = [];
  for (const { rows } of activeDatasets)
    for (const r of rows)
      if (r.time >= t0 && r.time <= t1) { const v = fieldForPanel(panel, r); if (v !== null) allVals.push(v); }

  let [yMin, yMax] = d3.extent(allVals);
  if (yMin === undefined) {
    [yMin, yMax] = d3.extent(activeDatasets.flatMap(d => d.rows).map(r => fieldForPanel(panel, r)).filter(v => v !== null));
    if (yMin === undefined) [yMin, yMax] = [0, 10];
  }
  let yPad = (yMax - yMin) * 0.08 || 1;
  const manual = state.manualY[panel.id];
  if (manual) {
    if (manual[0] !== null) { yMin = manual[0]; yPad = 0; }
    if (manual[1] !== null) { yMax = manual[1]; yPad = 0; }
  }
  const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).range([innerH, 0]).nice();

  root.selectAll('.axis,.grid,.data-layer').remove();

  root.append('g').attr('class', 'grid').selectAll('line')
    .data(yScale.ticks(5)).join('line').attr('class', 'grid-line')
    .attr('x1', 0).attr('x2', innerW).attr('y1', d => yScale(d)).attr('y2', d => yScale(d));

  root.append('g').attr('class', 'axis x-axis').attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(6).tickSizeOuter(0));
  root.append('g').attr('class', 'axis y-axis')
    .call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0));

  for (const { code, rows } of activeDatasets) {
    const color = siteColor(code, sites);
    const visible = rows.filter(r => r.time >= t0 && r.time <= t1);
    const g = root.append('g').attr('class', 'data-layer').attr('clip-path', `url(#clip-${panel.id})`);

    for (const seg of splitOnGaps(visible, r => fieldForPanel(panel, r))) {
      g.append('path').datum(seg).attr('class', 'data-line').attr('stroke', color)
        .attr('d', d3.line()
          .defined(r => fieldForPanel(panel, r) !== null)
          .x(r => xScale(r.time)).y(r => yScale(fieldForPanel(panel, r))));
    }
    const dotStep = Math.max(1, Math.floor(visible.length / (innerW / 4)));
    g.selectAll('circle')
      .data(visible.filter((r, i) => i % dotStep === 0 && fieldForPanel(panel, r) !== null))
      .join('circle').attr('class', 'data-dot')
      .attr('cx', r => xScale(r.time)).attr('cy', r => yScale(fieldForPanel(panel, r)))
      .attr('r', 2.5).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1);
  }

  attachZoom(svg, panel.id, innerW, innerH, appCtx);
  attachCrosshair(svg, panel.id, xScale, yScale, innerW, innerH, activeDatasets, panel, appCtx);
}

// ─── Zoom (linked across panels) ──────────────────────────────
const zoomBehaviors = new Map();

function attachZoom(svg, panelId, innerW, innerH, appCtx) {
  const { state, redrawPanels } = appCtx;
  const root = svg.select('.chart-root');

  let overlay = root.select('.zoom-overlay');
  let isNew = false;
  if (overlay.empty()) {
    overlay = root.append('rect').attr('class', 'zoom-overlay').attr('fill', 'none').attr('pointer-events', 'all');
    isNew = true;
  }
  overlay.attr('width', innerW).attr('height', innerH);

  let zoom = zoomBehaviors.get(panelId);
  if (!zoom) {
    zoom = d3.zoom().scaleExtent([1, 1000]).on('zoom', event => {
      if (!event.sourceEvent) return;
      const ext = globalExtent(state);
      if (!ext) return;
      const baseScale = d3.scaleUtc().domain(ext).range([0, innerW]);
      state.timeDomain = event.transform.rescaleX(baseScale).domain();
      for (const [id] of zoomBehaviors.entries()) {
        if (id !== panelId) {
          const otherOverlay = d3.select(`#panel-${id} .zoom-overlay`);
          if (!otherOverlay.empty()) otherOverlay.node().__zoom = event.transform;
        }
      }
      redrawPanels();
    });
    zoomBehaviors.set(panelId, zoom);
  }

  if (isNew) overlay.call(zoom);

  const ext = globalExtent(state);
  if (ext && state.timeDomain) {
    const baseScale = d3.scaleUtc().domain(ext).range([0, innerW]);
    const k = (ext[1] - ext[0]) / (state.timeDomain[1] - state.timeDomain[0]);
    const tx = -k * baseScale(state.timeDomain[0]);
    overlay.node().__zoom = d3.zoomIdentity.translate(tx, 0).scale(k);
  }
}

// ─── Crosshair tooltip ────────────────────────────────────────
function degToCardinal(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

function attachCrosshair(svg, panelId, xScale, yScale, innerW, innerH, datasets, panel, appCtx, extraFn) {
  const { state, sites, siteLabel, fieldForPanel } = appCtx;
  const tooltip = document.getElementById('tooltip');
  const overlay = svg.select('.chart-root').select('.zoom-overlay');

  overlay.on('mousemove', function (event) {
    const [mx] = d3.pointer(event);
    const t = xScale.invert(mx);
    const [t0, t1] = effectiveTimeDomain(state);
    const lines = [];
    for (const { code, rows } of datasets) {
      const vis = rows.filter(r => r.time >= t0 && r.time <= t1 && fieldForPanel(panel, r) !== null);
      if (!vis.length) continue;
      const idx = d3.bisector(r => r.time).center(vis, t);
      const r = vis[idx];
      if (!r) continue;
      lines.push({ code, val: fieldForPanel(panel, r), time: r.time, row: r });
    }
    if (!lines.length) return;
    const timeStr = d3.utcFormat('%Y-%m-%d %H:%M UTC+13')(lines[0].time);
    const rowsHtml = lines.map(l =>
      `<div class="tooltip-row">
         <span class="tooltip-label" style="color:${siteColor(l.code, sites)}">${siteLabel(l.code)}</span>
         <span class="tooltip-value">${panel.fmt(l.val)} ${panel.unit}${extraFn ? extraFn(l.row) : ''}</span>
       </div>`
    ).join('');
    tooltip.innerHTML = `<div class="tooltip-time">${timeStr}</div>${rowsHtml}`;
    tooltip.classList.add('visible');
    tooltip.setAttribute('aria-hidden', 'false');
    tooltip.style.left = Math.min(event.clientX + 14, window.innerWidth - 230) + 'px';
    tooltip.style.top = Math.min(event.clientY - 10, window.innerHeight - 120) + 'px';
  }).on('mouseleave', () => {
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  });
}

// ─── Legend ───────────────────────────────────────────────────
function updateLegend(appCtx) {
  const { state, sites, siteLabel } = appCtx;
  document.getElementById('legend').innerHTML = state.activeStations.map(code => `
    <div class="legend-item">
      <span class="legend-swatch" style="background:${siteColor(code, sites)}"></span>
      ${siteLabel(code)}
    </div>
  `).join('');
}

// ─── Station/site dropdown ────────────────────────────────────
function buildSiteDropdown(appCtx) {
  const { sites, siteLabel } = appCtx;
  const ul = document.getElementById('station-dropdown');
  ul.innerHTML = '';
  for (const code of sites) {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.code = code;
    li.innerHTML = `<span class="check" aria-hidden="true"></span><span>${siteLabel(code)}</span>`;
    li.addEventListener('click', () => toggleSite(code, li, appCtx));
    ul.appendChild(li);
  }
}

function toggleSite(code, li, appCtx) {
  const { state } = appCtx;
  const idx = state.activeStations.indexOf(code);
  if (idx === -1) {
    state.activeStations.push(code);
    li.setAttribute('aria-selected', 'true');
    li.querySelector('.check').textContent = '✓';
  } else {
    state.activeStations.splice(idx, 1);
    li.setAttribute('aria-selected', 'false');
    li.querySelector('.check').textContent = '';
  }
  updateDropdownLabel(appCtx);
  appCtx.redrawPanels();
}

function updateDropdownLabel(appCtx) {
  const { state, siteLabel } = appCtx;
  document.getElementById('station-dropdown-label').textContent =
    state.activeStations.length ? state.activeStations.map(siteLabel).join(', ') : 'Select stations…';
}

function initDropdownToggle() {
  const btn = document.getElementById('station-dropdown-btn');
  const ul = document.getElementById('station-dropdown');
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = !ul.hidden;
    ul.hidden = open;
    btn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', () => { ul.hidden = true; btn.setAttribute('aria-expanded', 'false'); });
  ul.addEventListener('click', e => e.stopPropagation());
}

// ─── Dynamic panel DOM + toggles ─────────────────────────────
function buildPanelDivs(panels) {
  const chartsEl = document.getElementById('charts');
  chartsEl.innerHTML = '';
  for (const p of panels) {
    const div = document.createElement('div');
    div.id = `panel-${p.id}`;
    div.className = 'chart-panel';
    div.dataset.panel = p.id;
    div.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">${p.label}</span>
        <span class="panel-unit">${p.unit}</span>
      </div>
      <div class="panel-svg-container"></div>
    `;
    chartsEl.appendChild(div);
  }
}

function buildPanelToggles(panels, state) {
  const group = document.querySelector('#panel-toggle-control .toggle-group');
  group.innerHTML = '';
  for (const p of panels) {
    const label = document.createElement('label');
    label.className = 'toggle-pill';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.panel = p.id;
    cb.checked = !!state.panelVisible[p.id];
    label.appendChild(cb);
    label.append(` ${p.label}`);
    group.appendChild(label);
  }
}

// ─── Time range controls ──────────────────────────────────────
function initTimeControls(appCtx) {
  const { state } = appCtx;

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const hours = btn.dataset.hours;
      if (hours === 'all') {
        state.timeDomain = globalExtent(state);
      } else {
        const ext = globalExtent(state);
        const end = ext ? ext[1] : new Date();
        state.timeDomain = [new Date(end.getTime() - hours * 3600000), end];
      }
      appCtx.redrawPanels();
    });
  });

  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');
  const ext = globalExtent(state);
  const endD = ext ? ext[1] : new Date();
  const startD = new Date(endD.getTime() - 7 * 24 * 3600 * 1000);
  const toStr = d => {
    const pad = n => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
  };
  if (!startInput.value) startInput.value = toStr(startD);
  if (!endInput.value) endInput.value = toStr(endD);

  document.getElementById('apply-range-btn').addEventListener('click', () => {
    const s = startInput.value, e = endInput.value;
    if (s && e) {
      state.timeDomain = [new Date(s), new Date(e)];
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      appCtx.redrawPanels();
    }
  });
}

// ─── Panel visibility toggles ─────────────────────────────────
function initPanelToggles(appCtx) {
  const { state } = appCtx;
  document.querySelectorAll('[data-panel]').forEach(cb => {
    if (cb.type !== 'checkbox') return;
    cb.addEventListener('change', () => {
      const id = cb.dataset.panel;
      state.panelVisible[id] = cb.checked;
      const panelEl = document.getElementById(`panel-${id}`);
      if (panelEl) panelEl.classList.toggle('hidden', !cb.checked);
      appCtx.redrawPanels();
    });
  });
}

// ─── App initialiser (entry point for met.js / lake.js) ───────
/**
 * config = {
 *   sites:           string[]         — ordered list of site codes
 *   siteNames:       {[code]: string} — human-readable names
 *   panels:          Panel[]          — panel definitions
 *   dataUrlFn:       (code) => string — URL builder
 *   parseRowFn:      (rawRow) => row  — CSV row parser
 *   fieldForPanelFn: (panel, row) => number|null
 *   defaultSite:     string           — initially selected site
 *   defaultVisible:  string[]         — panel ids visible on load
 *   drawSpecialPanel?: (panel, datasets, appCtx) => boolean
 *                    — return true if handled (e.g. wind panel)
 * }
 */
function initApp(config) {
  const {
    sites, siteNames, panels, dataUrlFn, parseRowFn,
    fieldForPanelFn, defaultSite, defaultVisible, drawSpecialPanel,
  } = config;

  const state = createState(panels, defaultVisible);
  const siteLabel = code => siteNames[code] || code.toUpperCase();

  // Build context object — passed to all drawing functions
  const appCtx = {
    state,
    sites,
    siteLabel,
    panels,
    dataUrlFn,
    parseRowFn,
    fieldForPanel: fieldForPanelFn,
    redrawPanels: null, // set below after closure
  };

  async function redrawPanels() {
    if (!state.activeStations.length) {
      for (const p of panels) {
        const panelEl = document.getElementById(`panel-${p.id}`);
        if (!panelEl) continue;
        const container = panelEl.querySelector('.panel-svg-container');
        d3.select(container).select('svg').remove();
        container.innerHTML = '<p class="no-data-msg">Select one or more stations to view data.</p>';
      }
      return;
    }

    const datasets = await Promise.all(
      state.activeStations.map(async code => ({ code, rows: await loadSite(code, appCtx) }))
    );

    // Sync custom date inputs with effective time domain
    const [startD, endD] = effectiveTimeDomain(state);
    const startInput = document.getElementById('date-start');
    const endInput = document.getElementById('date-end');
    if (startInput && endInput && document.activeElement !== startInput && document.activeElement !== endInput) {
      startInput.value = toLocalISOString(startD);
      endInput.value = toLocalISOString(endD);
    }

    for (const panel of panels) {
      const panelEl = document.getElementById(`panel-${panel.id}`);
      if (!panelEl) continue;
      if (!state.panelVisible[panel.id]) { panelEl.classList.add('hidden'); continue; }
      panelEl.classList.remove('hidden');
      if (drawSpecialPanel && drawSpecialPanel(panel, datasets, appCtx)) continue;
      drawScalarPanel(panel, datasets, appCtx);
    }

    updateLegend(appCtx);
  }

  appCtx.redrawPanels = redrawPanels;

  // Build dynamic DOM
  buildPanelDivs(panels);
  buildPanelToggles(panels, state);

  // Apply initial panel visibility classes
  for (const p of panels) {
    const el = document.getElementById(`panel-${p.id}`);
    if (el) el.classList.toggle('hidden', !state.panelVisible[p.id]);
  }

  buildSiteDropdown(appCtx);
  initDropdownToggle();
  initTimeControls(appCtx);
  initPanelToggles(appCtx);

  // Default site
  state.activeStations = [defaultSite];
  const li = document.querySelector(`[data-code="${defaultSite}"]`);
  if (li) { li.setAttribute('aria-selected', 'true'); li.querySelector('.check').textContent = '✓'; }
  updateDropdownLabel(appCtx);
  redrawPanels();

  // Resize handler
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      document.querySelectorAll('.panel-svg-container svg').forEach(s => s.remove());
      zoomBehaviors.clear();
      redrawPanels();
    }, 200);
  });
}
