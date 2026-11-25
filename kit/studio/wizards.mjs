// The wizards (1.17.0): guided starts that set what the steps would. The page no longer shows them (Phase 7: the
// builder asks one thing per screen); POST /api/wizard and MCP run_wizard still use these, and a goal also sets the
// builder plan: its pace and one line in Your notes (the same lines the Your notes step offers as examples).
export const GOALS = {
  grow: { label: 'Grow followers', sub: 'One short reel, hook first', pace: 'lively', note: 'Hook in the first line, short and punchy.', out: { format: 'short', kind: 'full', length: 'short', goal: 'organic' } },
  sell: { label: 'Sell or sign up', sub: 'Short, with 15 s and 30 s ad cuts', pace: 'high', note: 'End with one clear ask: follow, sign up or buy.', out: { format: 'short', kind: 'full', length: 'short', goal: 'ad', adCuts: true } },
  teach: { label: 'Teach one thing', sub: 'A little longer, every step kept', pace: 'steady', note: 'Keep every step in, in order. Clear over fast.', out: { format: 'short', kind: 'full', length: 'medium', goal: 'organic' } },
  clean: { label: 'Full clean take', sub: 'Everything, retakes and fillers out', pace: 'calm', note: 'Keep the whole take, only retakes and fillers out.', out: { format: 'long', kind: 'full', length: 'long', goal: 'organic' } },
};
export const WIZARDS = {
  reel: { title: 'Make a reel from a long take', sub: 'Pick the goal and a Look; AI picks the lines; you check it in Review.' },
  reference: { title: 'Copy a reference', sub: 'Paste a reel you like; Studio borrows its look.' },
  clips: { title: 'Clips and ads from one take', sub: 'Several short clips, plus ad cuts if you sell.' },
};
export const CLIP_COUNTS = [3, 5, 8];
// the example lines on Your notes, one per goal, in goal order
export const NOTE_LINES = Object.values(GOALS).map(g => g.note);
// what a wizard call asks for, checked: { errs, wizard, goal, look, choose, clips, ads, url }
export function plan(b = {}, packs = []) {
  const errs = [], w = b.wizard;
  if (!WIZARDS[w]) errs.push(`wizard: ${Object.keys(WIZARDS).join(', ')}`);
  const out = { errs, wizard: w };
  if (w === 'reel') {
    if (b.goal != null) { if (!GOALS[b.goal]) errs.push(`goal: ${Object.keys(GOALS).join(', ')}`); else out.goal = b.goal; }
    if (b.look != null) { if (!packs.includes(b.look)) errs.push(`look: no Look named ${b.look}`); else out.look = b.look; }
    out.choose = b.choose === true;
    if (out.goal == null && out.look == null && !out.choose) errs.push('reel: give a goal, a look or choose: true');
  }
  if (w === 'clips') { const n = b.clips == null ? 5 : +b.clips; if (!Number.isInteger(n) || n < 1 || n > 12) errs.push('clips: 1 to 12'); out.clips = n; out.ads = b.ads === true; }
  if (w === 'reference') { const u = String(b.url || '').trim(); if (!/^https?:\/\/\S+$/.test(u)) errs.push('url: a link to the reel'); out.url = u; }
  return out;
}
export function clipsOutput(n, ads) { return { format: 'short', kind: 'clips', clips: n, clipLength: 'short', goal: ads ? 'ad' : 'organic', adCuts: !!ads }; }
