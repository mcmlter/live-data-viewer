/* =============================================================
   MCM Live — lake.js
   Lake buoy config (uses shared.js)
   ============================================================= */

'use strict';

// ─── Lake sites ───────────────────────────────────────────────
const LAKE_SITES = ['elbbb', 'wlbbb', 'lfbb', 'lhbb'];

const LAKE_SITE_NAMES = {
  elbbb: 'East Lake Bonney',
  wlbbb: 'West Lake Bonney',
  lfbb: 'Lake Fryxell',
  lhbb: 'Lake Hoare',
};

// ─── Initially visible panels ─────────────────────────────────
// Edit this array to control which panels start visible on load.
// 'logger_panel_temp_c' and 'battv_min' are omitted → start hidden.
const LAKE_DEFAULT_VISIBLE = [
  'stage_avg',
  'temp_stage_avg',
  'ablation_avg',
  'temp_ablation_avg',
  'par_moored_avg',
  'par_hanging_avg',
  'air_temp_avg',
  'temp_do_deep_avg',
  'osat_do_deep_avg',
  'temp_do_shallow_avg',
  'osat_do_shallow_avg',
];

// ─── Panel definitions ────────────────────────────────────────
// Every column except 'symbol' and 'timestamp_utc' gets a panel.
const LAKE_PANELS = [
  { id: 'stage_avg', field: 'stage_avg', label: 'Lake Stage', unit: 'm', fmt: v => v.toFixed(3) },
  { id: 'temp_stage_avg', field: 'temp_stage_avg', label: 'Stage Temperature', unit: '°C', fmt: v => v.toFixed(2) },
  { id: 'ablation_avg', field: 'ablation_avg', label: 'Ablation', unit: 'm', fmt: v => v.toFixed(3) },
  { id: 'temp_ablation_avg', field: 'temp_ablation_avg', label: 'Ablation Temperature', unit: '°C', fmt: v => v.toFixed(2) },
  { id: 'par_moored_avg', field: 'par_moored_avg', label: 'PAR (Moored)', unit: 'µmol/m²/s', fmt: v => v.toFixed(2) },
  { id: 'par_hanging_avg', field: 'par_hanging_avg', label: 'PAR (Hanging)', unit: 'µmol/m²/s', fmt: v => v.toFixed(2) },
  { id: 'air_temp_avg', field: 'air_temp_avg', label: 'Air Temperature', unit: '°C', fmt: v => v.toFixed(1) },
  { id: 'temp_do_deep_avg', field: 'temp_do_deep_avg', label: 'Deep Water Temp', unit: '°C', fmt: v => v.toFixed(2) },
  { id: 'osat_do_deep_avg', field: 'osat_do_deep_avg', label: 'Deep O₂ Saturation', unit: '%', fmt: v => v.toFixed(1) },
  // { id: 'conc_mgl_do_deep_avg',    field: 'conc_mgl_do_deep_avg',    label: 'Deep DO Concentration',    unit: 'mg/L',        fmt: v => v.toFixed(2) },
  // { id: 'conc_ppm_do_deep_avg',    field: 'conc_ppm_do_deep_avg',    label: 'Deep DO (ppm)',            unit: 'ppm',         fmt: v => v.toFixed(2) },
  { id: 'temp_do_shallow_avg', field: 'temp_do_shallow_avg', label: 'Shallow Water Temp', unit: '°C', fmt: v => v.toFixed(2) },
  { id: 'osat_do_shallow_avg', field: 'osat_do_shallow_avg', label: 'Shallow O₂ Saturation', unit: '%', fmt: v => v.toFixed(1) },
  // { id: 'conc_mgl_do_shallow_avg', field: 'conc_mgl_do_shallow_avg', label: 'Shallow DO Concentration', unit: 'mg/L',        fmt: v => v.toFixed(2) },
  // { id: 'conc_ppm_do_shallow_avg', field: 'conc_ppm_do_shallow_avg', label: 'Shallow DO (ppm)',         unit: 'ppm',         fmt: v => v.toFixed(2) },
  // { id: 'logger_panel_temp_c',     field: 'logger_panel_temp_c',     label: 'Panel Temperature',        unit: '°C',          fmt: v => v.toFixed(1) },
  { id: 'battv_min', field: 'battv_min', label: 'Battery Voltage', unit: 'V', fmt: v => v.toFixed(2) },
];

function lakeDataUrl(code) {
  return `https://mcm-proxy.uwcfl.workers.dev/lake/${code.toLowerCase()}`;
}

function parseLakeRow(d) {
  let time = null;
  if (d.timestamp_utc) {
    let ts = d.timestamp_utc.trim().replace(' ', 'T');
    if (ts.length >= 19) ts = ts.slice(0, 19) + 'Z';
    time = new Date(ts);
  }
  const row = { time };
  for (const p of LAKE_PANELS) row[p.field] = num(d[p.field]);
  return row;
}

function fieldForLakePanel(panel, row) {
  return row[panel.field] !== undefined ? row[panel.field] : null;
}

// ─── Bootstrap ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initApp({
    sites: LAKE_SITES,
    siteNames: LAKE_SITE_NAMES,
    panels: LAKE_PANELS,
    dataUrlFn: lakeDataUrl,
    parseRowFn: parseLakeRow,
    fieldForPanelFn: fieldForLakePanel,
    defaultSite: 'elbbb',
    defaultVisible: LAKE_DEFAULT_VISIBLE,
  });
});
