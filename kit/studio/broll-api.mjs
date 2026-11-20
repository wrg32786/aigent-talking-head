// Studio's b-roll routes and state (kit/studio/server.mjs mounts them). The session keeps, per job:
//   s.broll[job] = { slots: { <beat n>: { clip, place, offset, dur, in, by } }, ideas: { <beat n>: { idea, query, clip, card,
//     place, source, by } }, asks: [{ id, provider, kind, prompt, seconds, aspect, beat, estimate, by }], gens: [{ id, status, ... }] }
// Beats come from the job's draft (build/cut.json and build/captions.js). Library clips live in kit/studio/broll.mjs.
import { createWriteStream, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import * as KEYS from './keys.mjs';
import * as BR from './broll.mjs';
import * as LANE from './lane.mjs';
import * as GEN from './gen.mjs';
import * as MAKE from './broll-make.mjs';
import * as S from './settings.mjs';

const bad = (m, code = 400, extra) => Object.assign(new Error(m), { code }, extra || {});
const clean = t => String(t == null ? '' : t).replace(/\u2014/g, ', ').slice(0, 300);

export function mount({ ROOT, C, update, json, readBody, serveFile, CH, capturePage, chromeOk }) {
  const jobState = (s, job = s.job) => { s.broll = s.broll || {}; const b = s.broll[job] = s.broll[job] || {}; b.slots = b.slots || {}; b.ideas = b.ideas || {}; b.asks = b.asks || []; b.gens = b.gens || []; return b; };
  const peek = (s, job = s.job) => ((s.broll || {})[job]) || { slots: {}, ideas: {}, asks: [], gens: [] };
  function draftOf(job) {
    const b = join(ROOT, 'jobs', String(job || '-'), 'build'); let cut = null, caps = null;
    try { cut = JSON.parse(readFileSync(join(b, 'cut.json'), 'utf8')); } catch { return null; }
    try { const g = {}; new Function('window', readFileSync(join(b, 'captions.js'), 'utf8'))(g); caps = g.CAPTIONS; } catch {}
    return { cut, caps, beats: LANE.beats(cut, caps) };
  }
  const clipBrief = c => c && { id: c.id, name: c.name, source: c.source, kind: c.kind, seconds: c.seconds, width: c.width, height: c.height, tags: c.tags, license: c.license, author: c.author, sourceUrl: c.sourceUrl,
    thumb: c.thumb ? `/api/broll/file?id=${c.id}&thumb=1` : null, url: `/api/broll/file?id=${c.id}`, provider: c.provider || null, prompt: c.prompt || null };
  function sources(env = process.env) {
    const st = S.load(), k = Object.fromEntries(KEYS.status(env).map(x => [x.id, x.set])), gen = GEN.PROVIDERS.filter(id => k[id]);
    return [
      { id: 'upload', name: 'Upload', on: true }, { id: 'library', name: 'Library', on: true, note: BR.libDir() },
      { id: 'pexels', name: 'Pexels', on: !!k.pexels, note: k.pexels ? 'your key' : 'add a free key' }, { id: 'pixabay', name: 'Pixabay', on: !!k.pixabay, note: k.pixabay ? 'your key' : 'optional, add a free key' },
      { id: 'agent', name: 'Agent-made', on: chromeOk(), note: chromeOk() ? 'charts, counters, quotes, code, terminal, HTML scenes' : 'needs Chrome' },
      { id: 'screen', name: 'Screen recording', on: true, note: 'in this browser' }, { id: 'capture', name: 'Web capture', on: chromeOk(), note: 'public pages' },
      { id: 'generate', name: 'Generate', on: !!(st.broll.generate && gen.length), note: !st.broll.generate ? 'off (Settings)' : gen.length ? gen.map(id => KEYS.byId(id).name).join(', ') : 'add a provider key' },
    ];
  }
  function view(s, job = s.job) {
    const d = job ? draftOf(job) : null, b = peek(s, job), lib = BR.load().clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
    const beats = d ? d.beats.map(bt => { const sl = b.slots[bt.n], c = sl && byId[sl.clip]; return { ...bt, slot: sl && c ? { ...sl, ...LANE.timing(sl, bt, c), clip: clipBrief(c) } : null, idea: b.ideas[bt.n] ? { ...b.ideas[bt.n], clip: b.ideas[bt.n].clip ? clipBrief(byId[b.ideas[bt.n].clip]) : null } : null }; }) : [];
    const st = S.load();
    return { job, draft: !!d, beats, length: beats.length ? beats[beats.length - 1].end : 0, asks: b.asks, gens: b.gens.slice(-8), sources: sources(), library: { dir: BR.libDir(), count: lib.length },
      generate: { on: !!st.broll.generate, providers: GEN.list(st) }, places: LANE.PLACE_LABEL };
  }
  // the render step's plan: every filled slot as an insert, and the credits
  function plan(s) {
    const d = draftOf(s.job); if (!d) return null; const b = peek(s), lib = BR.load().clips, byId = Object.fromEntries(lib.map(c => [c.id, c]));
    const ins = LANE.inserts(b.slots, d.beats, id => byId[id], c => BR.pathOf(c));
    const used = [...new Set(ins.map(x => x.clip))].map(id => byId[id]);
    for (const c of used) BR.update(c.id, { usedIn: s.job });
    return { inserts: ins, credits: used.length ? BR.credits(used, s.job) : '' };
  }
  const beatOk = (s, n) => { const d = draftOf(s.job); if (!d) throw bad('make a draft first: the beats come from it'); const bt = d.beats.find(x => x.n === +n); if (!bt) throw bad(`no beat ${n} (the draft has ${d.beats.length})`); return bt; };
  function fill(s0, n, clipId, o = {}) {
    beatOk(s0, n); if (clipId && !BR.get(clipId)) throw bad(`no b-roll ${clipId}`, 404);
    return update(s => { const b = jobState(s);
      if (!clipId) { delete b.slots[n]; return; }
      const prev = b.slots[n] || {}, place = LANE.PLACES.includes(o.place) ? o.place : prev.place || 'full';
      b.slots[n] = { clip: clipId, place, offset: o.offset != null ? +o.offset : prev.clip === clipId ? prev.offset : null, dur: o.dur != null ? +o.dur : prev.clip === clipId ? prev.dur : null, in: o.in != null ? Math.max(0, +o.in) : prev.clip === clipId ? prev.in || 0 : 0, by: o.by || 'you' };
      delete b.ideas[n];
      if (o.by && o.by !== 'you') C.applyPatch(s, { reply: `${o.by} put ${BR.get(clipId).name} on beat ${n} (${LANE.PLACE_LABEL[place].toLowerCase()}).`, from: 'assistant', kind: 'action' });
    });
  }
  async function makeCard(spec, extra = {}) {
    if (!chromeOk()) throw bad('Agent-made b-roll needs Chrome (npm run setup:all)');
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
  async function approveIdea(s, n, by = 'you') {
    const idea = peek(s).ideas[n]; if (!idea) throw bad(`no idea on beat ${n}`, 404);
    let clip = idea.clip && BR.get(idea.clip);
    if (!clip && idea.card) clip = await makeCard(idea.card);
    if (!clip && idea.query) {
      const hit = BR.search(idea.query)[0]; if (hit) clip = hit;
      else { const prov = ['pexels', 'pixabay'].find(p => KEYS.isSet(p)); if (!prov) throw bad(`Nothing in the library for "${idea.query}". Add a Pexels key to search stock, or fill the beat by hand.`);
        const res = await BR.searchStock(prov, { query: idea.query, orientation: idea.place === 'pip' ? 'landscape' : 'portrait' }); if (!res.length) throw bad(`${KEYS.byId(prov).name} found nothing for "${idea.query}"`);
        clip = await BR.downloadStock(prov, res[0]); }
    }
    if (!clip) throw bad('that idea has no clip, card or search yet');
    return fill(C.load(), n, clip.id, { place: idea.place, by });
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
      const name = String(q('name') || 'clip.mp4'), source = q('source') === 'screen' ? 'screen' : 'upload';
      if (!BR.VIDEO.test(name) && !BR.IMAGE.test(name)) return json(res, 400, { error: 'b-roll is a video (mp4, mov, webm, m4v, mkv) or a picture (jpg, png, webp)' });
      const f = await rawToFile(req, 2e9), c = BR.add(f, { move: true, name, source, title: q('title') || null });
      const v = q('beat') ? fill(C.load(), +q('beat'), c.id, { place: q('place') }) : C.load();
      return json(res, 200, { clip: clipBrief(c), broll: view(v), ...{ state: v } });
    }
    if (p === '/api/broll/library' && M === 'POST') { const b = await readBody(req); const c = b.action === 'remove' ? BR.remove(b.id) : BR.update(b.id, b); if (b.action === 'remove') update(st => { for (const j of Object.values(st.broll || {})) for (const [n, sl] of Object.entries(j.slots || {})) if (sl.clip === b.id) delete j.slots[n]; }); return json(res, 200, { clip: clipBrief(c), broll: view(C.load()) }); }
    if (p === '/api/broll/stock' && M === 'GET') return json(res, 200, { provider: q('provider'), results: await BR.searchStock(q('provider'), { query: q('q'), orientation: q('orientation'), min: q('min') != null && q('min') !== '' ? +q('min') : null, max: q('max') != null && q('max') !== '' ? +q('max') : null, page: +(q('page') || 1) }) });
    if (p === '/api/broll/stock/add' && M === 'POST') { const b = await readBody(req); const c = await BR.downloadStock(b.provider, b.item); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/make' && M === 'POST') { const b = await readBody(req); const c = await makeCard(b.spec || {}); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place, by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/capture' && M === 'POST') { const b = await readBody(req); const c = await captureClip(String(b.url || '')); const v = b.beat != null ? fill(C.load(), b.beat, c.id, { place: b.place || 'pip', by: b.by }) : C.load(); return json(res, 200, { clip: clipBrief(c), broll: view(v) }); }
    if (p === '/api/broll/slot' && M === 'POST') { const b = await readBody(req); const v = fill(s, b.beat, b.clear ? null : b.clip || (peek(s).slots[b.beat] || {}).clip, { ...b, by: b.by ? CH.prettyName(String(b.by)) : 'you' }); return json(res, 200, { broll: view(v), state: v }); }
    if (p === '/api/broll/ideas' && M === 'POST') {
      const b = await readBody(req), by = b.by ? CH.prettyName(String(b.by)) : 'the rules', d = draftOf(s.job); if (!d) throw bad('make a draft first: the beats come from it');
      if (!Array.isArray(b.ideas)) throw bad('ideas: [{ beat, idea, query or clip or card, place }]');
      for (const x of b.ideas) { beatOk(s, x.beat); if (x.clip && !BR.get(x.clip)) throw bad(`no b-roll ${x.clip}`); if (x.card) MAKE.html(x.card); if (x.place && !LANE.PLACES.includes(x.place)) throw bad(`place: ${LANE.PLACES.join(', ')}`); }
      const v = update(st => { const j = jobState(st); for (const x of b.ideas.slice(0, 60)) j.ideas[+x.beat] = { idea: clean(x.idea || x.query || (x.card && x.card.kind + ' card')), query: x.query ? clean(x.query).slice(0, 80) : null, clip: x.clip || null, card: x.card || null, place: x.place || null, source: x.source || null, by };
        if (b.by) C.applyPatch(st, { reply: `${by} suggested b-roll for ${b.ideas.length} beat${b.ideas.length === 1 ? '' : 's'}. Approve or dismiss each on the B-roll step.`, from: 'assistant', kind: 'action' }); });
      return json(res, 200, { broll: view(v), state: v });
    }
    if (p === '/api/broll/suggest' && M === 'POST') {
      // the rules: for every empty beat, its strongest words as a search, with a library clip when one matches
      const d = draftOf(s.job); if (!d) throw bad('make a draft first: the beats come from it'); const j = peek(s);
      const ideas = d.beats.filter(bt => !j.slots[bt.n] && bt.seconds >= 1.2 && bt.n > 1).map(bt => { const qy = LANE.queryOf(bt.text); const hit = qy && BR.search(qy)[0]; return qy ? { beat: bt.n, idea: hit ? `${hit.name} from your library` : `stock: ${qy}`, query: qy, clip: hit ? hit.id : null } : null; }).filter(Boolean);
      const v = update(st => { const jj = jobState(st); for (const x of ideas) jj.ideas[x.beat] = { ...x, by: 'the rules' }; });
      return json(res, 200, { broll: view(v), count: ideas.length });
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
  return { route, view, plan, peek };
}
