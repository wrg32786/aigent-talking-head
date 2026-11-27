// What a finished teardown measured, grouped into six layers for the Teardowns tab.
// Existing extract() / recipe data only: no new analyzer, no network, no files beyond what extract already read.
export const LAYER_IDS = ['set', 'person', 'layout', 'broll', 'type', 'motion'];
export const LAYERS = [
  { id: 'set', label: 'Set' },
  { id: 'person', label: 'Person' },
  { id: 'layout', label: 'Layout' },
  { id: 'broll', label: 'B-roll' },
  { id: 'type', label: 'Type' },
  { id: 'motion', label: 'Motion' },
];

const pack = (id, label, lines, emptyDefault) => {
  const clean = (lines || []).filter(l => l && l !== emptyDefault);
  return { id, label, lines: clean.length ? clean : [emptyDefault], empty: !clean.length };
};

const colorsOf = brand => {
  const raw = brand && brand.colors;
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return list.map(x => String(x).trim()).filter(c => c && c !== 'none');
};

const faceOf = s => {
  const f = s && s.face;
  if (!f) return null;
  if (typeof f === 'string') {
    const m = f.match(/^([0-9.]+)\s*@\s*([0-9.]+)/);
    return m ? { h: +m[1], eye: +m[2] } : null;
  }
  const h = f.h || f.faceH, eye = f.eye_y || f.eyeY;
  return h ? { h: +h, eye: eye ? +eye : null } : null;
};

const on = v => v === true || v === 'on' || v === 'yes';

export function layersView(extracted, recipe = null) {
  const ex = extracted || {};
  const sm = ex.summary || {};
  const plan = ex.plan || {};
  const brand = (recipe && recipe.brand) || {};
  const style = (recipe && recipe.style) || {};
  const shots = (recipe && recipe.shots) || [];
  const slots = Array.isArray(recipe && recipe.broll) ? recipe.broll : [];

  const setLines = [];
  if (brand.theme && brand.theme !== 'none') setLines.push('Theme ' + brand.theme);
  const colors = colorsOf(brand);
  if (colors.length) setLines.push('Colors ' + colors.slice(0, 5).join(', '));
  const finishes = (ex.finishes && ex.finishes.length) ? ex.finishes : (sm.detected && sm.detected.finishes) || [];
  if (finishes.length) setLines.push('Grade ' + finishes.join(', '));
  else if (style.finish && style.finish !== 'none') setLines.push('Grade ' + style.finish);

  const personLines = [];
  const framing = plan.framing || [...new Set(shots.map(s => s.framing).filter(Boolean))];
  if (framing.length) personLines.push('Framing ' + framing.join(', '));
  const faces = shots.map(faceOf).filter(Boolean);
  if (faces.length) {
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    const hh = avg(faces.map(f => f.h));
    const eyes = faces.map(f => f.eye).filter(n => n > 0);
    personLines.push('Face about ' + Math.round(hh * 100) + '% of the frame' + (eyes.length ? ', eyes ' + Math.round(avg(eyes) * 100) + '% down' : ''));
  }
  const titleLayers = (recipe && recipe.titles || []).map(t => t.layer).filter(l => l === 'behind' || l === 'front');
  const capLayer = style['caption-layer'];
  const titleStyleLayer = style['title-layer'];
  if (titleLayers.length) {
    const behind = titleLayers.filter(l => l === 'behind').length, front = titleLayers.length - behind;
    const bits = [];
    if (behind) bits.push(behind + ' title' + (behind === 1 ? '' : 's') + ' behind the speaker');
    if (front) bits.push(front + ' title' + (front === 1 ? '' : 's') + ' in front');
    personLines.push(bits.join(', '));
  } else if (titleStyleLayer === 'behind' || titleStyleLayer === 'front') {
    personLines.push('Titles ' + (titleStyleLayer === 'behind' ? 'behind the speaker' : 'in front'));
  }
  if (capLayer === 'behind' || capLayer === 'front') personLines.push('Captions ' + (capLayer === 'behind' ? 'behind the speaker' : 'in front'));

  const layoutLines = [];
  const shotN = ex.shots || plan.shots || sm.shots || shots.length || 0;
  if (shotN) layoutLines.push(shotN + ' shot' + (shotN === 1 ? '' : 's'));
  const kinds = {};
  for (const s of slots) { const k = s.kind || 'full'; kinds[k] = (kinds[k] || 0) + 1; }
  const layout = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0] || style['broll-layout'] || (recipe && recipe.broll && recipe.broll.layout) || null;
  if (layout && slots.length) layoutLines.push('B-roll layout ' + (kinds.split ? 'split' : layout));
  const splits = kinds.split || 0;
  if (splits) layoutLines.push(splits + ' split-screen slot' + (splits === 1 ? '' : 's'));

  const brollLines = [];
  const cutaways = plan.cutaways != null ? plan.cutaways : shots.filter(s => on(s.cutaway)).length;
  if (slots.length) {
    brollLines.push(slots.length + ' B-roll slot' + (slots.length === 1 ? '' : 's'));
    const kindLine = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + (n > 1 ? ' ×' + n : '')).join(', ');
    if (kindLine) brollLines.push('Kinds: ' + kindLine);
  } else if (cutaways) {
    brollLines.push(cutaways + ' cutaway' + (cutaways === 1 ? '' : 's'));
  }
  const graphics = ex.graphics || plan.graphics;
  if (Array.isArray(graphics) && graphics.length) brollLines.push(graphics.length + ' graphic' + (graphics.length === 1 ? '' : 's'));
  else if (typeof graphics === 'number' && graphics) brollLines.push(graphics + ' graphic' + (graphics === 1 ? '' : 's'));

  const typeLines = [];
  const cap = sm.captions || {};
  const capBits = [...new Set([cap.style || ex.captionStyle, cap.look || ex.look, cap.position, cap.color].filter(Boolean))];
  if (capBits.length) typeLines.push('Captions ' + capBits.join(', '));
  const titleN = ex.titles || (recipe && recipe.titles && recipe.titles.length) || 0;
  const entrances = (ex.entrances && ex.entrances.length) ? ex.entrances : [...new Set((recipe && recipe.titles || []).map(t => t.entrance).filter(Boolean))];
  if (titleN) typeLines.push(titleN + ' title' + (titleN === 1 ? '' : 's') + (entrances.length ? ', ' + entrances.join(' / ') : ''));
  if (ex.font && ex.font.pairing) typeLines.push('Font ' + ex.font.pairing + (ex.font.match ? ' (' + ex.font.match + ')' : ''));

  const motionLines = [];
  if (sm.averageShot) motionLines.push((sm.pacing ? sm.pacing + ' pace, ' : '') + 'a cut every ' + sm.averageShot + ' s');
  const trans = ex.transitions || (sm.detected && sm.detected.transitions) || {};
  const tnames = Object.entries(trans).sort((a, b) => b[1] - a[1]);
  if (tnames.length) motionLines.push('Transitions ' + tnames.map(([k, v]) => k + (v > 1 ? ' ×' + v : '')).join(', '));
  if (ex.punch === 'on' || (sm.detected && sm.detected.punch === 'on') || style.punch === 'on') motionLines.push('Zoom punch on the cuts');
  const moves = shots.filter(s => s.move && s.move !== 'none');
  if (moves.length) {
    const mk = [...new Set(moves.map(s => s.move))];
    motionLines.push('Camera ' + mk.join(', ') + ' on ' + moves.length + ' shot' + (moves.length === 1 ? '' : 's'));
  }
  const shakes = shots.filter(s => on(s.shake)).length;
  if (shakes) motionLines.push('Shake on ' + shakes + ' shot' + (shakes === 1 ? '' : 's'));

  return [
    pack('set', 'Set', setLines, 'We did not measure the room on its own.'),
    pack('person', 'Person', personLines, 'Nothing measured for this layer yet.'),
    pack('layout', 'Layout', layoutLines, 'Nothing measured for this layer yet.'),
    pack('broll', 'B-roll', brollLines, 'No B-roll was found.'),
    pack('type', 'Type', typeLines, 'Nothing measured for this layer yet.'),
    pack('motion', 'Motion', motionLines, 'Nothing measured for this layer yet.'),
  ];
}
