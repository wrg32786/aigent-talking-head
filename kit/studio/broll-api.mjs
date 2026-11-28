// Studio's b-roll routes and state (kit/studio/server.mjs mounts them). The session keeps, per job:
//   s.broll[job] = { slots: { <spot n>: { clip, place, offset, dur, in, at, by } }, ideas: { <spot n>: { idea, why, query, clip,
//     card, place, offset, role, source, by } }, asks: [{ id, provider, kind, prompt, seconds, aspect, beat, estimate, by }],
//     gens: [{ id, status, ... }], marks: [seconds] (Add a spot), raws: [{ id, name, type, status, pieces }] (raw uploads
//     being cut), cutins: [{ clip, after }] (testimonial pieces played with their own sound, in the Combo) }
// Spots come from the job's draft (build/cut.json and build/captions.js, kit/studio/lane.mjs spots). The API still calls
// a spot a beat (beat: n), so agents that know fill_slot keep working. Library clips live in kit/studio/broll.mjs.
import { createWriteStream, existsSync, readFileSync, rmSync, renameSync, copyFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import * as KEYS from './keys.mjs';
import * as BR from './broll.mjs';
import * as V from './vault.mjs';
import * as VM from './vault-match.mjs';
import * as VAPI from './vault-api.mjs';
import { check as checkArgs } from './vault-schema.mjs';
import * as LANE from './lane.mjs';
import * as GEN from './gen.mjs';
import * as MAKE from './broll-make.mjs';
import * as S from './settings.mjs';
import * as CUT from './cut.mjs';
import { spawn } from 'child_process';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';
const BS = createRequire(import.meta.url)('../broll-slots.cjs');
const FRUN = createRequire(import.meta.url)('../fastrun.cjs');
const BB = createRequire(import.meta.url)('../broll-brief.cjs');

const bad = (m, code = 400, extra) => Object.assign(new Error(m), { code }, extra || {});
const clean = t => String(t == null ? '' : t).replace(/\u2014/g, ', ').slice(0, 300);

export const TYPES = { testimonial: 'Testimonial', 'product-demo': 'Product demo', 'screen-recording': 'Screen recording', lifestyle: 'Lifestyle' };
// what each spot role likes to show, from your library first
const ROLE_TYPES = { proof: ['testimonial', 'product-demo'], tip: ['screen-recording', 'product-demo'], story: ['lifestyle'], other: ['lifestyle'] };

export function mount({ ROOT, C, update, json, readBody, serveFile, CH, capturePage, chromeOk, refParts = () => [], askAgent = () => null, transcribe = null, wordsOf = () => null, energyOf = async () => null }) {
  const jobState = (s, job = s.job) => { s.broll = s.broll || {}; const b = s.broll[job] = s.broll[job] || {}; b.slots = b.slots || {}; b.ideas = b.ideas || {}; b.asks = b.asks || []; b.gens = b.gens || []; b.marks = b.marks || []; b.raws = b.raws || []; b.cutins = b.cutins || []; b.skips = b.skips || {}; return b; };
  const peek = (s, job = s.job) => ({ slots: {}, ideas: {}, asks: [], gens: [], marks: [], raws: [], cutins: [], skips: {}, ...(((s.broll || {})[job]) || {}) });
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
    ...(c.run ? { run: { n: (c.run.clips || []).length, step: c.run.step, beat: c.run.beat } } : {}), rights: c.rights || 'mine', ...(c.rights === 'public-page' ? { check: 'Check that you may show it.' } : {}), thumb: c.thumb ? `/api/broll/file?id=${c.id}&thumb=1` : null, url: `/api/broll/file?id=${c.id}`, provider: c.provider || null, prompt: c.prompt || null };
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
    const stockOn = ['pexels', 'pixabay'].some(p => KEYS.isSet(p));
    // every B-roll slot of the plan has a brief (what it should show) and the Vault's best items for it, each with its
    // reason. The first is the suggestion, the next three are what Swap offers. Nothing here leaves the computer.
    const sb = d ? slotBriefs(s, d, b, byId) : { brief: {}, cands: {} };
    const beats = d ? d.beats.map(bt => { const sl = b.slots[bt.n], c = sl && byId[sl.clip], br = sb.brief[bt.n]; return { ...bt, slot: sl && c ? { ...sl, place: sl.place || BS.placeOf(bt.ref?.slot), ...LANE.timing(sl, bt, c), clip: clipBrief(c) } : null, idea: b.ideas[bt.n] ? { ...b.ideas[bt.n], clip: b.ideas[bt.n].clip ? clipBrief(byId[b.ideas[bt.n].clip]) : null } : null,
      ...(br ? { brief: { ...br, slot: bt.ref.slot.n, text: BB.text(br) }, candidates: (sb.cands[bt.n] || []).map(candOut) } : {}),
      ...(needOf(bt, sl && c, b, job, stockOn, br, sb.cands[bt.n]) || {}), ...(underOf(bt, d.beats) ? { under: underOf(bt, d.beats) } : {}) }; }) : [];
    const st = S.load();
    // the B-roll slots the plan keeps (from the reference or the look) and how many have a clip: "6 of 19 filled"
    const planned = beats.filter(x => x.ref && x.ref.slot), slotsDone = planned.filter(x => x.slot || (x.ref.slot.by === 'recipe' && x.ref.slot.file)).length;
    return { job, draft: !!d, beats, slots: { total: planned.length, filled: slotsDone, skipped: planned.filter(x => x.need && x.need.skipped).length, from: planned.some(x => x.ref.slot.ref) ? 'reference' : 'look' }, run: runPace(job), length: d ? d.len : 0, asks: b.asks, gens: b.gens.slice(-8), sources: sources(), library: { dir: BR.libDir(), count: lib.length },
      generate: { on: !!st.broll.generate, providers: GEN.list(st) }, places: LANE.PLACE_LABEL, auto: autoOn(), types: TYPES, card: chromeOk(),
      raws: b.raws.slice(-6), cutins: b.cutins.map(x => ({ ...x, clip: clipBrief(byId[x.clip]) })).filter(x => x.clip), testimonials: lib.filter(c => c.type === 'testimonial' && c.raw).slice(0, 24).map(clipBrief),
      undo: !!(b.undo && b.undo.slots) };
  }
  // the brief of each plan slot (kit/broll-brief.cjs: the plan's own when an agent or you rewrote it, else the rules with
  // your words, brands and the point), and its candidates from the Vault (kit/studio/vault-match.mjs). An empty slot's
  // best pick is kept for it, so no two slots are offered the same item first; a filled slot gets what Swap can offer.
  const briefCtx = s => ({ glossary: s.glossary || [], brands: s.brands || [], point: s.point || '' });
  const briefFor = (s, bt) => BB.of({ ...bt.ref.slot, line: bt.ref.slot.line || bt.text }, briefCtx(s));
  function slotBriefs(s, d, b, byId) {
    const items = V.load().items, used = new Set(Object.values(b.slots).map(x => x.clip)), brief = {}, open = [];
    for (const bt of d.beats) { const rs = bt.ref && bt.ref.slot; if (!rs || rs.run || (rs.by === 'recipe' && rs.file)) continue; brief[bt.n] = briefFor(s, bt); if (!(b.slots[bt.n] && byId[b.slots[bt.n].clip])) open.push({ key: bt.n, brief: brief[bt.n] }); }
    const cands = VM.assign(open, items, { used });
    for (const n of Object.keys(brief)) if (!cands[n]) cands[n] = VM.candidates(brief[n], items, { exclude: used, n: 3 });
    return { brief, cands };
  }
  const candOut = x => ({ id: x.id, reason: x.reason, ok: x.ok, ...(x.check ? { check: x.check } : {}), clip: clipBrief(x.item) });
  // a spot that lies under a plan slot which started on an earlier spot (the slot runs on over it): the slot's number
  const underOf = (bt, beats) => { if (bt.ref && bt.ref.slot) return null; const o = beats.find(x => x.ref && x.ref.slot && x.n !== bt.n && +x.ref.slot.start < bt.end - 0.2 && +x.ref.slot.end > bt.start + 0.2); return o ? o.ref.slot.n : null; };
  // A B-roll slot from the plan with no clip on it: what it needs, in plain words (kit/broll-slots.cjs brief), the
  // ready instruction for an agent, and whether stock can be tried (a key is set). One per slot; skipped ones say so.
  function needOf(bt, filled, b, job, stockOn, br, cands) {
    const sl = bt.ref && bt.ref.slot; if (!sl || filled || (sl.by === 'recipe' && sl.file)) return null; // a slot the recipe gave its own file is already filled
    const slot = { ...sl, line: sl.line || bt.text }, nb = BS.brief(slot), stock = stockOn ? (LANE.nounQuery(sl.what || '') || sl.what || LANE.nounQuery(slot.line) || null) : null;
    // the one suggestion, in the spec's order: your Vault first, then free stock (only with your key, and not for a
    // screen: stock is weak there). Stock is not fetched until you press Use it. Generating is never suggested here.
    const top = cands && cands[0], prov = ['pexels', 'pixabay'].find(k => KEYS.isSet(k));
    const suggest = top ? { from: 'vault', ...candOut(top) } : stock && prov && br && br.shot !== 'screen recording' ? { from: 'stock', provider: prov, query: stock, reason: `From ${KEYS.byId(prov).name}: "${stock}"` } : null;
    return { need: { slot: sl.n, kind: sl.kind, ...(sl.run ? { run: sl.run } : {}), what: nb.what, line: nb.line, seconds: nb.seconds, shape: nb.shape, treat: nb.treat, frame: nb.frame, like: !!sl.ref, skipped: !!b.skips[sl.n],
      ...(br ? { show: BB.text(br) } : {}), suggest, ...(!top && !sl.run ? { none: 'Nothing in your Vault fits yet.' } : {}),
      stock, ask: BS.agentAsk(slot, { job, spot: bt.n }) } };
  }
  // the render step's plan: every filled slot as an insert, and the credits
  function plan(s) {
    const d = draftOf(s.job, s); if (!d) return null; const b = peek(s), lib = BR.load().clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
    const ins = LANE.inserts(b.slots, d.beats, id => byId[id], c => BR.pathOf(c));
    // a fast run credits the clips it was cut from too
    const used = [...new Set(ins.flatMap(x => [x.clip, ...(((byId[x.clip] || {}).run || {}).clips || [])]))].map(id => byId[id]).filter(Boolean);
    for (const c of used) BR.update(c.id, { usedIn: s.job });
    // skipped: the plan's slots you chose to leave empty (kit/studio/broll-run.mjs keeps them out of the render)
    return { inserts: ins, credits: used.length ? BR.credits(used, s.job) : '', skipped: Object.keys(b.skips || {}).filter(k => b.skips[k]).map(Number) };
  }
  const beatOk = (s, n) => { const d = draftOf(s.job, s); if (!d) throw bad('make a draft first: the beats come from it'); const bt = d.beats.find(x => x.n === +n); if (!bt) throw bad(`no beat ${n} (the draft has ${d.beats.length})`); return bt; };
  function fill(s0, n, clipId, o = {}) {
    const bt = beatOk(s0, n);
    if (clipId && !BR.get(clipId)) { const it = V.get(clipId); throw it && it.rights === 'reference' ? bad('That is saved as reference only. It is someone else\'s, so it is never placed in a reel.', 403) : it ? bad('That link has no picture yet, so it cannot be placed.') : bad(`no b-roll ${clipId}`, 404); }
    return update(s => { const b = jobState(s);
      if (!clipId) { delete b.slots[n]; return; }
      // on a reference B-roll slot the clip sits the way the reference's did, unless you pick another way
      const rs = bt.ref && bt.ref.slot, prev = b.slots[n] || {}, place = LANE.PLACES.includes(o.place) ? o.place : prev.place || BS.placeOf(rs);
      if (rs) delete b.skips[rs.n];
      b.slots[n] = { clip: clipId, place, offset: o.offset != null ? +o.offset : prev.clip === clipId ? prev.offset : null, dur: o.dur != null ? +o.dur : prev.clip === clipId ? prev.dur : null, in: o.in != null ? Math.max(0, +o.in) : prev.clip === clipId ? prev.in || 0 : 0, by: o.by || 'you', why: o.why ? clean(o.why) : prev.clip === clipId ? prev.why || null : null };
      b.slots[n].at = +(bt.start + (b.slots[n].offset != null ? b.slots[n].offset : rs ? Math.max(0, +rs.start - bt.start) : 0.2)).toFixed(2);
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
  // what Studio may place on its own (after a draft, or Suggest with fill): never a made card (text) from another
  // video, and no made card at all in repo mode, where the card holds the repo and plain text never goes in it.
  // Those stay in the Vault for you to pick, and an idea you approve can still use them.
  // (a made card is stamped with the video it was made for, so one never rendered still counts as that video's)
  const repoMode = s => { const c = (s.videoPlan && s.videoPlan.content) || {}; return !!(c.repoFeature && (c.repos || []).length); };
  const autoOk = (s, c) => !c || c.source !== 'agent' || (!repoMode(s) && (c.usedIn || []).length > 0 && c.usedIn.every(j => j === s.job));
  function pickIdeas(s, { gap = 6, all = false, auto = false } = {}) {
    const d = draftOf(s.job, s); if (!d) throw bad('make a draft first: the spots come from it'); const j = peek(s), lib = BR.load().clips.filter(c => !auto || autoOk(s, c));
    const used = new Set([...Object.values(j.slots).map(x => x.clip), ...(auto ? BR.load().clips.filter(c => !autoOk(s, c)).map(c => c.id) : [])]), taken = Object.entries(j.slots).map(([n, x]) => x.at != null ? +x.at : (d.beats.find(b => b.n === +n) || {}).start).filter(x => x != null);
    const out = [];
    // plan slots are matched to the Vault by their brief (a slot on a line that serves your point chooses first)
    const va = VM.assign(d.beats.filter(bt => bt.ref && bt.ref.slot && !bt.ref.slot.run && !j.slots[bt.n] && bt.seconds >= 1.2 && !underOf(bt, d.beats)).map(bt => ({ key: bt.n, brief: briefFor(s, bt) })), V.load().items, { used, n: 1 });
    for (const bt of d.beats) {
      if (j.slots[bt.n] || bt.seconds < 1.2) continue;
      // a spot under a plan slot that started on an earlier spot is taken: nothing else goes on top of that slot
      if (underOf(bt, d.beats)) continue;
      const p = LANE.pick(bt); if (!p && !bt.ref) continue;
      const offset = LANE.offsetFor(bt, p && p.word, d.caps), at = bt.start + offset;
      if (!all && !bt.ref && [...taken, ...out.map(x => x.at)].some(t => Math.abs(t - at) < gap)) continue;
      const role = p ? p.role : 'other', want = ROLE_TYPES[role] || [];
      // library first: the clip that best matches the spot's nouns (then its words), before any stock
      // a reference cutaway says what it showed (Reel.md shot broll): that is the search, before your words
      const what = bt.ref && bt.ref.what ? String(bt.ref.what) : null, wq = what ? (LANE.nounQuery(what) || what) : null;
      // a plan slot takes the Vault's pick for its brief or nothing (no looser search goes under the bar); a fast run
      // slot has no brief, so it keeps the search by what the reference showed
      const rs = bt.ref && bt.ref.slot, byBrief = rs && !rs.run, vp = byBrief ? ((va[bt.n] || [])[0] || null) : null;
      let hit = byBrief ? (vp && vp.ok && !used.has(vp.id) ? vp.item : null) : wq ? (BR.rank(wq + ' ' + what, { exclude: used }).find(c => c.matched >= 1) || null) : null;
      if (rs) { if (hit) used.add(hit.id); if (!hit) continue; // a plan slot with nothing over the bar stays "Needs B-roll", with the best guess as its suggestion
        out.push({ beat: bt.n, at: +rs.start, offset: +Math.max(0, rs.start - bt.start).toFixed(2), dur: +(rs.end - rs.start).toFixed(2), idea: `${hit.name} from your Vault`, why: vp ? vp.reason : `It matches what this slot should show${rs.what ? ` (${rs.what})` : ''}.`, role, query: wq || null, card: null, clip: hit.id, place: BS.placeOf(rs), source: 'vault' }); continue; }
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
      const ideas = pickIdeas(s, { auto: true }); if (ideas.length) saveIdeas(ideas, 'Studio');
      let placed = 0;
      for (const x of ideas) { try { await approveIdea(C.load(), x.beat, 'Studio', { quiet: true, noFallback: true, auto: true }); placed++; } catch {} }
      // one count that matches the step: what was placed, what waits for a yes, and the slots that need a clip from you
      const vw = view(C.load()), needs = vw.beats.filter(x => x.need && !x.need.skipped).length, waits = ideas.length - placed;
      if (!ideas.length && !needs) return;
      const parts = [placed ? `${placed} placed from what you said` : null, waits ? `${waits} idea${waits === 1 ? ' waits' : 's wait'} for you` : null, needs ? `${needs} slot${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} a clip` : null].filter(Boolean);
      update(st => { if (st.job === job) C.applyPatch(st, { reply: `B-roll picked itself: ${parts.join(', ')}. See the B-roll step.`, from: 'assistant', kind: 'action' }); });
    }).catch(e => console.error('b-roll auto: ' + e.message));
    return autoRun;
  }
  async function makeCard(spec, extra = {}) {
    if (!chromeOk()) throw bad('Agent-made B-roll needs Chrome, and it is not installed.', 400, { fix: ['chrome'] });
    if (!MAKE.KINDS.includes(spec.kind)) throw bad(`kind: ${MAKE.KINDS.join(', ')}`);
    const r = await MAKE.make(spec), job = C.load().job;
    const c = BR.add(r.file, { move: true, name: `${spec.kind}-${randomBytes(2).toString('hex')}.mp4`, title: spec.title && spec.kind !== 'chart' ? String(spec.title) : MAKE.titleOf(spec), source: 'agent', tags: [spec.kind, ...(extra.tags || [])], ...extra });
    if (job) BR.update(c.id, { usedIn: job }); // the video it was made for (see autoOk)
    return BR.get(c.id) || c;
  }
  // ---------- fast run: N library clips cut on the beat, as one clip ----------
  // the pace the job's bed gives: seconds for a beat and half a beat (build/beat-grid.json after a render with a bed,
  // else the recipe's BPM in the draft's plan), or null when there is no music to follow
  function runPace(job) {
    const b = join(ROOT, 'jobs', String(job || '-'), 'build'); let bpm = null;
    try { const g = JSON.parse(readFileSync(join(b, 'beat-grid.json'), 'utf8')); bpm = +g.tempo_bpm || null; } catch {}
    if (!bpm) { try { const c = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8')); bpm = +c.bpm || +((c.bedInfo || {}).bpm) || null; } catch {} }
    if (!(bpm >= 50 && bpm <= 220)) return { bpm: null, beat: FRUN.STEP_FALLBACK.beat, half: FRUN.STEP_FALLBACK.half };
    return { bpm: Math.round(bpm), beat: +(60 / bpm).toFixed(3), half: +(30 / bpm).toFixed(3) };
  }
  // ids: library clips in play order (videos or pictures). beat: 'half' (default) or 'beat'. Returns the new library clip.
  function makeRun(job, ids, { beat = 'half', place = null } = {}) {
    const list = [].concat(ids || []).map(String);
    if (list.length < 2) throw bad('A fast run needs 2 or more clips or pictures.');
    if (list.length > FRUN.MAX_ITEMS) throw bad(`A fast run takes up to ${FRUN.MAX_ITEMS} clips.`);
    const clips = list.map(id => { const c = BR.get(id); if (!c) throw bad(`no b-roll ${id}`, 404); if (c.run) throw bad('A fast run cannot hold another fast run. Pick the clips themselves.'); return c; });
    const pace = runPace(job), step = beat === 'beat' ? pace.beat : pace.half;
    // wide pictures (sites, screens) read best in the top half with you below; upright ones cover the frame
    const wide = clips.filter(c => (c.width || 16) >= (c.height || 9)).length * 2 >= clips.length, where = LANE.PLACES.includes(place) && place !== 'card' ? place : wide ? 'top' : 'full';
    const sc = FRUN.schedule({ n: clips.length, at: 0, step }), out = join(tmpdir(), `run-${randomBytes(4).toString('hex')}.mp4`);
    let made; try { made = FRUN.make({ items: clips.map(c => BR.pathOf(c)), durs: sc.durs, out, size: FRUN.SIZE_FOR[where] || FRUN.SIZE_FOR.full }); }
    catch (e) { throw bad('The fast run could not be made: ' + String(e.stderr || e.message).trim().split('\n').pop().slice(0, 160)); }
    const c = BR.add(made.file, { move: true, name: `fast-run-${clips.length}.mp4`, title: `Fast run: ${clips.length} clips`, source: 'run', tags: ['run', 'fast'],
      run: { clips: clips.map(x => x.id), step: sc.durs[0], beat: beat === 'beat' ? 'beat' : 'half', bpm: pace.bpm, seconds: made.seconds } });
    return { clip: c, place: where, seconds: made.seconds, pace };
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
    const ok = c => !o.auto || autoOk(s, c), cards = !(o.auto && repoMode(s));
    let clip = idea.clip && BR.get(idea.clip); if (!ok(clip)) clip = null; const tried = [];
    if (!clip && idea.card && cards && chromeOk()) clip = await makeCard(idea.card);
    if (!clip && idea.query) clip = BR.search(idea.query).find(ok) || null;
    if (!clip && idea.query) { const prov = ['pexels', 'pixabay'].find(p => KEYS.isSet(p));
      if (prov) { try { const res = await BR.searchStock(prov, { query: idea.query, orientation: idea.place === 'pip' ? 'landscape' : 'portrait' }); if (res.length) clip = await BR.downloadStock(prov, res[0]); else tried.push(`${KEYS.byId(prov).name} found nothing for "${idea.query}"`); } catch (e) { tried.push(e.message); } } }
    if (!clip && !o.noFallback && cards && chromeOk()) { const bt = (draftOf(s.job, s) || { beats: [] }).beats.find(b => b.n === +n), text = idea.card && idea.card.text || (bt && bt.text) || idea.idea;
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

  // what the Vault routes need from the B-roll step (kit/studio/vault-api.mjs)
  const dropSlots = id => update(st => { for (const j of Object.values(st.broll || {})) for (const [n, sl] of Object.entries(j.slots || {})) if (sl.clip === id) delete j.slots[n]; });
  const vaultCtx = { json, readBody, serveFile, rawToFile, get capture() { return chromeOk() && process.env.STUDIO_VAULT_CAPTURE !== '0' ? capturePage : null; },
    changed: () => update(st => { st.vaultRev = (st.vaultRev || 0) + 1; }), dropSlots,
    briefOf: n => { const s = C.load(), d = draftOf(s.job, s), bt = d && d.beats.find(x => x.ref && x.ref.slot && x.ref.slot.n === +n); return bt ? briefFor(s, bt) : null; },
    // a capture made for a slot waits on it as an idea: nothing is placed until the user says yes
    offer: (n, it, by) => { const s = C.load(), d = draftOf(s.job, s), bt = d && d.beats.find(x => x.ref && x.ref.slot && x.ref.slot.n === +n); if (!bt || !V.placeable(it) || peek(s).slots[bt.n]) return;
      saveIdeas([{ beat: bt.n, idea: `${it.name} from your Vault`, why: 'Captured for this slot. Look at it before you use it.', clip: it.id, place: BS.placeOf(bt.ref.slot), source: 'vault' }], by ? CH.prettyName(String(by)) : 'your agent'); } };
  const route = async (p, M, u, req, res) => (p.startsWith('/api/broll') || p.startsWith('/api/keys') || p.startsWith('/api/vault') ? (await handle(p, M, u, req, res)) !== false : false);
  async function handle(p, M, u, req, res) {
    const s = C.load(), q = k => u.searchParams.get(k);
    // ---------- API keys and providers: the page sees set or not and where from, never a value ----------
    if (p === '/api/keys' && M === 'GET') return json(res, 200, { keys: KEYS.status(), sources: sources(), generate: { on: !!S.load().broll.generate, providers: GEN.list(S.load()) }, file: KEYS.keysPath() });
    if (p === '/api/keys' && M === 'POST') { const b = await readBody(req); KEYS.save(String(b.id || ''), b.remove ? null : b.value); return json(res, 200, { keys: KEYS.status(), sources: sources() }); }
    if (p === '/api/keys/test' && M === 'POST') { const b = await readBody(req); const r = await KEYS.test(String(b.id || ''), b.value ? { value: KEYS.byId(b.id) && KEYS.byId(b.id).pair && typeof b.value === 'object' ? `${b.value.id}:${b.value.secret}` : String(b.value) } : {}); return json(res, 200, { ...r, keys: KEYS.status() }); }
    if (p.startsWith('/api/vault')) return VAPI.handle(vaultCtx, p, M, u, req, res);
    if (p === '/api/broll' && M === 'GET') return json(res, 200, view(s));
    // rewrite what a slot should show (set_broll_brief): kept in the draft's plan.json next to the slot
    if (p === '/api/broll/brief' && M === 'POST') {
      const b = await readBody(req), by = b.by ? CH.prettyName(String(b.by)) : 'you'; delete b.by; checkArgs('set_broll_brief', b);
      const f = join(ROOT, 'jobs', String(s.job || '-'), 'build', 'plan.json'), d = draftOf(s.job, s); let pl = null; try { pl = JSON.parse(readFileSync(f, 'utf8')); } catch {}
      const sl = d && pl && Array.isArray(pl.broll) ? pl.broll.find(x => x.n === b.slot) : null, bt = sl && d.beats.find(x => x.ref && x.ref.slot && x.ref.slot.n === b.slot);
      if (!sl || !bt) throw bad(`no B-roll slot ${b.slot} in this draft (list_broll shows them)`, 404);
      sl.brief = BB.merge(briefFor(s, bt), b, by); writeFileSync(f, JSON.stringify(pl, null, 1) + '\n');
      const v = update(st => { st.vaultRev = (st.vaultRev || 0) + 1; if (by !== 'you') C.applyPatch(st, { reply: `${by} rewrote what slot ${b.slot} should show: ${sl.brief.subject}.`, from: 'assistant', kind: 'action' }); });
      return json(res, 200, { slot: b.slot, brief: { ...sl.brief, slot: b.slot, text: BB.text(sl.brief) }, broll: view(v) });
    }
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
    if (p === '/api/broll/library' && M === 'POST') { const b = await readBody(req); if (b.action === 'remove' && req.headers['x-studio-page'] !== '1') throw bad('Only the page can delete from the Vault. Deleting is the user\'s.', 403); const c = b.action === 'remove' ? BR.remove(b.id) : BR.update(b.id, { name: b.name, tags: b.tags, type: b.type }); if (b.action === 'remove') dropSlots(b.id); return json(res, 200, { clip: clipBrief(c), broll: view(C.load()) }); }
    if (p === '/api/broll/stock' && M === 'GET') return json(res, 200, { provider: q('provider'), results: await BR.searchStock(q('provider'), { query: q('q'), orientation: q('orientation'), min: q('min') != null && q('min') !== '' ? +q('min') : null, max: q('max') != null && q('max') !== '' ? +q('max') : null, page: +(q('page') || 1) }) });
    if (p === '/api/broll/stock/add' && M === 'POST') { const b = await readBody(req); const c = await BR.downloadStock(b.provider, b.item); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/make' && M === 'POST') { const b = await readBody(req); const c = await makeCard(b.spec || {}); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/capture' && M === 'POST') { const b = await readBody(req); const c = await captureClip(String(b.url || '')); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place || 'pip', by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    // Fast run: clips (library ids, in order) and urls (public pages, captured first) become one clip cut on the beat,
    // placed on the spot as one insert
    if (p === '/api/broll/run' && M === 'POST') {
      const b = await readBody(req), ids = [].concat(b.clips || []).map(String);
      for (const u of [].concat(b.urls || []).slice(0, FRUN.MAX_ITEMS)) ids.push((await captureClip(String(u))).id);
      const r = makeRun(s.job, ids, { beat: b.step === 'beat' ? 'beat' : 'half', place: b.place });
      const v = b.beat != null ? fill(C.load(), b.beat, r.clip.id, { place: r.place, dur: r.seconds, in: 0, by: b.by, why: `${ids.length} clips, one every ${r.clip.run.step} s${r.pace.bpm ? `, on the ${r.clip.run.beat === 'beat' ? 'beats' : 'half beats'} of your music (${r.pace.bpm} BPM)` : ''}` }) : C.load();
      return json(res, 200, { clip: clipBrief(r.clip), place: r.place, seconds: r.seconds, broll: view(v) });
    }
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
      const b = await readBody(req).catch(() => ({})), ideas = pickIdeas(s, { gap: b.gap != null ? Math.max(1, +b.gap) : 6, all: b.all === true, auto: b.fill === true });
      let v = saveIdeas(ideas);
      if (b.fill === true) { for (const x of ideas) { try { await approveIdea(C.load(), x.beat, 'Studio', { quiet: true, auto: true }); } catch {} } v = C.load(); }
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
    // a slot that needs B-roll: skip it (or take the skip back), try stock for it (only with a key), or send the
    // ready instruction to your agent
    if (p === '/api/broll/need' && M === 'POST') {
      const b = await readBody(req), bt = beatOk(s, b.beat), rs = bt.ref && bt.ref.slot; if (!rs) throw bad(`spot ${b.beat} is not a B-roll slot from the plan`);
      if (b.action === 'skip' || b.action === 'unskip') { const v = update(st => { const j = jobState(st); if (b.action === 'skip') { j.skips[rs.n] = true; delete j.ideas[bt.n]; } else delete j.skips[rs.n]; }); return json(res, 200, { broll: view(v), state: v }); }
      const nd = (view(s).beats.find(x => x.n === bt.n) || {}).need; if (!nd) throw bad('that slot already has a clip');
      if (b.action === 'stock') {
        const prov = ['pexels', 'pixabay'].find(k => KEYS.isSet(k)); if (!prov) throw bad('Add a free Pexels or Pixabay key first. It stays on this computer.', 400, { needKey: 'pexels' });
        const r = await BR.searchStock(prov, { query: nd.stock || 'screen', orientation: rs.kind === 'full' ? 'portrait' : 'landscape' }); if (!r.length) throw bad(`${KEYS.byId(prov).name} found nothing for "${nd.stock}". Upload a clip, or ask your agent to capture it.`, 404);
        const c = await BR.downloadStock(prov, r[0]), v = fill(C.load(), bt.n, c.id, { by: 'you', why: `Stock for "${nd.stock}".` }); return json(res, 200, { clip: clipBrief(c), broll: view(v), state: v });
      }
      if (b.action === 'send') { const r = await askAgent(nd.ask, { kind: 'broll', slot: rs.n, beat: bt.n, label: nd.what }); if (!r) throw bad('Connect your agent first (Connect agent, top right).'); return json(res, 200, r); }
      throw bad('action: skip, unskip, stock or send');
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
