/* =============================================================
   MCM Live — met.js
   Met-station config + wind panel (uses shared.js)
   ============================================================= */

'use strict';

// ─── Met stations ─────────────────────────────────────────────
const STATIONS = ['boym', 'brhm', 'caam', 'cohm', 'exem', 'frlm', 'ho2m', 'hodm', 'tarm', 'vaam', 'viam'];

const STATION_NAMES = {
  boym: 'Lake Bonney',
  brhm: 'Lake Brownworth',
  caam: 'Canada Glacier',
  cohm: 'Commonwealth Glacier',
  exem: "Explorer's Cove",
  frlm: 'Lake Fryxell',
  ho2m: 'Lake Hoare',
  hodm: 'Howard Glacier',
  tarm: 'Taylor Glacier',
  vaam: 'Lake Vanda',
  viam: 'Victoria Valley',
  mism: 'Miers Valley',
  frsm: 'Friis Hills',
  flmm: 'Mt. Fleming',
};

const MS_TO_KT = 1.94384;

// ─── Initially visible panels ─────────────────────────────────
// Edit this array to control which panels start visible on load:
const MET_DEFAULT_VISIBLE = ['temperature', 'humidity', 'pressure', 'solar', 'wind'];
// 'battery' is omitted → starts hidden

const MET_PANELS = [
  { id: 'temperature', field: 'air_temp_3m',   label: 'Temperature',           unit: '°C',   fmt: v => v.toFixed(1) },
  { id: 'humidity',    field: 'rel_hum_3m',    label: 'Relative Humidity',     unit: '%',    fmt: v => v.toFixed(1) },
  { id: 'pressure',    field: 'barom_pres',    label: 'Barometric Pressure',   unit: 'hPa',  fmt: v => v.toFixed(1) },
  { id: 'solar',       field: 'sw_rad_in',     label: 'Solar Radiation',       unit: 'W/m²', fmt: v => v.toFixed(2) },
  { id: 'wind',        field: 'wind_spd_avg',  label: 'Wind Speed & Direction',unit: 'kt',   fmt: v => v.toFixed(1), isWind: true },
  { id: 'battery',     field: 'battv_min',     label: 'Battery Voltage',       unit: 'V',    fmt: v => v.toFixed(2) },
];

function metDataUrl(code) {
  return `https://mcm-proxy.uwcfl.workers.dev/met/${code.toLowerCase()}`;
}

function parseMetRow(d) {
  let time = null;
  if (d.timestamp_utc) {
    let ts = d.timestamp_utc.trim().replace(' ', 'T');
    if (ts.length >= 19) ts = ts.slice(0, 19) + 'Z';
    time = new Date(ts);
  }
  return {
    time,
    air_temp_3m:  num(d.air_temp_3m),
    rel_hum_3m:   num(d.rel_hum_3m),
    barom_pres:   num(d.barom_pres),
    sw_rad_in:    num(d.sw_rad_in),
    wind_spd:     d.wind_spd_avg !== '' && d.wind_spd_avg != null ? num(d.wind_spd_avg) * MS_TO_KT : null,
    wind_dir:     num(d.wind_direction),
    battv_min:    num(d.battv_min),
  };
}

function fieldForMetPanel(panel, row) {
  if (panel.id === 'wind') return row.wind_spd; // pre-converted to kt
  return row[panel.field] !== undefined ? row[panel.field] : null;
}

// ─── Wind panel (met-specific) ────────────────────────────────
const ARROW_ROW_H   = 16;
const ARROW_TOP_PAD = 18;
const ARROW_LABEL_H = 14;

function roundToHalfHour(ms) {
  const HALF_HR = 30 * 60000;
  return Math.max(HALF_HR, Math.round(ms / HALF_HR) * HALF_HR);
}

function formatDuration(ms) {
  const rounded = roundToHalfHour(ms);
  const min = rounded / 60000;
  if (min < 60) return `${min} min`;
  const hr = min / 60;
  if (hr < 48) return `${hr % 1 === 0 ? hr : hr.toFixed(1)} hr`;
  const days = hr / 24;
  return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
}

function circularMeanDeg(rows, getDir) {
  let sx = 0, sy = 0, n = 0;
  for (const r of rows) {
    const d = getDir(r);
    if (d === null || d === undefined) continue;
    const rad = d * Math.PI / 180;
    sx += Math.sin(rad); sy += Math.cos(rad); n++;
  }
  if (!n) return null;
  return (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
}

function drawWindArrow(g, dirTo_deg, color) {
  const LEN = 11;
  const inner = g.append('g').attr('transform', `rotate(${dirTo_deg})`);
  inner.append('line')
    .attr('x1', 0).attr('y1', LEN / 2).attr('x2', 0).attr('y2', -LEN / 2)
    .attr('stroke', color).attr('stroke-width', 1.5);
  inner.append('path')
    .attr('d', `M0,${-LEN / 2 - 3} L-3,${-LEN / 2 + 2} L3,${-LEN / 2 + 2} Z`)
    .attr('fill', color);
}

function drawWindPanel(datasets, appCtx) {
  const { state, sites, redrawPanels } = appCtx;
  const panelEl = document.getElementById('panel-wind');
  if (!panelEl) return;
  const oldMsg = panelEl.querySelector('.no-data-msg');
  if (oldMsg) oldMsg.remove();

  const activeDatasets = datasets.filter(({ rows }) => rows.some(r => r.wind_spd !== null));
  const extraBottom = ARROW_TOP_PAD + Math.max(1, activeDatasets.length) * ARROW_ROW_H + ARROW_LABEL_H;
  const { svg, innerW, innerH } = getOrCreatePanelSvg('wind', extraBottom);
  const root = svg.select('.chart-root');

  addYControls(panelEl, 'wind', state, redrawPanels);

  if (activeDatasets.length === 0) {
    const container = panelEl.querySelector('.panel-svg-container');
    d3.select(container).select('svg').remove();
    container.innerHTML = '<p class="no-data-msg">No wind data available for selected station(s).</p>';
    return;
  }

  const td = effectiveTimeDomain(state);
  const [t0, t1] = td;
  const xScale = buildXScale(innerW, td);

  let allSpeeds = [];
  for (const { rows } of activeDatasets)
    for (const r of rows)
      if (r.wind_spd !== null && r.time >= t0 && r.time <= t1) allSpeeds.push(r.wind_spd);

  let maxSpd = d3.max(allSpeeds);
  if (maxSpd === undefined) maxSpd = 10;
  let yMin = 0, yMax = maxSpd * 1.12 || 10;
  const manual = state.manualY['wind'];
  if (manual) { if (manual[0] !== null) yMin = manual[0]; if (manual[1] !== null) yMax = manual[1]; }

  const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]).nice();

  root.selectAll('.axis,.grid,.data-layer,.arrow-layer,.arrow-caption').remove();

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
    const g = root.append('g').attr('class', 'data-layer').attr('clip-path', 'url(#clip-wind)');

    for (const seg of splitOnGaps(visible, r => r.wind_spd)) {
      g.append('path').datum(seg).attr('class', 'data-line').attr('stroke', color)
        .attr('d', d3.line()
          .defined(r => r.wind_spd !== null)
          .x(r => xScale(r.time)).y(r => yScale(r.wind_spd)));
    }
    const dotStep = Math.max(1, Math.floor(visible.length / (innerW / 4)));
    g.selectAll('circle')
      .data(visible.filter((r, i) => i % dotStep === 0 && r.wind_spd !== null))
      .join('circle').attr('class', 'data-dot')
      .attr('cx', r => xScale(r.time)).attr('cy', r => yScale(r.wind_spd))
      .attr('r', 2.5).attr('fill', color).attr('stroke', '#fff').attr('stroke-width', 1);
  }

  // Direction arrows below x-axis
  const BUCKET_PX = 35;
  const targetDurationMs = (t1 - t0) / Math.max(1, Math.round(innerW / BUCKET_PX));
  const bucketDurationMs = roundToHalfHour(targetDurationMs);
  const numBuckets = Math.max(1, Math.round((t1 - t0) / bucketDurationMs));
  const bucketW = innerW / numBuckets;

  activeDatasets.forEach(({ code, rows }, stationIdx) => {
    const color = siteColor(code, sites);
    const rowY = innerH + ARROW_TOP_PAD + stationIdx * ARROW_ROW_H + ARROW_ROW_H / 2;
    const arrowG = root.append('g').attr('class', 'arrow-layer');
    for (let i = 0; i < numBuckets; i++) {
      const xStart = i * bucketW, xEnd = (i + 1) * bucketW;
      const tStart = xScale.invert(xStart), tEnd = xScale.invert(xEnd);
      const bucketRows = rows.filter(r => r.time >= tStart && r.time < tEnd && r.wind_dir !== null);
      if (!bucketRows.length) continue;
      const meanFrom = circularMeanDeg(bucketRows, r => r.wind_dir);
      if (meanFrom === null) continue;
      drawWindArrow(
        arrowG.append('g').attr('transform', `translate(${(xStart + xEnd) / 2},${rowY})`),
        (meanFrom + 180) % 360, color
      );
    }
  });

  const labelY = innerH + ARROW_TOP_PAD + Math.max(1, activeDatasets.length) * ARROW_ROW_H + ARROW_LABEL_H - 3;
  root.append('text').attr('class', 'arrow-caption')
    .attr('x', innerW / 2).attr('y', labelY).attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-muted)').attr('font-size', 10.5)
    .text(`↓ arrows show direction (blowing to), avg. per ${formatDuration(bucketDurationMs)}`);

  const windPanel = MET_PANELS.find(p => p.id === 'wind');
  attachZoom(svg, 'wind', innerW, innerH, appCtx);
  attachCrosshair(svg, 'wind', xScale, yScale, innerW, innerH, activeDatasets, windPanel, appCtx, r => {
    if (r.wind_dir === null || r.wind_dir === undefined) return '';
    const dirTo = (r.wind_dir + 180) % 360;
    return ` → ${Math.round(dirTo)}° ${degToCardinal(dirTo)}`;
  });
}

// ─── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp({
    sites:           STATIONS,
    siteNames:       STATION_NAMES,
    panels:          MET_PANELS,
    dataUrlFn:       metDataUrl,
    parseRowFn:      parseMetRow,
    fieldForPanelFn: fieldForMetPanel,
    defaultSite:     'viam',
    defaultVisible:  MET_DEFAULT_VISIBLE,
    drawSpecialPanel: (panel, datasets, appCtx) => {
      if (!panel.isWind) return false;
      drawWindPanel(datasets, appCtx);
      return true;
    },
  });
});
