// Teardown converter (kit/videomd2reel.cjs): the music bed and its level.
'use strict';
const fs = require('fs');
const path = require('path');
const SPL = require('../shotplan.cjs');

const ROOT = path.dirname(path.dirname(__dirname));

let _bpms = null;
function bedBpms() {
  if (_bpms) return _bpms;
  const cache = path.join(ROOT, 'teardown', '.bed-bpm.json');
  try { _bpms = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch { _bpms = {}; }
  return _bpms;
}
// The library bed whose tempo is closest (half and double time count).
function suggestBed(bpm, opts = {}) {
  if (!bpm) return null;
  const R = require('../rules.cjs');
  const beds = Object.keys(R.BEDS || {});
  const known = { ...bedBpms(), ...(opts.bpms || {}) };
  let best = null;
  for (const name of beds) {
    const t = known[name];
    if (!t) continue;
    const d = Math.min(...[t, t * 2, t / 2].map(x => Math.abs(x - bpm)));
    if (!best || d < best.d) best = { name, bpm: t, d };
  }
  return best;
}

// what the breakdown says about the music: tempo, level, whether there is a bed, the closest library bed
function musicOf(b, opts = {}) {
  const audio = b.audio || {}, music = audio.music || {};
  const bpm = music.tempo_bpm || audio.tempo_bpm || null;
  // the music stem's level: about -37 dB or lower is no music bed, whatever the beat tracker found
  const level = SPL.musicLevel(b.stems && b.stems.level_db);
  const hasMusic = !!(music.present || bpm) && !(level && level.bed === false);
  const bed = suggestBed(bpm, opts);
  const beatEdit = audio.beat_synced_edit === true || (audio.cuts_on_beat_ratio != null && audio.cuts_on_beat_chance != null && audio.cuts_on_beat_ratio > audio.cuts_on_beat_chance + 0.15);
  return { bpm, level, hasMusic, bed, beatEdit };
}

module.exports = { suggestBed, bedBpms, musicOf };
