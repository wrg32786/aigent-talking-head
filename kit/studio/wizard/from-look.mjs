// A saved style look (kit/stylelook.cjs, looks/local/<name>/look.json) as a builder plan, for "Edit in builder": the
// look's choices become your own, one step each, with no template behind them. Using the template as it is goes
// through plan.mjs fromTemplate instead, which leaves every choice to the look. No imports beyond plan.mjs.
import * as VP from './plan.mjs';

const ok = (cat, kind, id) => !!id && (!cat || !!(cat.items && cat.items[`${kind}:${id}`]));
// a cut every n seconds -> the closest pace
export const paceOfShots = mean => !(mean > 0) ? 'look' : mean < 1.5 ? 'high' : mean < 2.5 ? 'lively' : mean < 4 ? 'steady' : 'calm';

export function planFromLook(look, cat = null) {
  const L = look || {}, p = VP.defaults(paceOfShots(L.pace && L.pace.shotMean)), w = p.words;
  const cap = L.captions || {};
  if (ok(cat, 'captionStyle', cap.style)) { w.look = cap.style; w.type = VP.KINETIC_LOOKS.includes(cap.style) ? 'kinetic' : 'captions'; }
  if (w.type === 'kinetic' && ok(cat, 'captionEntrance', cap.entrance)) w.entrance = cap.entrance;
  const ti = L.titles || {};
  if (ti.on === false) w.titles.on = false;
  else { w.titles.on = true; w.titles.entrances = (ti.entrances || []).filter(id => ok(cat, 'entrance', id)); }
  if (ti.on !== false && (ti.layer === 'behind' || ti.layer === 'auto')) p.presenter.push({ id: 'behind-head', when: ti.layer === 'behind' ? 'whole' : 'hook' });
  const br = L.brand || {};
  if (ok(cat, 'theme', br.theme)) w.colors.theme = br.theme;
  const font = cap.font || br.fonts; if (typeof font === 'string' && ok(cat, 'font', font)) w.fonts = font;
  const mix = (L.transitions && L.transitions.mix) || {}, named = Object.keys(mix).filter(k => k !== 'cut' && mix[k] > 0 && ok(cat, 'transition', k));
  if (Object.keys(mix).length) p.transitions.ids = named;
  const fin = L.grade && L.grade.finish;
  if (fin) p.filters.ids = String(fin).split(',').map(x => x.trim()).filter(id => ok(cat, 'finish', id));
  const mu = L.music || {};
  if (mu.present === false) p.music.bed = 'none';
  else { if (mu.bed && (!cat || (cat.beds || []).some(b => b.id === mu.bed))) p.music.bed = mu.bed; if (['low', 'mid', 'high'].includes(mu.energy)) p.music.energy = mu.energy; }
  p.touched = ['music.energy', 'music.beatSync', 'transitions.when', 'presenter'];
  return p;
}
