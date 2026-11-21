// Studio's b-roll routes and state (kit/studio/server.mjs mounts them). The session keeps, per job:
//   s.broll[job] = { slots: { <spot n>: { clip, place, offset, dur, in, at, by } }, ideas: { <spot n>: { idea, why, query, clip,
//     card, place, offset, role, source, by } }, asks: [{ id, provider, kind, prompt, seconds, aspect, beat, estimate, by }],
//     gens: [{ id, status, ... }], marks: [seconds] (Add a spot), raws: [{ id, name, type, status, pieces }] (raw uploads
//     being cut), cutins: [{ clip, after }] (testimonial pieces played with their own sound, in the Combo) }
// Spots come from the job's draft (build/cut.json and build/captions.js, kit/studio/lane.mjs spots). The API still calls
// a spot a beat (beat: n), so agents that know fill_slot keep working. Library clips live in kit/studio/broll.mjs.
import { createWriteStream, existsSync, readFileSync, rmSync, renameSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import * as KEYS from './keys.mjs';
import * as BR from './broll.mjs';
import * as LANE from './lane.mjs';
import * as GEN from './gen.mjs';
import * as MAKE from './broll-make.mjs';
import * as S from './settings.mjs';
import * as CUT from './cut.mjs';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';

const bad = (m, code = 400, extra) => Object.assign(new Error(m), { code }, extra || {});
const clean = t => String(t == null ? '' : t).replace(/\u2014/g, ', ').slice(0, 300);

export const TYPES = { testimonial: 'Testimonial', 'product-demo': 'Product demo', 'screen-recording': 'Screen recording', lifestyle: 'Lifestyle' };
// what each spot role likes to show, from your library first
const ROLE_TYPES = { proof: ['testimonial', 'product-demo'], tip: ['screen-recording', 'product-demo'], story: ['lifestyle'], other: ['lifestyle'] };

export function mount({ ROOT, C, update, json, readBody, serveFile, CH, capturePage, chromeOk, refParts = () => [], transcribe = null, wordsOf = () => null, energyOf = async () => null }) {
  const jobState = (s, job = s.job) => { s.broll = s.broll || {}; const b = s.broll[job] = s.broll[job] || {}; b.slots = b.slots || {}; b.ideas = b.ideas || {}; b.asks = b.asks || []; b.gens = b.gens || []; b.marks = b.marks || []; b.raws = b.raws || []; b.cutins = b.cutins || []; return b; };
  const peek = (s, job = s.job) => ({ slots: {}, ideas: {}, asks: [], gens: [], marks: [], raws: [], cutins: [], ...(((s.broll || {})[job]) || {}) });
  function draftOf(job, s = C.load()) {
    // leftover jobs/<job>/build from a previous edit must not drive the timeline once the footage changed
    if (job === s.job && !C.draftIsCurrent(s)) return null;
    const b = join(ROOT, 'jobs', String(job || '-'), 'build'); let cut = null, caps = null;
    try { cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8')); } catch { return null; }
    try { const g = {}; new Function('window', readFileSync(join(b, 'captions.js'), 'utf8'))(g); caps = g.CAPTIONS; } catch {}
    const base = LANE.beats(cut, caps), len = base.length ? base[base.length - 1].end : 0;
    let refs = []; try { refs = (refParts(s, cut, job) || []).map(r => ({ ...r, at: r.frac != null ? +r.frac * len : +r.at, ...(r.fracLen != null ? { seconds: +(r.fracLen * len).toFixed(2) } : {}) })).filter(r => r.at >= 0 && r.at < len); } catch {}
    const j = peek(s, job);
    return { cut, caps, beats: LANE.spots(cut, caps, { marks: j.marks, refs }), len };
  }
  const clipBrief = c => c && { id: c.id, name: c.name, source: c.source, kind: c.kind, type: c.type || null, raw: c.raw ? { text: c.raw.text, seconds: c.raw.seconds } : null, seconds: c.seconds, width: c.width, height: c.height, tags: c.tags, license: c.license, author: c.author, sourceUrl: c.sourceUrl,
    thumb: c.thumb ? `/api/broll/file?id=${c.id}&thumb=1` : null, url: `/api/broll/file?id=${c.id}`, provider: c.provider || null, prompt: c.prompt || null };
  function sources(env = process.env) {
    const st = S.load(), k = Object.fromEntries(KEYS.status(env).map(x => [x.id, x.set])), gen = GEN.PROVIDERS.filter(id => k[id]);
    return [
      { id: 'upload', name: 'Upload', on: true }, { id: 'library', name: 'Library', on: true, note: BR.libDir() },
      { id: 'pexels', name: 'Pexels', on: !!k.pexels, note: k.pexels ? 'your key' : 'optional, add a free key' }, { id: 'pixabay', name: 'Pixabay', on: !!k.pixabay, note: k.pixabay ? 'your key' : 'optional, add a free key' },
      { id: 'agent', name: 'Agent-made', on: chromeOk(), note: chromeOk() ? 'charts, counters, quotes, code, terminal, HTML scenes' : 'needs Chrome' },
      { id: 'screen', name: 'Screen recording', on: true, note: 'in this browser' }, { id: 'capture', name: 'Web capture', on: chromeOk(), note: 'public pages' },
      { id: 'generate', name: 'Generate', on: !!(st.broll.generate && gen.length), note: !st.broll.generate ? 'off (Settings)' : gen.length ? gen.map(id => KEYS.byId(id).name).join(', ') : 'add a provider key' },
    ];
  }
  function view(s, job = s.job) {
    const d = job ? draftOf(job, s) : null, b = peek(s, job), lib = BR.load().clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
    const beats = d ? d.beats.map(bt => { const sl = b.slots[bt.n], c = sl && byId[sl.clip]; return { ...bt, slot: sl && c ? { ...sl, ...LANE.timing(sl, bt, c), clip: clipBrief(c) } : null, idea: b.ideas[bt.n] ? { ...b.ideas[bt.n], clip: b.ideas[bt.n].clip ? clipBrief(byId[b.ideas[bt.n].clip]) : null } : null }; }) : [];
    const st = S.load();
    return { job, draft: !!d, beats, length: d ? d.len : 0, asks: b.asks, gens: b.gens.slice(-8), sources: sources(), library: { dir: BR.libDir(), count: lib.length },
      generate: { on: !!st.broll.generate, providers: GEN.list(st) }, places: LANE.PLACE_LABEL, auto: autoOn(), types: TYPES, card: chromeOk(),
      raws: b.raws.slice(-6), cutins: b.cutins.map(x => ({ ...x, clip: clipBrief(byId[x.clip]) })).filter(x => x.clip), testimonials: lib.filter(c => c.type === 'testimonial' && c.raw).slice(0, 24).map(clipBrief),
      undo: !!(b.undo && b.undo.slots) };
  }
  // the render step's plan: every filled slot as an insert, and the credits
  function plan(s) {
    const d = draftOf(s.job, s); if (!d) return null; const b = peek(s), lib = BR.load().clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
    const ins = LANE.inserts(b.slots, d.beats, id => byId[id], c => BR.pathOf(c));
    const used = [...new Set(ins.map(x => x.clip))].map(id => byId[id]);
    for (const c of used) BR.update(c.id, { usedIn: s.job });
    return { inserts: ins, credits: used.length ? BR.credits(used, s.job) : '' };
  }
  const beatOk = (s, n) => { const d = draftOf(s.job, s); if (!d) throw bad('make a draft first: the beats come from it'); const bt = d.beats.find(x => x.n === +n); if (!bt) throw bad(`no beat ${n} (the draft has ${d.beats.length})`); return bt; };
  function fill(s0, n, clipId, o = {}) {
    const bt = beatOk(s0, n); if (clipId && !BR.get(clipId)) throw bad(`no b-roll ${clipId}`, 404);
    return update(s => { const b = jobState(s);
      if (!clipId) { delete b.slots[n]; return; }
      const prev = b.slots[n] || {}, place = LANE.PLACES.includes(o.place) ? o.place : prev.place || 'full';
      b.slots[n] = { clip: clipId, place, offset: o.offset != null ? +o.offset : prev.clip === clipId ? prev.offset : null, dur: o.dur != null ? +o.dur : prev.clip === clipId ? prev.dur : null, in: o.in != null ? Math.max(0, +o.in) : prev.clip === clipId ? prev.in || 0 : 0, by: o.by || 'you', why: o.why ? clean(o.why) : prev.clip === clipId ? prev.why || null : null };
      b.slots[n].at = +(bt.start + (b.slots[n].offset != null ? b.slots[n].offset : 0.2)).toFixed(2);
      delete b.ideas[n];
      if (o.by && o.by !== 'you' && !o.quiet) C.applyPatch(s, { reply: `${o.by} put ${BR.get(clipId).name} on spot ${n} (${LANE.PLACE_LABEL[place].toLowerCase()}).`, from: 'assistant', kind: 'action' });
    });
  }
  // ---------- the rules: what to show on each spot, picked from what you said ----------
  // one idea every 6 to 10 s (closer when the reference cuts to b-roll there), the first spot too (after the first
  // 1.2 s, so the hook shows your face). Library first: a clip whose name or tags match the spot's nouns, else one of
  // your uploads of the kind the spot likes (testimonials and product demos on proof, screen recordings on tips).
  // Numbers and quotes become a made card; everything else a stock search.
  const autoOn = () => { const a = S.load().broll.auto; return a == null ? process.env.STUDIO_BROLL_AUTO !== '0' : a === true; };
  function pickIdeas(s, { gap = 6, all = false } = {}) {
    const d = draftOf(s.job, s); if (!d) throw bad('make a draft first: the spots come from it'); const j = peek(s), lib = BR.load().clips;
    const used = new Set(Object.values(j.slots).map(x => x.clip)), taken = Object.entries(j.slots).map(([n, x]) => x.at != null ? +x.at : (d.beats.find(b => b.n === +n) || {}).start).filter(x => x != null);
    const out = [];
    for (const bt of d.beats) {
      if (j.slots[bt.n] || bt.seconds < 1.2) continue;
      const p = LANE.pick(bt); if (!p && !bt.ref) continue;
      const offset = LANE.offsetFor(bt, p && p.word, d.caps), at = bt.start + offset;
      if (!all && !bt.ref && [...taken, ...out.map(x => x.at)].some(t => Math.abs(t - at) < gap)) continue;
      const role = p ? p.role : 'other', want = ROLE_TYPES[role] || [];
      // library first: the clip that best matches the spot's nouns (then its words), before any stock
      // a reference cutaway says what it showed (Reel.md shot broll): that is the search, before your words
      const what = bt.ref && bt.ref.what ? String(bt.ref.what) : null, wq = what ? (LANE.nounQuery(what) || what) : null;
      let hit = wq ? (BR.rank(wq + ' ' + what, { exclude: used }).find(c => c.matched >= 1) || null) : null;
      if (!hit) hit = p && p.query ? (BR.rank(p.query, { exclude: used })[0] || null) : null;
      if (!hit && bt.text) { const r = BR.rank(LANE.nounQuery(bt.text) + ' ' + bt.text, { exclude: used }).find(c => c.matched >= 2); if (r) hit = r; }
      if (!hit && want.length) hit = lib.find(c => want.includes(c.type) && !used.has(c.id) && !(c.raw && c.type === 'testimonial' && j.cutins.some(x => x.clip === c.id))) || null;
      if (hit) used.add(hit.id);
      const place = hit && hit.type === 'screen-recording' ? 'top' : hit && hit.type === 'testimonial' ? 'pip' : 'full';
      // a tip about a tool, an app or a screen: a screen recording of it first, then stock
      const screen = !hit && !(p && p.card) && role === 'tip' && p && p.query;
      const rscreen = !hit && what && /screen recording/i.test(what);
      const idea = hit ? `${hit.name} from your library` : what ? (rscreen ? `Screen recording: ${what.replace(/^a screen recording( of)?\s*/i, '') || wq}` : `Like the reference: ${what}`) : p && p.card ? p.idea : screen ? `Screen recording: ${p.query}` : p ? `Stock: ${p.query}` : 'B-roll like the reference';
      // as long as the reference's cutaway, scaled to your reel (within the spot)
      const dur = bt.ref && bt.ref.seconds ? +Math.max(1, Math.min(+bt.ref.seconds, bt.seconds - offset)).toFixed(2) : null;
      const why = bt.ref ? `The reference cuts to b-roll here${bt.ref.detail ? ` (${bt.ref.detail})` : ''}.${p && !what ? ' ' + p.why : ''}` : p.why;
      const why2 = screen ? `${why} Record your screen showing it (Screen recording in B-roll), or Approve for stock.` : why;
      out.push({ beat: bt.n, at: +at.toFixed(2), offset, ...(dur ? { dur } : {}), idea, why: why2, role, query: wq || (p && p.query ? p.query : null), card: !hit && !what && p && p.card ? p.card : null, clip: hit ? hit.id : null, place: screen || rscreen ? 'top' : place, ...(screen || rscreen ? { screen: true } : {}), source: bt.ref ? 'reference' : 'rules' });
    }
    return out;
  }
  function saveIdeas(ideas, by = 'the rules') { return update(st => { const jj = jobState(st); for (const x of ideas) jj.ideas[x.beat] = { idea: x.idea, why: x.why || null, query: x.query || null, clip: x.clip || null, card: x.card || null, place: x.place || null, offset: x.offset != null ? x.offset : null, ...(x.dur != null ? { dur: x.dur } : {}), role: x.role || null, source: x.source || null, by }; }); }
  // after every draft (when B-roll picks itself is on): ideas for the spots, and the ones Studio can fill for free go
  // straight on (a library clip, Pexels or Pixabay when you set a key, a made card when Chrome is here). Generating
  // never runs on its own, and a spot with only a search waits for you rather than getting a card of your own words. The page shows what was placed and why; Remove or swap any of it.
  let autoRun = Promise.resolve();
  function autoPick(job) {
    if (!autoOn()) return autoRun;
    autoRun = autoRun.then(async () => {
      const s = C.load(); if (s.job !== job || !draftOf(job, s)) return;
      const ideas = pickIdeas(s); if (!ideas.length) return; saveIdeas(ideas, 'Studio');
      let placed = 0;
      for (const x of ideas) { try { await approveIdea(C.load(), x.beat, 'Studio', { quiet: true, noFallback: true }); placed++; } catch {} }
      update(st => { if (st.job === job) C.applyPatch(st, { reply: `B-roll picked itself: ${placed} of ${ideas.length} spot${ideas.length === 1 ? '' : 's'} filled from what you said${placed < ideas.length ? ', the rest wait for Approve' : ''}. Swap or remove any on the B-roll step.`, from: 'assistant', kind: 'action' }); });
    }).catch(e => console.error('b-roll auto: ' + e.message));
    return autoRun;
  }
  async function makeCard(spec, extra = {}) {
    if (!chromeOk()) throw bad('Agent-made B-roll needs Chrome, and it is not installed.', 400, { fix: ['chrome'] });
    if (!MAKE.KINDS.includes(spec.kind)) throw bad(`kind: ${MAKE.KINDS.join(', ')}`);
    const r = await MAKE.make(spec);
    return BR.add(r.file, { move: true, name: `${spec.kind}-${randomBytes(2).toString('hex')}.mp4`, title: spec.title && spec.kind !== 'chart' ? String(spec.title) : MAKE.titleOf(spec), source: 'agent', tags: [spec.kind, ...(extra.tags || [])], ...extra });
  }
  async function captureClip(url) {
    if (!chromeOk()) throw bad('Web capture needs Chrome');
    const r = await capturePage(url, { scroll: 6, width: 720 });
    const f = join(r.dir, 'scroll.mp4'); if (!existsSync(f)) throw bad('the capture made no video');
    return BR.add(f, { name: 'capture.mp4', title: (r.title || url).slice(0, 70), source: 'capture', sourceUrl: url, tags: BR.words(url) });
  }
  // Approve: the idea's clip, else its card, else the library, else stock (with a key), else a card made from the
  // spot's words. A fresh install with no keys still gets b-roll: library clips and made cards need no account.
  async function approveIdea(s, n, by = 'you', o = {}) {
    const idea = peek(s).ideas[n]; if (!idea) throw bad(`no idea on spot ${n}`, 404);
    let clip = idea.clip && BR.get(idea.clip); const tried = [];
    if (!clip && idea.card && chromeOk()) clip = await makeCard(idea.card);
    if (!clip && idea.query) clip = BR.search(idea.query)[0] || null;
    if (!clip && idea.query) { const prov = ['pexels', 'pixabay'].find(p => KEYS.isSet(p));
      if (prov) { try { const res = await BR.searchStock(prov, { query: idea.query, orientation: idea.place === 'pip' ? 'landscape' : 'portrait' }); if (res.length) clip = await BR.downloadStock(prov, res[0]); else tried.push(`${KEYS.byId(prov).name} found nothing for "${idea.query}"`); } catch (e) { tried.push(e.message); } } }
    if (!clip && !o.noFallback && chromeOk()) { const bt = (draftOf(s.job, s) || { beats: [] }).beats.find(b => b.n === +n), text = idea.card && idea.card.text || (bt && bt.text) || idea.idea;
      clip = await makeCard(idea.card || { kind: 'quote', text: String(text).split(/\s+/).slice(0, 14).join(' ') }); }
    if (!clip) throw bad(`Nothing in the library${idea.query ? ` for "${idea.query}"` : ''}${tried.length ? ` (${tried.join('; ')})` : ''}. Install Chrome so Studio can make a card here, add a free Pexels key for stock, or fill the spot by hand.`, 400, { fix: chromeOk() ? null : ['chrome'] });
    return fill(C.load(), n, clip.id, { place: idea.place, offset: idea.offset != null ? idea.offset : undefined, dur: idea.dur != null ? idea.dur : undefined, by, quiet: o.quiet, why: idea.why });
  }
  function addAsk(s0, a) {
    const st = S.load(); GEN.check(a, st);
    return update(s => { const b = jobState(s), id = 'g' + randomBytes(3).toString('hex');
      b.asks.push({ id, provider: a.provider, kind: a.kind || null, prompt: clean(a.prompt), seconds: a.seconds || null, aspect: a.aspect || null, model: a.model || null, beat: a.beat != null ? +a.beat : null, place: a.place || null, estimate: a.estimate || null, by: a.by || 'your agent', at: Date.now() });
      if (a.by) C.applyPatch(s, { reply: `${a.by} asks to generate b-roll${a.beat != null ? ' for beat ' + a.beat : ''} with ${KEYS.byId(a.provider).name}: "${clean(a.prompt).slice(0, 90)}". Approve or decline it on the B-roll step.`, from: 'assistant', kind: 'action' });
      return id; });
  }
  function startGen(job, r, est) {
    const id = r.id || 'g' + randomBytes(3).toString('hex');
    update(s => { const b = jobState(s, job); b.asks = b.asks.filter(x => x.id !== id); b.gens.push({ id, provider: r.provider, kind: r.kind || null, prompt: clean(r.prompt), beat: r.beat ?? null, status: 'running', usd: est && est.usd != null ? est.usd : null, at: Date.now() }); });
    const set = p => update(s => { const g = jobState(s, job).gens.find(x => x.id === id); if (g) Object.assign(g, p); });
    GEN.run({ ...r, id }, S.load(), { onStatus: st => set({ phase: st }) }).then(out => {
      const c = BR.add(out.file, { move: true, name: `${out.provider}-${id}.mp4`, title: `Generated: ${out.prompt.slice(0, 50)}`, source: 'generate', provider: KEYS.byId(out.provider).name, model: out.model, prompt: out.prompt,
        license: { name: `Generated with ${KEYS.byId(out.provider).name} (${out.model}); see the provider's terms for use`, url: null }, tags: ['generated', ...BR.words(out.prompt)] });
      set({ status: 'done', clip: c.id, phase: null });
      const s = C.load(); if (r.beat != null && s.job === job) { try { fill(s, r.beat, c.id, { place: r.place, by: 'you' }); } catch {} }
    }).catch(e => set({ status: 'failed', error: KEYS.scrub(e.message, KEYS.get(r.provider)), phase: null }));
    return id;
  }
  // ---------- raw uploads: cut first, with the same cutter as your footage ----------
  // The file goes to inbox/studio/<job>/raw/, is transcribed, split into lines on the audio (kit/studio/cut.mjs lines:
  // every edge in the quiet next to its words, never mid-word) and grouped into pieces of 3 to 12 s; retakes and
  // fragments are left out. Each piece lands in the library tagged with its words and its kind. A raw clip with no
  // speech is split every 5 s. Testimonial pieces remember where they came from, so they can play in the Combo with
  // their own sound (POST /api/broll/cutin).
  const runNode = args => new Promise((ok, no) => { const p = spawn(process.execPath, args, { cwd: ROOT, env: process.env }); let e = ''; p.stderr.on('data', d => { e += d; }); p.on('error', no); p.on('close', c => (c ? no(new Error((e.trim().split('\n').pop() || 'cut failed').replace(/^error: /, ''))) : ok())); });
  const durOfFile = f => { try { const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); return +String(r.stdout || '').trim() || 0; } catch { return 0; } };
  function piecesOf(words, L, dur) {
    if (!words || !words.length || !L || !L.length) { const out = []; for (let a = 0; a + 1.5 < dur; a += 5) out.push({ ranges: [[+a.toFixed(2), +Math.min(dur, a + 5).toFixed(2)]], text: '' }); return out.slice(0, 40); }
    const keep = L.filter(l => l.hint !== 'retake' && l.hint !== 'fragment'), out = []; let cur = null;
    for (const l of keep) {
      if (cur && (l.n !== cur.last + 1 || cur.seconds + l.seconds > 12 || cur.seconds >= 3 && /[.?!]$/.test(cur.text) && cur.seconds >= 6)) { out.push(cur); cur = null; }
      if (!cur) cur = { ranges: [], text: '', seconds: 0, last: l.n - 1 };
      const r = cur.ranges[cur.ranges.length - 1]; if (r && cur.last + 1 === l.n) r[1] = l.end; else cur.ranges.push([l.start, l.end]);
      cur.text = (cur.text + ' ' + l.text).trim(); cur.seconds = +(cur.seconds + l.seconds).toFixed(2); cur.last = l.n;
    }
    if (cur) out.push(cur);
    return out.filter(x => x.seconds >= 1.5 || out.length === 1).slice(0, 40);
  }
  function startRaw(s0, tmp, name, type) {
    const id = 'r' + randomBytes(3).toString('hex'), job = s0.job || 'library', safe = String(name).replace(/[^\w.\-]+/g, '-').slice(-60);
    const rel = `inbox/studio/${job}/raw/${id}-${safe}`; mkdirSync(join(ROOT, `inbox/studio/${job}/raw`), { recursive: true });
    try { try { renameSync(tmp, join(ROOT, rel)); } catch { copyFileSync(tmp, join(ROOT, rel)); rmSync(tmp, { force: true }); } } catch (e) { throw bad('could not keep the upload: ' + e.message, 500); }
    const set = p => update(st => { const r = jobState(st, s0.job).raws.find(x => x.id === id); if (r) Object.assign(r, p); });
    update(st => { jobState(st, s0.job).raws.push({ id, name: String(name).slice(0, 80), type, status: 'transcribing', pieces: [], at: Date.now() }); });
    const cut = async () => {
      set({ status: 'cutting' });
      const words = wordsOf(rel), dur = durOfFile(join(ROOT, rel)), L = words && words.length ? CUT.lines(words, await energyOf(rel), dur) : null, ps = piecesOf(words, L, dur), made = [];
      for (const [k, x] of ps.entries()) {
        const out = join(tmpdir(), `raw-${id}-${k + 1}.mp4`);
        await runNode(['kit/studio/cut-run.mjs', 'extract', '--src', rel, '--ranges', x.ranges.map(r => r.join('-')).join(','), '--out', out]);
        const title = x.text ? x.text.split(/\s+/).slice(0, 7).join(' ') : `${TYPES[type]} ${k + 1}`;
        const c = BR.add(out, { move: true, name: `${safe.replace(/\.[^.]+$/, '')}-${k + 1}.mp4`, title, source: 'upload', type, tags: [type, 'raw-cut', ...BR.words(x.text).slice(0, 12)], raw: { src: rel, ranges: x.ranges, text: x.text.slice(0, 300), seconds: x.seconds || +x.ranges.reduce((a, [p, q]) => a + q - p, 0).toFixed(2), upload: id } });
        made.push(c.id); set({ pieces: [...made] });
      }
      set({ status: 'done', pieces: made });
      update(st => C.applyPatch(st, { reply: `Your ${TYPES[type].toLowerCase()} upload "${String(name).slice(0, 40)}" is cut into ${made.length} piece${made.length === 1 ? '' : 's'} in your library${words && words.length ? ', on whole words' : ''}.`, from: 'assistant', kind: 'action' }));
    };
    const fail = e => set({ status: 'failed', error: String(e.message || e).slice(0, 300), fix: e.fix ? [].concat(e.fix) : null });
    if (!transcribe) cut().catch(fail);
    else transcribe(rel, err => (err ? (type === 'testimonial' ? fail(err) : cut().catch(fail)) : cut().catch(fail)));
    return id;
  }
  const rawToFile = (req, max) => new Promise((ok, no) => { const f = join(tmpdir(), 'broll-up-' + randomBytes(4).toString('hex')); const w = createWriteStream(f); let n = 0;
    req.on('data', d => { n += d.length; if (n > max) { no(bad('file too big', 413)); req.destroy(); w.destroy(); rmSync(f, { force: true }); } }); req.pipe(w); w.on('finish', () => ok(f)); w.on('error', no); req.on('error', no); });

  const route = async (p, M, u, req, res) => (p.startsWith('/api/broll') || p.startsWith('/api/keys') ? (await handle(p, M, u, req, res)) !== false : false);
  async function handle(p, M, u, req, res) {
    const s = C.load(), q = k => u.searchParams.get(k);
    // ---------- API keys and providers: the page sees set or not and where from, never a value ----------
    if (p === '/api/keys' && M === 'GET') return json(res, 200, { keys: KEYS.status(), sources: sources(), generate: { on: !!S.load().broll.generate, providers: GEN.list(S.load()) }, file: KEYS.keysPath() });
    if (p === '/api/keys' && M === 'POST') { const b = await readBody(req); KEYS.save(String(b.id || ''), b.remove ? null : b.value); return json(res, 200, { keys: KEYS.status(), sources: sources() }); }
    if (p === '/api/keys/test' && M === 'POST') { const b = await readBody(req); const r = await KEYS.test(String(b.id || ''), b.value ? { value: KEYS.byId(b.id) && KEYS.byId(b.id).pair && typeof b.value === 'object' ? `${b.value.id}:${b.value.secret}` : String(b.value) } : {}); return json(res, 200, { ...r, keys: KEYS.status() }); }
    if (p === '/api/broll' && M === 'GET') return json(res, 200, view(s));
    if (p === '/api/broll/library' && M === 'GET') return json(res, 200, { dir: BR.libDir(), clips: BR.search(q('q') || '', { source: q('source') || null, kind: q('kind') || null }).map(clipBrief) });
    if (p === '/api/broll/file' && M === 'GET') { const c = BR.get(q('id')); if (!c) return json(res, 404, { error: 'not found' }); const f = q('thumb') ? c.thumb && join(BR.libDir(), c.thumb) : BR.pathOf(c); if (!f) return json(res, 404, { error: 'no thumbnail' }); return serveFile(req, res, f); }
    if (p === '/api/broll/upload' && M === 'POST') {
      const name = String(q('name') || 'clip.mp4'), source = q('source') === 'screen' ? 'screen' : 'upload', type = TYPES[q('type')] ? q('type') : source === 'screen' ? 'screen-recording' : null;
      if (!BR.VIDEO.test(name) && !BR.IMAGE.test(name)) return json(res, 400, { error: 'b-roll is a video (mp4, mov, webm, m4v, mkv) or a picture (jpg, png, webp)' });
      if (q('raw') === '1' && BR.VIDEO.test(name)) { const f = await rawToFile(req, 4e9); const id = startRaw(s, f, name, type || 'lifestyle'); return json(res, 202, { raw: id, broll: view(C.load()) }); }
      const f = await rawToFile(req, 2e9), c = BR.add(f, { move: true, name, source, title: q('title') || null, type, tags: type ? [type] : [] });
      const v = q('beat') ? fill(C.load(), +q('beat'), c.id, { place: q('place') }) : C.load();
      return json(res, 200, { clip: clipBrief(c), broll: view(v), ...{ state: v } });
    }
    if (p === '/api/broll/library' && M === 'POST') { const b = await readBody(req); const c = b.action === 'remove' ? BR.remove(b.id) : BR.update(b.id, b); if (b.action === 'remove') update(st => { for (const j of Object.values(st.broll || {})) for (const [n, sl] of Object.entries(j.slots || {})) if (sl.clip === b.id) delete j.slots[n]; }); return json(res, 200, { clip: clipBrief(c), broll: view(C.load()) }); }
    if (p === '/api/broll/stock' && M === 'GET') return json(res, 200, { provider: q('provider'), results: await BR.searchStock(q('provider'), { query: q('q'), orientation: q('orientation'), min: q('min') != null && q('min') !== '' ? +q('min') : null, max: q('max') != null && q('max') !== '' ? +q('max') : null, page: +(q('page') || 1) }) });
    if (p === '/api/broll/stock/add' && M === 'POST') { const b = await readBody(req); const c = await BR.downloadStock(b.provider, b.item); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/make' && M === 'POST') { const b = await readBody(req); const c = await makeCard(b.spec || {}); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/capture' && M === 'POST') { const b = await readBody(req); const c = await captureClip(String(b.url || '')); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place || 'pip', by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/clear' && M === 'POST') {
      const b = await readBody(req).catch(() => ({}));
      const v = update(st => {
        const j = jobState(st);
        if (b.undo) {
          if (!j.undo || !j.undo.slots) throw bad('nothing to undo');
          j.slots = { ...j.undo.slots }; delete j.undo; return;
        }
        if (!Object.keys(j.slots || {}).length) throw bad('no b-roll on the timeline to clear');
        j.undo = { slots: JSON.parse(JSON.stringify(j.slots)), at: Date.now() };
        j.slots = {};
      });
      return json(res, 200, { broll: view(v), state: v, note: b.undo ? 'B-roll is back on the timeline.' : 'Cleared b-roll from every spot. Undo puts it back. Library clips are unchanged.' });
    }
    if (p === '/api/broll/slot' && M === 'POST') {
      const b = await readBody(req);
      if (b.clear && (b.all || b.beat == null)) {
        const v = update(st => {
          const j = jobState(st);
          if (!Object.keys(j.slots || {}).length) throw bad('no b-roll on the timeline to clear');
          j.undo = { slots: JSON.parse(JSON.stringify(j.slots)), at: Date.now() };
          j.slots = {};
        });
        return json(res, 200, { broll: view(v), state: v, note: 'Cleared b-roll from every spot. Undo puts it back. Library clips are unchanged.' });
      }
      const v = fill(s, b.beat, b.clear ? null : b.clip || (peek(s).slots[b.beat] || {}).clip, { ...b, by: b.by ? CH.prettyName(String(b.by)) : 'you' }); return json(res, 200, { broll: view(v), state: v });
    }
    if (p === '/api/broll/ideas' && M === 'POST') {
      const b = await readBody(req), by = b.by ? CH.prettyName(String(b.by)) : 'the rules', d = draftOf(s.job); if (!d) throw bad('make a draft first: the beats come from it');
      if (!Array.isArray(b.ideas)) throw bad('ideas: [{ beat, idea, query or clip or card, place }]');
      for (const x of b.ideas) { beatOk(s, x.beat); if (x.clip && !BR.get(x.clip)) throw bad(`no b-roll ${x.clip}`); if (x.card) MAKE.html(x.card); if (x.place && !LANE.PLACES.includes(x.place)) throw bad(`place: ${LANE.PLACES.join(', ')}`); }
      const v = update(st => { const j = jobState(st); for (const x of b.ideas.slice(0, 60)) j.ideas[+x.beat] = { idea: clean(x.idea || x.query || (x.card && x.card.kind + ' card')), why: x.why ? clean(x.why) : null, query: x.query ? clean(x.query).slice(0, 80) : null, clip: x.clip || null, card: x.card || null, place: x.place || null, offset: x.offset != null && Number.isFinite(+x.offset) ? Math.max(0, +x.offset) : null, source: x.source || null, by };
        if (b.by) C.applyPatch(st, { reply: `${by} suggested b-roll for ${b.ideas.length} spot${b.ideas.length === 1 ? '' : 's'}. Approve or dismiss each on the B-roll step.`, from: 'assistant', kind: 'action' }); });
      return json(res, 200, { broll: view(v), state: v });
    }
    if (p === '/api/broll/suggest' && M === 'POST') {
      // Suggest b-roll again: the rules on every empty spot, one every gap seconds (6 by default; all: true for every
      // spot). fill: true also puts on what Studio can place for free, like after a draft
      const b = await readBody(req).catch(() => ({})), ideas = pickIdeas(s, { gap: b.gap != null ? Math.max(1, +b.gap) : 6, all: b.all === true });
      let v = saveIdeas(ideas);
      if (b.fill === true) { for (const x of ideas) { try { await approveIdea(C.load(), x.beat, 'Studio', { quiet: true }); } catch {} } v = C.load(); }
      return json(res, 200, { broll: view(v), count: ideas.length, state: v });
    }
    if (p === '/api/broll/auto' && M === 'POST') { const b = await readBody(req); if (typeof b.on !== 'boolean') throw bad('on: true or false'); S.update({ broll: { auto: b.on } }); return json(res, 200, { broll: view(C.load()) }); }
    // Add a spot (a split at a time of the reel) or remove one you added; slots and ideas stay on their moment
    if (p === '/api/broll/spot' && M === 'POST') {
      const b = await readBody(req), d = draftOf(s.job, s); if (!d) throw bad('make a draft first: the spots come from it');
      const t = +b.at; if (!Number.isFinite(t) || t <= 0 || t >= d.len) throw bad(`at: seconds into the reel, between 0 and ${d.len.toFixed(1)}`);
      const v = update(st => { const j = jobState(st), before = draftOf(st.job, st).beats;
        j.marks = b.remove ? j.marks.filter(x => Math.abs(x - t) > 1.6) : [...j.marks.filter(x => Math.abs(x - t) > 0.5), +t.toFixed(2)].sort((x, y) => x - y).slice(0, 60);
        const after = LANE.spots(d.cut, d.caps, { marks: j.marks, refs: (refParts(st, d.cut) || []).map(r => ({ ...r, at: r.frac != null ? +r.frac * d.len : +r.at, ...(r.fracLen != null ? { seconds: +(r.fracLen * d.len).toFixed(2) } : {}) })) });
        j.slots = LANE.remap(j.slots, before, after); j.ideas = LANE.remap(j.ideas, before, after); });
      return json(res, 200, { broll: view(v), state: v });
    }
    // testimonial pieces in the Combo: they play with their own sound, after the piece you pick (after: piece id, or
    // null for before your last piece). Draft again to hear them.
    if (p === '/api/broll/cutin' && M === 'POST') {
      const b = await readBody(req), c = BR.get(b.clip); if (!c || !c.raw) throw bad('clip: a testimonial piece from a raw upload (Upload, It is raw)', 404);
      const v = update(st => { const j = jobState(st); j.cutins = j.cutins.filter(x => x.clip !== c.id); if (!b.remove) j.cutins.push({ clip: c.id, after: b.after ? String(b.after) : null }); });
      return json(res, 200, { broll: view(v), state: v });
    }
    if (p === '/api/broll/idea' && M === 'POST') { const b = await readBody(req);
      if (b.action === 'dismiss') { const v = update(st => { delete jobState(st).ideas[+b.beat]; }); return json(res, 200, { broll: view(v) }); }
      const v = await approveIdea(s, +b.beat); return json(res, 200, { broll: view(v), state: v }); }
    // ---------- generate: estimate, then the page approves each one ----------
    if (p === '/api/broll/generate/estimate' && M === 'POST') { const b = await readBody(req); return json(res, 200, await GEN.estimate(b, S.load())); }
    if (p === '/api/broll/generate' && M === 'POST') {
      const b = await readBody(req), st = S.load();
      if (!st.broll.generate) throw bad('Generating is off. Turn on "Allow generating" in Settings, API keys and providers.', 403);
      if (b.confirm !== true) throw bad('confirm: true, after showing the estimate to the user', 400);
      if (req.headers['x-studio-page'] !== '1') throw bad('Only the page can approve a generate (the agent can ask with fill_slot)', 403);
      GEN.check(b, st);
      const id = startGen(s.job, { ...b, id: b.ask || undefined }, b.estimate || null); return json(res, 202, { id, broll: view(C.load()) });
    }
    if (p === '/api/broll/ask' && M === 'POST') { const b = await readBody(req);
      if (b.action === 'decline') { const v = update(st => { const j = jobState(st); j.asks = j.asks.filter(x => x.id !== b.id); }); return json(res, 200, { broll: view(v) }); }
      let est = null; try { est = await GEN.estimate(b, S.load()); } catch (e) { if (e.needKey) throw e; }
      const id = addAsk(s, { ...b, estimate: est, by: b.by ? CH.prettyName(String(b.by)) : 'your agent' }); return json(res, 200, { id, broll: view(C.load()) });
    }
    return false;
  }
  return { route, view, plan, peek, autoPick, cutins: s => peek(s).cutins.map(x => ({ ...x, c: BR.get(x.clip) })).filter(x => x.c && x.c.raw) };
}
