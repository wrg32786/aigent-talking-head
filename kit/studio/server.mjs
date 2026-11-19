// Studio: a local web page over the kit. Drop in footage and a reference, click effects from a visual menu, set the
// music and pace, chat the vibe, read what was picked and why, render and download. Everything runs on this computer;
// the page only talks to this server, and this server only runs the kit's own commands (reel, teardown, choices, fx).
//   npm run studio                    -> http://127.0.0.1:4757 opens in your browser
//   npm run studio -- --port 5000 --no-open
// The session lives in jobs/.studio/state.json (STUDIO_DIR to move it). The MCP tools studio_get_state and
// studio_set_selections read and write the same file, and the page updates live when they do.
import http from 'http';
import { spawn } from 'child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, watchFile, writeFileSync } from 'fs';
import { join, extname, basename, resolve, sep } from 'path';
import { createRequire } from 'module';
import * as C from './core.mjs';
import * as LLM from './llm.mjs';

const require = createRequire(import.meta.url);
const K = require('../packs.cjs');
const { ROOT, KIT, STUDIO } = C;
const argv = process.argv.slice(2);
const flag = k => argv.includes('--' + k);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined; };
const VALUED = new Set(['port']);
const PORT = +(opt('port') || process.env.STUDIO_PORT || 4757);
const HOST = '127.0.0.1';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8' };
// what the page may load from the repo
const SERVE = ['inbox/studio/', 'teardown-in/studio/', 'docs/menu/', 'showcase/media/', 'packs/', 'kit/music/', 'kit/fonts/', 'jobs/', 'teardown/', 'docs/studio/'];
const VIDEO = ['.mp4', '.mov', '.m4v', '.webm', '.mkv'], AUDIO = ['.mp3', '.wav', '.m4a', '.aac', '.flac'];

// ---------- live updates ----------
const clients = new Set();
const send = (ev, data) => { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
let lastRev = -1;
const pushState = () => { const s = C.load(); if (s.rev !== lastRev) { lastRev = s.rev; send('state', view(s)); } };
const update = fn => { const s = C.load(); const r = fn(s); C.save(s); pushState(); return r === undefined ? s : r; };

function env() {
  const p = LLM.provider();
  return { llm: p ? `${p.name} (${p.model})` : null, effectsReady: existsSync(join(ROOT, 'effects', '.venv')), port: PORT };
}
function view(s) {
  let comp; try { comp = C.compose(s, { refPack: refPackName(s) }); } catch (e) { comp = { args: [], errs: [e.message], notes: [] }; }
  return { state: s, compose: comp, outputs: C.outputsOf(s), env: env(), task: task && { id: task.id, kind: task.kind, status: task.status, startedAt: task.startedAt, endedAt: task.endedAt, lines: task.lines.slice(-12), result: task.result || null } };
}

// ---------- tasks (one at a time) ----------
let task = null, seq = 0;
function runTask(kind, steps, done) {
  if (task && task.status === 'running') throw Object.assign(new Error(`busy: ${task.kind} is running`), { code: 409 });
  task = { id: ++seq, kind, status: 'running', startedAt: Date.now(), lines: [], proc: null };
  const me = task;
  const log = l => { for (const x of String(l).split(/\r?\n/)) if (x.trim()) { me.lines.push(x.slice(0, 400)); if (me.lines.length > 400) me.lines.shift(); send('log', { id: me.id, line: x.slice(0, 400) }); } };
  update(s => { s.task = { id: me.id, kind, status: 'running' }; });
  (async () => {
    let out = '';
    for (const [script, args] of steps()) {
      log(`$ node ${script} ${args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
      const code = await new Promise(res => {
        const p = spawn(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env: process.env });
        me.proc = p;
        p.stdout.on('data', d => { out += d; log(d); }); p.stderr.on('data', d => log(d));
        p.on('close', c => res(c)); p.on('error', e => { log(e.message); res(1); });
      });
      if (me.status === 'cancelled') return;
      if (code !== 0) { me.status = 'failed'; me.result = { code }; break; }
    }
    if (me.status === 'running') { me.status = 'done'; try { me.result = (await done(out)) || {}; } catch (e) { me.status = 'failed'; log('error: ' + e.message); } }
  })().finally(() => { me.endedAt = Date.now(); update(s => { s.task = { id: me.id, kind, status: me.status }; s.outputs = C.outputsOf(s); }); send('task', { id: me.id, status: me.status }); });
  return me;
}

// ---------- the kit's commands, from the session ----------
const refPackName = s => s.reference && s.reference.mode === 'influence' && s.reference.extracted && s.job ? `ref-${s.job}`.slice(0, 48) : null;
function writeRefPack(s) {
  const name = refPackName(s); if (!name) return null;
  const pack = C.fitStyle(C.influencePack(s.reference.extracted, s.job, s.pack));
  const errs = K.validate(pack);
  if (errs.length) throw new Error('reference pack: ' + errs.join('; '));
  const dir = join(K.LOCAL, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n\n${pack.description}\n\nMade by Studio. Use it with npm run reel -- <clip> --pack ${name}.\n`);
  return name;
}
function draftSteps(s) {
  if (!s.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  if (!s.footage.length && !s.clips) throw Object.assign(new Error('add footage first'), { code: 400 });
  const recreate = s.reference.mode === 'recreate' && s.reference.out && existsSync(join(ROOT, s.reference.out, 'Reel.md'));
  const ref = recreate ? null : writeRefPack(s);
  const comp = C.compose(s, { refPack: ref });
  if (comp.errs.length) throw Object.assign(new Error(comp.errs.join('; ')), { code: 400 });
  let args = comp.args.slice();
  if (recreate) { const i = args.indexOf('--pack'); if (i >= 0) args.splice(i, 2); args.push('--recipe', join(s.reference.out, 'Reel.md')); }
  const src = s.clips ? ['--clips', s.clips] : s.footage;
  return { steps: [['kit/reel.cjs', [...src, '--name', s.job, '--force', '--draft', '--json', ...args, ...(process.env.STUDIO_REEL_ARGS ? process.env.STUDIO_REEL_ARGS.split(' ') : [])]]], lockString: comp.lockString };
}
function renderSteps(s) {
  if (!s.job || !existsSync(join(ROOT, 'jobs', s.job, 'build', 'cut.json'))) throw Object.assign(new Error('make a draft first'), { code: 400 });
  const comp = C.compose(s, { refPack: refPackName(s) });
  const args = ['--rebuild', '--name', s.job, '--json'];
  if (comp.lockString && comp.lockString !== s.lockedAtDraft) args.push('--lock', comp.lockString);
  if (s.export) args.push('--export', s.export);
  const steps = [['kit/reel.cjs', args]];
  let fx = null;
  if (comp.effects.length && env().effectsReady) {
    const ch = readChoices(s); fx = C.fxPlan(ch, comp.effects);
    if (fx.plan.effects.length) { const p = join('jobs', s.job, 'fx.json'); writeFileSync(join(ROOT, p), JSON.stringify(fx.plan, null, 2)); steps.push(['kit/fx.cjs', ['--name', s.job, '--plan', p]]); }
  }
  return { steps, fx, effects: comp.effects };
}
const choicesPath = s => join(ROOT, 'jobs', s.job || '-', 'choices.json');
const readChoices = s => { try { return JSON.parse(readFileSync(choicesPath(s), 'utf8')); } catch { return null; } };

function teardownSteps(s, url) {
  if (!s.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  const out = join('teardown', `studio-${s.job}`);
  const args = url ? ['--url', url] : [s.reference.file];
  if (!url && !s.reference.file) throw Object.assign(new Error('add a reference video or a link first'), { code: 400 });
  args.push('--out', out, '--name', `studio-${s.job}`);
  if (process.env.STUDIO_TEARDOWN_ARGS) args.push(...process.env.STUDIO_TEARDOWN_ARGS.split(' '));
  return { steps: [['kit/teardown.mjs', args]], out };
}

// ---------- http ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > 2e6) { bad(new Error('too big')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(Object.assign(new Error('send JSON'), { code: 400 })); } }); });
const safeName = n => basename(String(n || 'file')).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'file';

function serveFile(req, res, file) {
  let st; try { st = statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return json(res, 404, { error: 'not found' });
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': file.includes(sep + 'jobs' + sep) ? 'no-store' : 'max-age=300' };
  if (new URL(req.url, 'http://x').searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${basename(file)}"`;
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2], end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    if (start > end || start < 0) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  createReadStream(file).pipe(res);
}

async function api(req, res, u) {
  const p = u.pathname, M = req.method;
  if (p === '/api/catalog' && M === 'GET') return json(res, 200, C.catalog());
  if (p === '/api/state' && M === 'GET') return json(res, 200, view(C.load()));
  if (p === '/api/state' && M === 'POST') {
    const patch = await readBody(req);
    const s = C.load(), r = C.applyPatch(s, { ...patch, from: patch.from || 'ui' });
    if (r.errs.length) return json(res, 400, { error: r.errs.join('; '), errs: r.errs });
    C.save(s); pushState(); return json(res, 200, { ...view(s), log: r.log });
  }
  if (p === '/api/upload' && M === 'POST') {
    const kind = u.searchParams.get('kind'), name = safeName(u.searchParams.get('name')), ext = extname(name).toLowerCase();
    if (!['footage', 'reference', 'music'].includes(kind)) return json(res, 400, { error: 'kind: footage, reference or music' });
    if (!(kind === 'music' ? AUDIO : VIDEO).includes(ext)) return json(res, 400, { error: `${kind}: ${(kind === 'music' ? AUDIO : VIDEO).join(', ')} files` });
    const s0 = C.load(); if (!s0.job) return json(res, 400, { error: 'name the job first' });
    const dir = kind === 'footage' ? join('inbox', 'studio', s0.job) : kind === 'reference' ? join('teardown-in', 'studio', s0.job) : join('inbox', 'studio', s0.job, 'music');
    mkdirSync(join(ROOT, dir), { recursive: true });
    const relp = join(dir, name).split(sep).join('/'), dest = join(ROOT, relp);
    await new Promise((ok, bad) => { const w = createWriteStream(dest); req.pipe(w); w.on('finish', ok); w.on('error', bad); req.on('error', bad); });
    const s = update(st => {
      if (kind === 'footage') { if (!st.footage.includes(relp)) st.footage.push(relp); st.clips = null; }
      if (kind === 'reference') { st.reference = { ...st.reference, file: relp, url: null, status: 'uploaded', extracted: null, out: null, applied: false }; }
      if (kind === 'music') { st.music.upload = relp; st.music.bed = 'upload'; }
    });
    return json(res, 200, { ok: true, path: relp, ...view(s) });
  }
  if (p === '/api/footage/remove' && M === 'POST') { const b = await readBody(req); const s = update(st => { st.footage = st.footage.filter(f => f !== b.path); }); return json(res, 200, view(s)); }
  if (p === '/api/reference' && M === 'POST') {
    const b = await readBody(req), s = C.load();
    if (b.url && !/^https:\/\/(www\.)?instagram\.com\/(reel|p)\/[A-Za-z0-9_-]+\/?/.test(b.url)) return json(res, 400, { error: 'a link must be one Instagram post or reel (fetched anonymously, no login). Otherwise download it where you have the rights and upload the file.' });
    const t = teardownSteps(s, b.url);
    update(st => { st.reference.status = 'running'; st.reference.url = b.url || null; st.reference.out = t.out; });
    runTask('teardown', () => t.steps, () => {
      const recipe = join(ROOT, t.out, 'Reel.md');
      if (!existsSync(recipe)) throw new Error('teardown wrote no Reel.md');
      const ex = C.extract(recipe);
      update(st => { st.reference.status = 'ready'; st.reference.extracted = ex; st.reference.out = t.out; st.reference.contact = existsSync(join(ROOT, t.out, 'contact.jpg')) ? `${t.out}/contact.jpg`.split(sep).join('/') : null; });
      return { extracted: ex };
    });
    return json(res, 202, view(C.load()));
  }
  if (p === '/api/reference/apply' && M === 'POST') {
    const s = C.load(), ex = s.reference.extracted; if (!ex) return json(res, 400, { error: 'tear down a reference first' });
    const cat = C.catalog(), picks = {};
    for (const t of Object.keys(ex.transitions)) picks[`transition:${t}`] = 'allow';
    for (const e of ex.entrances) picks[`entrance:${e}`] = 'allow';
    for (const f of ex.finishes) picks[`finish:${f}`] = 'allow';
    for (const g of ex.graphics) picks[`graphic:${g}`] = 'allow';
    for (const e of ex.effects) picks[`effect:${e}`] = 'allow';
    if (ex.captionStyle && cat.items[`captionStyle:${ex.captionStyle}`]) picks[`captionStyle:${ex.captionStyle}`] = 'allow';
    const patch = { picks, ...(ex.music.bed && cat.beds.some(b => b.id === ex.music.bed) ? { music: { bed: ex.music.bed } } : {}), ...(ex.preset && cat.packs.some(x => x.name === ex.preset) ? { pack: ex.preset } : {}) };
    const r = C.applyPatch(s, patch); s.reference.applied = true; C.save(s); pushState();
    return json(res, 200, { ...view(s), log: r.log, errs: r.errs });
  }
  if (p === '/api/draft' && M === 'POST') {
    const s = C.load(); const d = draftSteps(s);
    update(st => { st.lockedAtDraft = d.lockString || ''; });
    runTask('draft', () => d.steps, () => ({ choices: !!readChoices(C.load()) }));
    return json(res, 202, view(C.load()));
  }
  if (p === '/api/render' && M === 'POST') {
    const s = C.load(); const r = renderSteps(s);
    runTask('render', () => r.steps, () => { const st = C.load(); return { outputs: C.outputsOf(st), fx: r.fx, effects: r.effects }; });
    return json(res, 202, { ...view(C.load()), fx: r.fx, effectsSkipped: r.effects.length && !r.fx ? 'effects need npm run effects:setup' : null });
  }
  if (p === '/api/task/cancel' && M === 'POST') { if (task && task.status === 'running') { task.status = 'cancelled'; task.proc && task.proc.kill('SIGTERM'); } return json(res, 200, view(C.load())); }
  if (p === '/api/choices' && M === 'GET') { const s = C.load(); return json(res, 200, { choices: readChoices(s) }); }
  if (p === '/api/choices' && M === 'POST') {
    const b = await readBody(req), s = C.load(), cur = readChoices(s);
    if (!cur) return json(res, 400, { error: 'make a draft first' });
    for (const k of ['beats', 'titles', 'graphics']) if (Array.isArray(b[k])) cur[k] = b[k];
    writeFileSync(choicesPath(s), JSON.stringify(cur, null, 2) + '\n');
    const r = await new Promise(ok => { const pr = spawn(process.execPath, [join(KIT, 'choices.cjs'), s.job, '--apply', '--json'], { cwd: ROOT }); let o = '', e = ''; pr.stdout.on('data', d => o += d); pr.stderr.on('data', d => e += d); pr.on('close', code => ok({ code, o, e })); });
    if (r.code !== 0) return json(res, 400, { error: (r.e || r.o).trim().split('\n').slice(-4).join(' ') });
    update(st => { st.lockedAtDraft = C.compose(st, { refPack: refPackName(st) }).lockString || ''; });
    return json(res, 200, { ok: true, choices: readChoices(s), log: r.o.trim().split('\n').filter(l => !l.startsWith('{')).slice(-20) });
  }
  if (p === '/api/pack/save' && M === 'POST') {
    const b = await readBody(req), s = C.load(), name = String(b.name || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) return json(res, 400, { error: 'pack name: lowercase letters, numbers and dashes' });
    if (K.shipped().some(x => x.name === name)) return json(res, 400, { error: `${name} is a shipped pack; pick another name` });
    const comp = C.compose(s), base = s.pack ? K.load(s.pack) : null;
    const pack = { format: K.FORMAT, formatVersion: K.FORMAT_VERSION, name, version: '1.0.0', label: String(b.label || `My look (${name})`).slice(0, 80), description: String(b.label || 'Saved from Studio.').slice(0, 200), author: 'you', license: 'Apache-2.0',
      extends: base ? base.extends : 'aigent', style: { ...(base ? base.style || {} : {}), ...(comp.effects.length ? { effectsFavourites: comp.effects } : {}) }, locks: { ...(base ? base.locks || {} : {}), ...comp.locks }, ...(base && base.weights ? { weights: base.weights } : {}) };
    C.fitStyle(pack);
    const errs = K.validate(pack); if (errs.length) return json(res, 400, { error: errs.join('; ') });
    const dir = join(K.LOCAL, name); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
    writeFileSync(join(dir, 'README.md'), `# ${name}\n\n${pack.label}\n\nSaved from Studio. Use it: npm run reel -- <clip> --pack ${name}. Preview it: npm run pack:preview -- ${name}.\n`);
    C.catalog({ fresh: true });
    const st = update(x => { x.pack = name; });
    return json(res, 200, { ok: true, pack: name, path: `packs/local/${name}/pack.json`, ...view(st) });
  }
  if (p === '/api/chat' && M === 'POST') {
    const b = await readBody(req), text = String(b.text || '').trim();
    if (!text) return json(res, 400, { error: 'say something' });
    update(s => { C.applyPatch(s, { say: text, from: 'ui' }); });
    const s = C.load(), cat = C.catalog();
    let reply, patch, via;
    if (LLM.provider() && !b.offline) {
      try { const r = await LLM.chat(text, s, cat); reply = r.reply; patch = r.patch; via = r.provider; }
      catch (e) { const v = C.vibes(text, s, cat); patch = v.patch; via = 'keywords'; reply = `The ${LLM.provider().name} API failed (${e.message}), so I used the keyword matcher. ` + (v.said.length ? 'Changed: ' + v.said.join('; ') + '.' : 'Nothing matched.'); }
    } else {
      const v = C.vibes(text, s, cat); patch = v.patch; via = 'keywords';
      reply = v.said.length ? `Changed: ${v.said.join('; ')}.` : 'I did not catch an effect or vibe there. Try words like calm, punchy, cinematic, clean, or names like "no glitch" or "typewriter titles". For a full conversation, ask Claude Code, Cursor or Codex through MCP, or set ANTHROPIC_API_KEY or OPENAI_API_KEY before npm run studio.';
    }
    const s2 = C.load(), r = C.applyPatch(s2, patch || {});
    if (r.errs.length) reply += ' Skipped: ' + r.errs.join('; ');
    C.applyPatch(s2, { reply, from: via }); C.save(s2); pushState();
    return json(res, 200, { reply, via, log: r.log, errs: r.errs, ...view(s2) });
  }
  if (p === '/api/reset' && M === 'POST') { const s = C.defaultState(); s.rev = C.load().rev; C.save(s); pushState(); return json(res, 200, view(s)); }
  return json(res, 404, { error: 'no such endpoint' });
}

const server = http.createServer(async (req, res) => {
  try {
    // only this computer: refuse other hosts (DNS rebinding) and cross-site posts
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return json(res, 403, { error: 'Studio only answers on localhost' });
    if (req.method !== 'GET' && req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)) return json(res, 403, { error: 'cross-site request refused' });
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname.startsWith('/api/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: state\ndata: ${JSON.stringify(view(C.load()))}\n\n`); clients.add(res);
      const ka = setInterval(() => res.write(': ka\n\n'), 20e3); req.on('close', () => { clearInterval(ka); clients.delete(res); }); return;
    }
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (u.pathname === '/' || u.pathname === '/index.html') return serveFile(req, res, join(STUDIO, 'public', 'index.html'));
    if (/^\/(app\.js|app\.css|favicon\.svg)$/.test(u.pathname)) return serveFile(req, res, join(STUDIO, 'public', u.pathname.slice(1)));
    if (u.pathname.startsWith('/files/')) {
      const relp = decodeURIComponent(u.pathname.slice(7));
      const abs = resolve(ROOT, relp);
      if (!abs.startsWith(ROOT + sep) || relp.includes('..') || !SERVE.some(d => relp.startsWith(d)) || /(^|\/)\.studio\//.test(relp)) return json(res, 403, { error: 'not served' });
      return serveFile(req, res, abs);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message }); }
});

watchFile(C.statePath(), { interval: 400 }, pushState);
function openBrowser(url) {
  if (flag('no-open') || process.env.CI) return;
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
}
// double-clicking the launcher twice: if Studio already runs on this port, open it instead of failing
server.on('error', async e => {
  if (e.code !== 'EADDRINUSE') throw e;
  const url = `http://${HOST}:${PORT}`;
  try {
    const r = await fetch(url + '/api/state', { signal: AbortSignal.timeout(3000) });
    if (r.ok && (await r.json()).state) { console.log(`Studio is already running: ${url}`); openBrowser(url); process.exit(0); }
  } catch {}
  console.error(`Port ${PORT} is in use by another program. Start Studio on another port: npm run studio -- --port 4758`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${server.address().port}`;
  console.log(`Studio: ${url}\nSession: ${C.statePath()}\nChat: ${env().llm ? 'direct API, ' + env().llm : 'keywords here; for a full conversation use your assistant over MCP (npm run mcp) or set ANTHROPIC_API_KEY or OPENAI_API_KEY'}\nStop with Ctrl+C.`);
  openBrowser(url);
});
export { server };
