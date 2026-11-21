// The Studio steps (1.28.0): the visual steps first, sound on its own, then Review and Render. Plain JS with no
// imports, so the unit tests read the same map the page uses (tests/studio-steps.test.mjs).
export const STEPS = ['start', 'cut', 'picture', 'text', 'broll', 'music', 'review', 'render'];
export const STEP_LABEL = { start: 'Start', cut: 'Cut', picture: 'Picture', text: 'Text and graphics', broll: 'B-roll', music: 'Music and sounds', review: 'Review', render: 'Render' };
// every step name from before 1.28.0, so old links and saved places still land: Footage is Start, Look (and its two
// older names Style and Reference) is Picture, Finish is Review and Post is a view of Render
export const STEP_ALIAS = { footage: 'start', look: 'picture', style: 'picture', reference: 'picture', finish: 'review', post: 'render' };
export const stepOf = st => STEP_ALIAS[st] || st;
export const stepName = st => STEP_LABEL[stepOf(st)] || String(st || '');
// a step with a second view: Picture has the reference breakdown, Render has Post
export const viewOf = st => (st === 'reference' ? 'reference' : st === 'post' ? 'post' : st === 'style' || st === 'look' || st === 'picture' ? 'main' : st === 'render' ? 'main' : null);
// which step shows each of the 9 layers (kit/studio/categories.json layers), in the order the step shows them
export const STEP_LAYERS = { picture: ['color', 'motion', 'transitions', 'layout'], text: ['text', 'fonts', 'graphics'], broll: ['broll'], music: ['audio'] };
export const LAYER_STEP = Object.fromEntries(Object.entries(STEP_LAYERS).flatMap(([st, ls]) => ls.map(l => [l, st])));
// names a link may use for a layer that the catalog does not: #menu=music is the audio layer
export const LAYER_ALIAS = { music: 'audio', sound: 'audio', sounds: 'audio', sfx: 'audio', colour: 'color' };
// the layer a #menu= name means: a layer id, an alias, or an old tab name (a group inside a layer)
export function layerOf(name, layers) {
  const id = LAYER_ALIAS[name] || name;
  if (LAYER_STEP[id]) return id;
  const l = (layers || []).find(x => x.id === id || (x.groups || []).some(g => g.id === id));
  return l ? l.id : null;
}
// the step a #menu= name opens; a name nothing owns opens Picture, as the old Look step did
export const menuStep = (name, layers) => LAYER_STEP[layerOf(name, layers)] || 'picture';
// the layer names the page shows (the catalog still calls the audio layer Music and SFX)
export const LAYER_LABEL = { audio: 'Music and sounds' };
// where the Your edit line's next action goes: the server still says finish for both Draft it and Render
export const nextStep = next => (!next || !next.step ? null : next.step === 'finish' ? (/^render/i.test(next.label || '') ? 'render' : 'review') : stepOf(next.step));
// how close the draft is to the reference, one word per part (build/match.json, values 0 to 1; null is not measured)
export const MATCH_PARTS = [['framing', 'Framing'], ['grade', 'Color'], ['captions', 'Captions'], ['stickers', 'Graphics'], ['sfx', 'Sounds'], ['pace', 'Pace']];
export const matchWord = v => (v >= 0.9 ? 'Matched' : v >= 0.7 ? 'Close' : 'Off');
export const matchChips = m => (m && typeof m === 'object' ? MATCH_PARTS.filter(([k]) => typeof m[k] === 'number' && isFinite(m[k])).map(([k, label]) => ({ id: k, label, word: matchWord(m[k]) })) : []);
