// Free memory before a render that needs the person mask (Will's Windows session, 2026-11-19: a BiRefNet mask was killed
// with 10 to 12 GB free). The numbers are kit/mask_refine.py MATTE_PEAK_GB, one table per provider, plus 0.8 GB for the
// decoder, encoder and cleanup: the portrait mask needs 8.8 GB free on CPU and 25.8 GB on DirectML. kit/mask.py checks
// the same thing again just before it loads the model.
//   const MC = require('./memcheck.cjs'); MC.renderCheck('<job>/build') -> { needed, ok, model, provider, needGB, freeGB, message, options }
const os = require('os');
const fs = require('fs');
const path = require('path');
const R = require('./rules.cjs');

const PEAK_GB = {
  cpu: { 'birefnet-general-lite': 7.1, 'birefnet-general': 8.0, 'birefnet-portrait': 8.0 },
  dml: { 'birefnet-general-lite': 25.0, 'birefnet-general': 25.0, 'birefnet-portrait': 25.0 },
};
const DEFAULT_MODEL = 'birefnet-portrait';
function maskProvider() {
  if (['dml', 'cpu'].includes(process.env.MASK_PROVIDER)) return process.env.MASK_PROVIDER;
  return process.platform === 'win32' ? 'dml' : 'cpu'; // shortcut: the provider is guessed from the platform (Windows installs the DirectML build); kit/mask.py checks again with ONNX Runtime's own provider list before it loads the model
}
function needGB(model, provider = maskProvider()) {
  if (model === 'mediapipe') return 0.5;
  const peaks = provider === 'dml' ? PEAK_GB.dml : PEAK_GB.cpu;
  const name = model === 'birefnet-lite' ? 'birefnet-general-lite' : model;
  return +((peaks[name] ?? peaks[DEFAULT_MODEL]) + 0.8).toFixed(1);
}
// os.freemem() is the memory the OS can hand out now (MemAvailable on Linux, available physical memory on Windows)
const freeGB = () => +(Number(process.env.MEMCHECK_FREE_GB) || os.freemem() / 1073741824).toFixed(1);
const OPTIONS = [
  { id: 'front', label: 'Titles in front', detail: 'Nothing goes behind your head this render, so no mask is needed.' },
  { id: 'light', label: 'Lighter mask', detail: 'MediaPipe: about 0.5 GB and fast, with rougher hair edges.' },
  { id: 'anyway', label: 'Try anyway', detail: 'It may be stopped for low memory partway through.' },
];

function check(model) {
  const m = R.MASK_MODELS[String(model || DEFAULT_MODEL).toLowerCase()] || DEFAULT_MODEL;
  const provider = maskProvider();
  const need = needGB(m, provider), free = freeGB(), ok = m === 'mediapipe' || free >= need;
  const where = provider === 'dml' ? ' on DirectML' : '';
  const message = ok ? null : `Not enough free memory for the ${m} mask${where}: it needs about ${need} GB and ${free} GB is free. Close other apps, put the titles in front, or use the lighter mask.`;
  return { needed: m !== 'mediapipe', ok, model: m, provider, needGB: need, freeGB: free, message, options: ok ? [] : OPTIONS };
}

// a rebuild of <build>: does it need the person mask (something behind the head), and is there room for it?
function renderCheck(build, opts = {}) {
  let cut = {};
  try { cut = JSON.parse(fs.readFileSync(path.join(build, 'cut.json'), 'utf8')); } catch { return { needed: false, ok: true }; }
  if (!(cut.titles && cut.mask)) return { needed: false, ok: true };
  let spec; try { spec = R.maskSpec(cut, { model: opts.model }); } catch { spec = {}; }
  return check(spec.model || process.env.MASK_MODEL || DEFAULT_MODEL);
}

module.exports = { PEAK_GB, DEFAULT_MODEL, needGB, freeGB, check, renderCheck, OPTIONS };
