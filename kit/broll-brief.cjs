// The brief: what a B-roll slot should show, in one small record (docs/specs/broll-sourcing.md, section 1).
//   { subject, why, line, named, shot, motion, seconds, frame, reference?, avoid, serves, by }
// rules() makes it from the words under the slot first (the things named in them: your glossary and brands, common
// tools, sites, numbers, then plain nouns), with the reference cutaway as a hint for the kind of shot, never for the
// subject. An agent may rewrite subject, shot and why (merge); the rules are what you get with no agent and no key.
// The card reads text(brief): "Show X. Y."
'use strict';

const SHOTS = ['screen recording', 'product', 'hands', 'place', 'person', 'graphic'];
const AVOID = ['faces of other people', 'logos we have not confirmed'];
// tools and apps people name on camera; a line that names one gets a screen recording of it
const TOOLS = ('ChatGPT Claude Gemini Copilot Perplexity Midjourney Sora Notion Figma Canva GitHub Google YouTube Instagram TikTok LinkedIn Facebook Twitter Slack Discord Zapier Shopify Stripe Excel Sheets Docs ' +
  'Cursor Codex Photoshop Premiere CapCut Zoom Airtable Trello Asana HubSpot Salesforce WordPress Webflow Substack Spotify Gmail Outlook Calendly Loom Descript ElevenLabs HeyGen Buffer Skool Whop Gumroad Etsy Amazon').split(' ');
const STOP = new Set(('the a an and or but so of to in on at for with by from is are was were be been it its this that these those i you we they he she my your our their me us them just really very like about into than then there here ' +
  'what when where which who how all any some more most much can will would could should do does did have has had get got going gonna not no yes one two three because if first next last also even still only ' +
  'make made makes want wants know think need needs said says tell told start started build built show shows take took give gave keep kept thing things people time work works look looks feel right good best great ' +
  'actually literally every never always something someone everything nothing gives open opens then now each over under after before happen happens today come comes found tried went goes').split(' '));
const PLACE = /\b(office|desk|city|street|home|house|kitchen|room|studio|outside|beach|mountain|store|shop|gym|cafe|coffee|airport|car|road|park|warehouse|stage)\b/i;
const HANDS = /\b(writ(e|es|ing) (it )?down|hold(s|ing)?|hands?|keyboard|notebook|pen|unbox(es|ing)?)\b/i;
// words that mean a screen: the thing is on a computer or a phone
const SCREEN = /\b(dashboard|screen|app|website|site|browser|tab|page|click(s|ing)?|typ(e|es|ing)|scroll(s|ing)?|prompt|settings|inbox|spreadsheet|code|terminal|repo|plugin|login|sign up|search(es|ing)?|download(s|ing)?|upload(s|ing)?)\b/i;
const PERSON = /\b(team|customers?|clients?|friend|founder|coach|audience|crowd|kids|family|wife|husband|boss|employees?)\b/i;
const PRODUCT = /\b(product|package|box|bottle|device|gadget|course|book|merch|shirt|hoodie|unboxing)\b/i;

const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const uniq = a => [...new Map(a.filter(Boolean).map(x => [String(x).toLowerCase(), String(x)])).values()];
const lower = s => String(s || '').toLowerCase();
const wordsOf = t => lower(t).replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).map(w => w.replace(/'s$|'/g, '')).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
// the plain things a line talks about, in the order said: what follows "the", "my", "a" and the like ("my desk",
// "a second monitor"), since that is nearly always a thing you could show. With none, its longest words.
const DET = new Set('the a an my your our their his her this that these those one every each some any another'.split(' '));
function nouns(text, n = 2) {
  const raw = lower(text).replace(/[^a-z0-9'.,!? ]+/g, ' ').split(/\s+/).filter(Boolean), out = [];
  for (let i = 0; i < raw.length; i++) {
    if (!DET.has(raw[i])) continue;
    const ph = []; let j = i + 1;
    for (; j < raw.length && ph.length < 2; j++) { const w = raw[j].replace(/'s$|[^a-z0-9]/g, ''); if (!w || STOP.has(w) || DET.has(w) || /^\d+$/.test(w) || w.length < 3) break; ph.push(w); if (/[.,!?]$/.test(raw[j])) break; }
    if (ph.length) out.push(ph.join(' ')); i = j - 1;
  }
  if (out.length) return [...new Set(out)].slice(0, n);
  const ws = wordsOf(text).filter(w => w.length > 3 && !/(ing|ly)$/.test(w)), seen = new Map();
  ws.forEach((w, i) => { if (!seen.has(w)) seen.set(w, i); });
  return [...seen.keys()].sort((a, b) => b.length - a.length).slice(0, n).sort((a, b) => seen.get(a) - seen.get(b));
}
// the things a line names: your own words first, then common tools, sites, names written like OmniRoute, numbers
function namedIn(line, { glossary = [], brands = [] } = {}) {
  const t = String(line || ''), own = uniq([...glossary, ...brands].map(x => (x && (x.say || x.word || x.name)) || x).filter(x => typeof x === 'string' && x.trim().length > 1));
  const has = w => new RegExp('(^|[^A-Za-z0-9])' + esc(w) + '($|[^A-Za-z0-9])', 'i').test(t);
  const tools = [...own.filter(has), ...TOOLS.filter(has)];
  const sites = (t.match(/\b(?:[a-z0-9-]+\.)+(?:com|io|ai|app|co|dev|org|net|xyz|so)\b/gi) || []);
  // a name written with a capital inside it (OmniRoute, iPhone), or a capital word that does not start a sentence
  const caps = (t.match(/\b[A-Za-z]+[a-z][A-Z][A-Za-z]*\b/g) || []).concat((t.match(/[a-z,] ([A-Z][a-z]{2,})\b/g) || []).map(m => m.slice(2))).filter(w => !STOP.has(lower(w)) && w !== 'I');
  const nums = (t.match(/\$?\b\d[\d,.]*\s?(?:%|percent|k\b|x\b|million|thousand)?/gi) || []).map(s => s.trim()).filter(s => /\d/.test(s));
  return { tools: uniq(tools), sites: uniq(sites), names: uniq(caps).filter(c => !tools.some(x => lower(x) === lower(c))), numbers: uniq(nums) };
}
function shotOf(line, nm, slot) {
  if (nm.tools.length || nm.sites.length) return 'screen recording';
  if (nm.numbers.length && !nm.names.length) return 'graphic';
  const ref = SHOTS.includes(lower(slot.shot)) ? lower(slot.shot) : null;
  // the reference's own subject was a screen, ours may not be: only keep its shot when our words do not say otherwise
  return HANDS.test(line) ? 'hands' : SCREEN.test(line) ? 'screen recording' : PRODUCT.test(line) ? 'product' : PLACE.test(line) ? 'place' : PERSON.test(line) ? 'person' : ref || (slot.kind === 'panel' ? 'screen recording' : 'place');
}
function rules(slot, ctx = {}) {
  const line = String(slot.line || '').trim(), nm = namedIn(line, ctx), shot = shotOf(line, nm, slot), ns = nouns(line);
  const first = nm.tools[0] || nm.names[0];
  let subject, why;
  if (nm.sites.length) { subject = `the page at ${nm.sites[0]}`; why = 'You name it in this line.'; }
  else if (first) { subject = shot === 'screen recording' ? `${first} on screen` : first; why = 'You name it in this line.'; }
  else if (nm.numbers.length) { subject = `the number ${nm.numbers[0]} on screen`; why = 'You say a number here.'; }
  else if (ns.length) { subject = shot === 'screen recording' ? `the ${ns.join(' and ')} on screen` : `the ${ns.join(' and the ')}`; why = 'It fits what you say here.'; }
  else if (slot.what) { subject = String(slot.what); why = slot.ref ? 'The reference showed this here.' : 'The plan asks for it here.'; }
  else { subject = `a ${shot}`; why = slot.ref ? 'The reference cuts to B-roll here.' : 'The look has B-roll here.'; }
  // the point of the video breaks ties: a slot on a line that serves it gets the stronger suggestion (it picks first)
  const pw = new Set(wordsOf(ctx.point)), serves = pw.size > 0 && wordsOf(line).some(w => pw.has(w));
  const fx = slot.fx || {};
  return { subject, why, line, named: uniq([...nm.tools, ...nm.sites, ...nm.names, ...nm.numbers]), shot, motion: fx.motion || 'still',
    seconds: +((+slot.end - +slot.start || 0) + 1).toFixed(2), frame: slot.kind === 'full' ? 'upright 9:16' : 'wide 16:9',
    ...(slot.ref ? { reference: { showed: slot.what || null, shot: slot.shot || null, source: slot.source || null } } : {}), avoid: AVOID.slice(), ...(serves ? { serves: true } : {}), by: 'rules' };
}
const one = (t, n) => String(t == null ? '' : t).replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);
// a rewrite on top of a brief: only subject, shot and why change; the rest stays what the slot is
function merge(brief, p = {}, by = 'your agent') {
  const out = { ...brief };
  if (p.subject != null) { const s = one(p.subject, 120); if (!s) throw Object.assign(new Error('subject: what the slot should show, in one plain line'), { code: 400 }); out.subject = s; }
  if (p.shot != null) { if (!SHOTS.includes(lower(p.shot))) throw Object.assign(new Error(`shot: ${SHOTS.join(', ')}`), { code: 400 }); out.shot = lower(p.shot); }
  if (p.why != null) out.why = one(p.why, 160);
  if (Array.isArray(p.named)) out.named = uniq(p.named.map(x => one(x, 40))).slice(0, 8);
  out.by = by; return out;
}
// the brief of a slot: the one kept in the plan when someone rewrote it, else the rules with what Studio knows now
const of = (slot, ctx) => (slot.brief && slot.brief.by && slot.brief.by !== 'rules' ? { ...rules(slot, ctx), ...slot.brief } : rules(slot, ctx));
const text = b => { const s = String(b.subject || '').replace(/[.!?]+$/, ''), w = String(b.why || '').replace(/[.!?]+$/, ''); return `Show ${s}.${w ? ' ' + w.charAt(0).toUpperCase() + w.slice(1) + '.' : ''}`; };
// the words a source searches with: the named things first, then the subject's own words
const subjectWords = b => uniq(wordsOf(b.subject).filter(w => !['screen', 'page', 'number'].includes(w)));
const query = b => { const n = (b.named || []).filter(x => !/^\$?\d/.test(x)); return (n.length ? n : subjectWords(b)).join(' '); };

module.exports = { SHOTS, TOOLS, rules, merge, of, text, query, subjectWords, namedIn, nouns, wordsOf };
