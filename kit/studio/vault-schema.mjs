// The input schemas of the Vault and brief tools, in one place: kit/mcp.mjs lists them as each tool's inputSchema and
// checks the arguments against them, and Studio's own routes (kit/studio/vault-api.mjs) check the same bodies, so the
// two can never drift. check() covers what these schemas use: required, type, enum, arrays of strings, no extra keys.
const str = description => ({ type: 'string', description }), port = { type: 'number', description: 'the Studio port (default 4757)' };
const KINDS = ['video', 'image', 'page', 'screen'], FROM = ['uploaded', 'links', 'stock', 'made'], RIGHTS = ['mine', 'licensed', 'public-page', 'reference'];
const SHOTS = ['screen recording', 'product', 'hands', 'place', 'person', 'graphic'];
const meta = {
  mine: { type: 'boolean', description: 'true only when the user said this is their own. A link to someone else\'s video or post is saved as reference only and is never placed in a reel.' },
  title: str('a short name for it'), tags: { type: 'array', items: { type: 'string' }, description: 'plain words to find it by' },
  brand: { type: 'array', items: { type: 'string' }, description: 'the brand or product it shows (one Vault, a brand tag on each item)' }, description: str('one plain line about what it shows'),
};
export const SCHEMAS = {
  add_to_vault: { type: 'object', properties: { file: str('a video or a picture on this computer (a path)'), link: str('a public web address the user gave or confirmed'), ...meta, port }, additionalProperties: false },
  capture_link: { type: 'object', properties: { link: str('a public web address the user confirmed'), ...meta, slot: { type: 'number', description: 'a B-roll slot number from list_broll (need.slot): also offer the capture on that slot, for the user to say yes' }, port }, required: ['link'], additionalProperties: false },
  search_vault: { type: 'object', properties: { q: str('plain words: names, tags, brands, page titles and the text a capture found'), kind: { type: 'string', enum: KINDS }, source: { type: 'string', enum: FROM }, tag: str('one tag or brand'), used: { type: 'boolean', description: 'true: used in a reel, false: not used yet' }, rights: { type: 'string', enum: RIGHTS },
    slot: { type: 'number', description: 'a B-roll slot number: rank the Vault for that slot\'s brief, each with its reason' }, limit: { type: 'number' }, port }, additionalProperties: false },
  set_broll_brief: { type: 'object', properties: { slot: { type: 'number', description: 'the B-roll slot number (need.slot or brief.slot in list_broll)' }, subject: str('what the slot should show, in one plain line'), shot: { type: 'string', enum: SHOTS }, why: str('the reason, shown to the user'), port }, required: ['slot'], additionalProperties: false },
};
const typeOf = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
// throws a plain error (code 400) naming the first thing wrong; returns the arguments when they fit
export function check(name, a) {
  const sc = SCHEMAS[name], bad = m => Object.assign(new Error(`${name}: ${m}`), { code: 400 });
  if (!sc) throw bad('no such schema');
  if (typeOf(a) !== 'object') throw bad('give an object');
  for (const k of sc.required || []) if (a[k] == null || a[k] === '') throw bad(`${k} is needed`);
  for (const [k, v] of Object.entries(a)) {
    const p = sc.properties[k]; if (!p) throw bad(`unknown option ${k} (${Object.keys(sc.properties).join(', ')})`);
    if (v == null) continue;
    if (typeOf(v) !== p.type || (p.type === 'number' && !Number.isFinite(v))) throw bad(`${k} must be ${p.type === 'array' ? 'a list' : /^[aeiou]/.test(p.type) ? 'an ' + p.type : 'a ' + p.type}`);
    if (p.enum && !p.enum.includes(v)) throw bad(`${k} must be one of: ${p.enum.join(', ')}`);
    if (p.type === 'array' && v.some(x => typeof x !== p.items.type)) throw bad(`${k} must be a list of ${p.items.type}s`);
  }
  return a;
}
// a query string as the arguments of a schema (numbers and true or false arrive as text)
export function fromQuery(name, params) {
  const sc = SCHEMAS[name], out = {};
  for (const [k, v] of params) { const p = sc.properties[k]; if (v === '') continue; out[k] = !p ? v : p.type === 'number' ? +v : p.type === 'boolean' ? (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v) : p.type === 'array' ? v.split(',').map(x => x.trim()).filter(Boolean) : v; }
  return out;
}
