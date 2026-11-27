// Free memory before a render that needs the person mask (Will's Windows session, 2026-11-19: a BiRefNet mask was killed
// with 10 to 12 GB free). The numbers are kit/mask_refine.py MATTE_PEAK_GB, one table per provider, plus 0.8 GB for the
// decoder, encoder and cleanup: the portrait mask needs 8.8 GB free on the processor and 25.8 GB on the graphics chip
// (DirectML). If the graphics chip does not fit and the processor does, the kit uses the processor. kit/mask.py checks
// the same thing again just before it loads the model.
//   const MC = require('./memcheck.cjs'); MC.renderCheck('<job>/build') -> { needed, ok, model, provider, preferred,
//   adapted, needGB, freeGB, totalGB, tight, message, note, options }
const os = require('os');
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');

const PEAK_GB = {
  cpu: { 'birefnet-general-lite': 7.1, 'birefnet-general': 8.0, 'birefnet-portrait': 8.0 },
  dml: { 'birefnet-general-lite': 25.0, 'birefnet-general': 25.0, 'birefnet-portrait': 25.0 },
};
const DEFAULT_MODEL = 'birefnet-portrait';
const TIGHT_GB = 2.5;
function availableProviders() {
  if (process.env.MASK_PROVIDER === 'dml') return ['dml'];
  if (process.env.MASK_PROVIDER === 'cpu') return ['cpu'];
  return process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'];
}
function needGB(model, provider) {
  if (model === 'mediapipe') return 0.5;
  const peaks = provider === 'dml' ? PEAK_GB.dml : PEAK_GB.cpu;
  const name = model === 'birefnet-lite' ? 'birefnet-general-lite' : model;
  return +((peaks[name] ?? peaks[DEFAULT_MODEL]) + 0.8).toFixed(1);
}
// os.freemem() is the memory the OS can hand out now (MemAvailable on Linux, available physical memory on Windows)
const freeGB = () => +(Number(process.env.MEMCHECK_FREE_GB) || os.freemem() / 1073741824).toFixed(1);
const totalGB = () => +(Number(process.env.MEMCHECK_TOTAL_GB) || os.totalmem() / 1073741824).toFixed(1);
const preferredProvider = () => availableProviders()[0] || 'cpu';
function pickProvider(model, free = freeGB()) {
  const have = availableProviders();
  if (process.env.MASK_PROVIDER === 'dml' || process.env.MASK_PROVIDER === 'cpu') return preferredProvider();
  const fits = have.filter(p => free >= needGB(model, p));
  return fits[0] || have.reduce((a, b) => needGB(model, a) <= needGB(model, b) ? a : b);
}
const OPTIONS = [
  { id: 'front', label: 'Titles in front', detail: 'Nothing goes behind your head this render, so no mask is needed.' },
  { id: 'light', label: 'Lighter mask', detail: 'About 0.5 GB and fast, with rougher hair edges.' },
  { id: 'anyway', label: 'Try anyway', detail: 'It may stop for low memory partway through.' },
];

function shortMsg(provider, need, free) {
  const where = provider === 'dml' ? ' on the graphics chip' : '';
  return `Not enough free memory for the high-quality person mask${where}: it needs about ${need} GB and ${free} GB is free. Close other apps, put the titles in front of you, or use the lighter mask.`;
}
const tightMsg = free => `This computer has only ${free} GB free. Close other apps before you transcribe or render, or the run may stop for low memory.`;
function check(model) {
  const m = R.MASK_MODELS[String(model || DEFAULT_MODEL).toLowerCase()] || DEFAULT_MODEL;
  const free = freeGB(), total = totalGB(), preferred = preferredProvider();
  const provider = pickProvider(m, free), need = needGB(m, provider);
  const ok = m === 'mediapipe' || free >= need, adapted = ok && preferred !== provider, tight = free < TIGHT_GB;
  const message = ok ? null : shortMsg(provider, need, free);
  const note = adapted
    ? `This computer has ${free} GB free. The high-quality person mask on the graphics chip needs about ${needGB(m, preferred)} GB, so this render uses the processor instead (about ${need} GB). It can take longer.`
    : (!ok ? null : tight ? tightMsg(free) : null);
  return { needed: m !== 'mediapipe', ok, model: m, provider, preferred, adapted, needGB: need, freeGB: free, totalGB: total, tight, message, note, options: ok ? [] : OPTIONS };
}
const preflight = () => check(DEFAULT_MODEL);

// a rebuild of <build>: does it need the person mask (something behind the head), and is there room for it?
function renderCheck(build, opts = {}) {
  const base = preflight();
  const none = { ...base, needed: false, ok: true, message: null, options: [], adapted: false, note: base.tight ? (base.note || tightMsg(base.freeGB)) : null };
  let cut = {};
  try { cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8')); } catch { return none; }
  if (!(cut.titles && cut.mask)) return none;
  let spec; try { spec = R.maskSpec(cut, { model: opts.model }); } catch { spec = {}; }
  return check(spec.model || process.env.MASK_MODEL || DEFAULT_MODEL);
}

module.exports = { PEAK_GB, DEFAULT_MODEL, TIGHT_GB, needGB, freeGB, totalGB, availableProviders, preferredProvider, pickProvider, check, preflight, renderCheck, OPTIONS };
