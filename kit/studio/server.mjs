// Studio: a local web page over the kit. Drop in footage and a reference, click effects from a visual menu, set the
// music and pace, chat the vibe, read what was picked and why, render and download. Everything runs on this computer;
// the page only talks to this server, and this server only runs the kit's own commands (reel, teardown, choices, fx).
//   npm run studio                    -> http://127.0.0.1:4757 opens in your browser
//   npm run studio -- --port 5000 --no-open
// The session lives in jobs/.studio/state.json (STUDIO_DIR to move it). The MCP tools studio_get_state and
// studio_set_selections read and write the same file, and the page updates live when they do.
import http from 'http';
import { spawn } from 'child_process';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, watchFile, writeFileSync } from 'fs';
import { join, extname, basename, resolve, sep } from 'path';
import { createRequire } from 'module';
import * as C from './core.mjs';
import * as LLM from './llm.mjs';
import * as S from './settings.mjs';
import * as F from './fetch.mjs';
import * as CH from './channel.mjs';
import * as AG from './agui.mjs';
import * as RV from './review.mjs';
import * as REC from './record.mjs';
import * as SC from './scripts.mjs';
import * as AGT from './agents.mjs';
import * as CL from './cloud.mjs';
import * as SETUP from '../setup.mjs';

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
const send = (ev, data) => { const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); if (ev !== 'log') aguiTick(); };
// AG-UI observers (kit/studio/agui.mjs): the same session as AG-UI events
const aguiClients = new Set();
function aguiTick() { if (!aguiClients.size) return; const s = C.load(); for (const c of aguiClients) for (const ev of c.obs.next(s, task)) c.res.write(AG.encode(ev)); }
let lastRev = -1;
const pushState = force => { const s = C.load(); if (s.rev !== lastRev || force === true) { lastRev = s.rev; send('state', view(s)); } };
const update = fn => { const s = C.load(); const r = fn(s); C.save(s); pushState(); return r === undefined ? s : r; };

// ---------- setup check (kit/setup.mjs): cached, refreshed in the background, so a page load never waits on it ----------
let setupCache = null, setupAt = 0;
function setupStatus(fresh) {
  if (fresh || !setupCache || Date.now() - setupAt > 5 * 60e3) { try { setupCache = SETUP.status(); } catch (e) { setupCache = { ready: false, items: [], missing: 0, forUser: [], error: e.message }; } setupAt = Date.now(); }
  return setupCache;
}
// only what is missing: { id: fix } and whether the core is ready
function setupBrief() {
  if (!setupCache) return null;
  return { ready: setupCache.ready, missing: Object.fromEntries(setupCache.items.filter(x => x.status !== 'ready').map(x => [x.id, { label: x.label, fix: x.fix, feature: x.feature, need: x.need }])) };
}
// a draft or render that cannot work: the one-line fix now, instead of a failure later
function needFor(kind) {
  const b = setupBrief(), miss = b ? b.missing : {};
  if (!miss.ffmpeg && !F.tools().ffmpeg) miss.ffmpeg = { label: 'ffmpeg', fix: 'npm run setup:all' };
  const need = kind === 'render' ? ['ffmpeg', 'python', 'chrome', 'npm'] : ['ffmpeg', 'python', 'npm'];
  const m = need.map(k => miss[k]).filter(Boolean);
  return m.length ? `${m.map(x => x.label).join(', ')} missing. Fix: ${m.map(x => x.fix).join('; ')}` : null;
}

// ---------- footage from links (kit/studio/cloud.mjs): Dropbox, Google Drive, plain video URLs ----------
if (process.env.STUDIO_CLOUD_DRIVE) CL.BASES.drive = process.env.STUDIO_CLOUD_DRIVE;
if (process.env.STUDIO_CLOUD_DROPBOX) CL.BASES.dropbox = process.env.STUDIO_CLOUD_DROPBOX;
const imports = new Map(); // id -> AbortController
const setImport = (id, fn) => update(st => { const it = (st.imports || []).find(x => x.id === id); if (it) fn(it, st); });
function addFootageLink(raw) {
  const s0 = C.load(); if (!s0.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  const p = CL.parse(raw); if (!p.ok) throw Object.assign(new Error(p.error), { code: 400 });
  const dir = join('inbox', 'studio', s0.job);
  const id = update(st => { st.imports = (st.imports || []).slice(-19); const id = (st.importSeq = (st.importSeq || 0) + 1);
    st.imports.push({ id, url: String(raw).trim(), site: p.site, status: 'downloading', received: 0, size: null, name: p.name, file: null, error: null, at: new Date().toISOString() }); return id; });
  const ac = new AbortController(); imports.set(id, ac);
  let lastSave = 0;
  mkdirSync(join(ROOT, dir), { recursive: true });
  CL.download(p, join(ROOT, dir), { signal: ac.signal, maxBytes: +(process.env.STUDIO_FOOTAGE_MAX_BYTES || 20e9), onProgress: ({ received, size }) => {
    const now = Date.now(); if (now - lastSave < 700 && received !== size) return; lastSave = now;
    setImport(id, x => { x.received = received; x.size = size; });
  } }).then(r => {
    const relp = `${dir}/${r.name}`.split(sep).join('/');
    setImport(id, (x, st) => { Object.assign(x, { status: 'ready', file: relp, name: r.name, received: r.size, size: r.size }); if (!st.footage.includes(relp)) st.footage.push(relp); st.clips = null; });
  }).catch(e => setImport(id, x => { x.status = e.name === 'AbortError' ? 'cancelled' : 'failed'; x.error = e.name === 'AbortError' ? null : e.message; }))
    .finally(() => imports.delete(id));
  return id;
}

function env() {
  const st = S.load(), backend = st.chat.backend, p = backend === 'agent' || backend === 'keywords' ? null : LLM.provider(process.env, st.chat);
  const t = F.tools();
  return { llm: p ? `${p.name}${p.model ? ' (' + p.model + ')' : ''}` : null, backend, agent: CH.presence(), effectsReady: existsSync(join(ROOT, 'effects', '.venv')), port: PORT,
    settings: { downloads: st.downloads, renders: st.renders, actionNotes: st.actionNotes, agent: st.agent, chat: st.chat, from: st.from, defaultDownloads: 'teardown-in/studio/<job>/ (in the kit, not shared)', defaultRenders: 'jobs/<job>/ (in the kit)' },
    keys: { anthropic: !!process.env.ANTHROPIC_API_KEY, openai: !!process.env.OPENAI_API_KEY }, localPresets: S.LOCAL_PRESETS,
    tools: { ytdlp: t.ytdlp ? t.ytdlp.version : null, instaloader: t.instaloader, ffmpeg: t.ffmpeg }, install: F.INSTALL, setup: setupBrief() };
}
function view(s) {
  let comp; try { comp = C.compose(s, { refPack: refPackName(s) }); } catch (e) { comp = { args: [], errs: [e.message], notes: [] }; }
  let scripts = []; try { scripts = SC.list(s.job); } catch {}
  return { state: s, compose: comp, outputs: C.outputsOf(s), scripts, env: env(), swap: swapOf(s), cleanupReady: !!(s.job && existsSync(clipsJsonPath(s))), task: task && { id: task.id, kind: task.kind, status: task.status, ...(task.cancel && task.status === 'running' ? { cancelling: true } : {}), startedAt: task.startedAt, endedAt: task.endedAt, lines: task.lines.slice(-12), result: task.result || null } };
}

// ---------- tasks (one at a time) ----------
let task = null, seq = 0;
function runTask(kind, steps, done, hooks = {}) {
  if (task && task.status === 'running') throw Object.assign(new Error(`busy: ${task.kind} is running`), { code: 409 });
  task = { id: ++seq, kind, status: 'running', startedAt: Date.now(), lines: [], proc: null };
  const me = task;
  const log = l => { for (const x of String(l).split(/\r?\n/)) if (x.trim()) { me.lines.push(x.slice(0, 400)); if (me.lines.length > 400) me.lines.shift(); send('log', { id: me.id, line: x.slice(0, 400) }); if (hooks.line) try { hooks.line(x); } catch {} } };
  update(s => { s.task = { id: me.id, kind, status: 'running' }; });
  (async () => {
    let out = '';
    let si = 0;
    const list = [...steps()];
    for (const [script, args, stepEnv] of list) {
      if (me.cancel) { me.status = 'cancelled'; return; }
      if (hooks.step) try { hooks.step(si); } catch {}
      si++;
      log(`$ node ${script} ${args.map(a => /\s/.test(a) ? JSON.stringify(a) : a).join(' ')}`);
      const code = await new Promise(res => {
        const p = spawn(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env: { ...process.env, ...(stepEnv || {}) } });
        me.proc = p;
        p.stdout.on('data', d => { out += d; log(d); }); p.stderr.on('data', d => log(d));
        p.on('close', c => res(c)); p.on('error', e => { log(e.message); res(1); });
      });
      if (me.cancel) {
        // a cancel that lands after the last step finished, or after it wrote its video (assemble prints "wrote <file>
        // len <s>"), does not throw the finished result away: the task ends done, not cancelled. Until the step exits
        // the task still reads running (cancelling: true), so the page never flashes "cancelled" for a kept result.
        const wrote = me.lines.map(l => /^wrote (.+\.(?:mp4|mov)) len /.exec(l)).filter(Boolean).pop();
        if (si === list.length && (code === 0 || (wrote && existsSync(resolve(ROOT, wrote[1]))))) { log('finished before the cancel landed; kept the result'); break; }
        else { me.status = 'cancelled'; return; }
      }
      if (code !== 0) { me.status = 'failed'; me.result = { code }; break; }
    }
    if (me.status === 'running') { me.status = 'done'; try { me.result = (await done(out)) || {}; } catch (e) { me.status = 'failed'; log('error: ' + e.message); } }
  })().finally(() => { me.endedAt = Date.now(); if (hooks.end) try { hooks.end(me.status, me.lines); } catch (e) { log('error: ' + e.message); } update(s => { s.task = { id: me.id, kind, status: me.status }; s.outputs = C.outputsOf(s); }); send('task', { id: me.id, status: me.status }); setImmediate(pump); });
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
  const cl = cleanupFor(s), src = cl ? ['--clips', relOf(clipsDirOf(s)), '--cleanup', cl] : s.clips ? ['--clips', s.clips] : s.footage;
  // takes filmed from a script: hand the script to Whisper as a hint (TX_PROMPT, kit/tx.py and kit/clip.py), so captions spell its words
  const said = (s.takes || []).filter(t => t.script && t.script.text && s.footage.includes(t.file)).map(t => t.script.text.replace(/\[[a-z]+\]/gi, ' ').replace(/\s+/g, ' ').trim());
  const stepEnv = said.length && !process.env.TX_PROMPT ? { TX_PROMPT: [...new Set(said)].join(' ').slice(0, 800) } : {};
  return { steps: [['kit/reel.cjs', [...src, '--name', s.job, '--force', '--draft', '--json', ...args, ...(process.env.STUDIO_REEL_ARGS ? process.env.STUDIO_REEL_ARGS.split(' ') : [])], stepEnv]], lockString: comp.lockString, txPrompt: stepEnv.TX_PROMPT || null };
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
// ---------- review: what to swap, the clean-up pass, comments on the preview (kit/studio/review.mjs) ----------
let swapCache = { key: '', val: null };
function swapOf(s) {
  const r = s.reference; if (!r || !r.extracted || !r.out) return null;
  const f = join(ROOT, r.out, 'Reel.md'); let key;
  try { key = f + statSync(f).mtimeMs; } catch { return null; }
  if (swapCache.key !== key) { try { swapCache = { key, val: RV.swapList(f, C.catalog()) }; } catch (e) { swapCache = { key, val: { error: e.message, parts: [] } }; } }
  return swapCache.val;
}
// the clip.py folder the draft used: the session's clips folder, or the job's own clips/
const clipsDirOf = s => s.clips ? resolve(ROOT, s.clips) : join(ROOT, 'jobs', s.job || '-', 'clips');
const clipsJsonPath = s => join(clipsDirOf(s), 'clips.json');
const cleanupFile = s => join('jobs', s.job, 'cleanup.json');
const footageKey = s => JSON.stringify([s.footage, s.clips]);
// the clean-up plan the next draft uses: only while it is on and the footage is the footage it was made from
function cleanupFor(s) {
  const c = s.cleanup;
  if (!s.job || !c || !c.on || c.footage !== footageKey(s) || !existsSync(clipsJsonPath(s)) || !existsSync(join(ROOT, cleanupFile(s)))) return null;
  return cleanupFile(s);
}
function cleanupView(s, silence) {
  let cj; try { cj = JSON.parse(readFileSync(clipsJsonPath(s), 'utf8')); } catch { return { ready: false, items: [] }; }
  const c = s.cleanup || {}, sil = +(silence || c.silence || 0.7);
  const items = RV.cleanup(cj, { silence: sil }), dec = c.decisions || {};
  for (const it of items) if (dec[it.id] !== undefined) it.remove = !!dec[it.id];
  const rel = relOf(join(clipsDirOf(s), 'x')).replace(/\/x$/, ''), served = rel.startsWith('jobs/') || rel.startsWith('inbox/studio/');
  const clips = Object.fromEntries((cj.clips || []).map(x => [x.id, { file: served ? `${rel}/${basename(x.file)}` : null, dur: +x.dur, status: x.status, text: x.text }]));
  return { ready: true, silence: sil, items, clips, on: !!cleanupFor(s), stale: !!(c.on && c.footage !== footageKey(s)), plan: RV.plan(items, {}, cj) };
}
const readChoices = s => { try { return JSON.parse(readFileSync(choicesPath(s), 'utf8')); } catch { return null; } };
function receiptOf(s, ch) {
  const r = RV.receipt(ch); if (!r) return null;
  let pl = null;
  if (cleanupFor(s)) try { pl = JSON.parse(readFileSync(join(ROOT, cleanupFile(s)), 'utf8')); } catch {}
  if (pl) { const n = Object.values(pl.cuts || {}).reduce((a, l) => a + l.length, 0); r.sections.splice(1, 0, { h: 'Clean-up', rows: [{ at: null, what: `${n} cut${n === 1 ? '' : 's'} inside clips, ${pl.saved} s out${pl.keep.length ? `, ${pl.keep.length} retake${pl.keep.length === 1 ? '' : 's'} kept` : ''}`, why: 'your clean-up review' }] }); r.text += `\n\nClean-up\n- ${n} cuts inside clips, ${pl.saved} s out. Why: your clean-up review.`; }
  return r;
}

function teardownSteps(s, url) {
  if (!s.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  const out = join('teardown', `studio-${s.job}`);
  const args = url ? ['--url', url] : [s.reference.file];
  if (!url && !s.reference.file) throw Object.assign(new Error('add a reference video or a link first'), { code: 400 });
  args.push('--out', out, '--name', `studio-${s.job}`);
  if (process.env.STUDIO_TEARDOWN_ARGS) args.push(...process.env.STUDIO_TEARDOWN_ARGS.split(' '));
  return { steps: [['kit/teardown.mjs', args]], out };
}

// ---------- reference links: a queue, one download and teardown at a time ----------
const TEARDOWN = process.env.STUDIO_TEARDOWN || 'kit/teardown.mjs';
const relOf = p => (p.startsWith(ROOT + sep) ? p.slice(ROOT.length + 1) : p).split(sep).join('/');
function refDir(s) { const st = S.load(); return st.downloads ? join(st.downloads, s.job) : join(ROOT, 'teardown-in', 'studio', s.job); }
const setItem = (id, fn) => update(st => { const it = (st.reference.queue || []).find(x => x.id === id); if (it) fn(it, st); });
function useItem(st, it) {
  st.reference = { ...st.reference, active: it.id, file: it.file, url: it.url, status: 'ready', out: it.out, extracted: it.extracted, contact: it.contact || null, applied: false };
}
function addLinks(urls) {
  const s0 = C.load(); if (!s0.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  const list = [...new Set(urls.map(u => String(u || '').trim()).filter(Boolean))].slice(0, 20);
  if (!list.length) throw Object.assign(new Error('paste one or more links'), { code: 400 });
  const added = [];
  update(st => {
    const q = st.reference.queue || (st.reference.queue = []);
    for (const url of list) {
      const c = F.classify(url), id = (st.refSeq = (st.refSeq || 0) + 1);
      const miss = c.ok ? F.missingFor(c) : null;
      const it = { id, url: c.url || url, site: c.site || null, via: c.via || null, status: c.ok && !miss ? 'queued' : 'failed', progress: 0, error: c.ok ? miss : c.error, hint: miss || null, at: new Date().toISOString() };
      q.push(it); added.push(it);
    }
    if (q.length > 30) st.reference.queue = q.slice(-30);
  });
  setImmediate(pump);
  return added;
}
function pump() {
  if (task && task.status === 'running') return;
  const s = C.load(), it = (s.reference.queue || []).find(x => x.status === 'queued');
  if (!it || !s.job) return;
  const dir = refDir(s), file = join(dir, `ref-${it.id}.mp4`), out = join('teardown', `studio-${s.job}-r${it.id}`);
  const max = String(+(process.env.STUDIO_REF_MAX_SECONDS || F.DEFAULT_MAX_SECONDS));
  let lastP = -1, title = null;
  setItem(it.id, x => { x.status = 'downloading'; x.progress = 0; x.error = null; x.file = file; x.out = out.split(sep).join('/'); });
  try {
    runTask('reference', () => [['kit/studio/fetch.mjs', [it.url, '--out', file, '--max-seconds', max, '--json']],
      [TEARDOWN, [file, '--out', out, '--name', `studio-${s.job}-r${it.id}`, ...(process.env.STUDIO_TEARDOWN_ARGS ? process.env.STUDIO_TEARDOWN_ARGS.split(' ') : [])]]], () => {
      const recipe = join(ROOT, out, 'Reel.md');
      if (!existsSync(recipe)) throw new Error('teardown wrote no Reel.md');
      const ex = C.extract(recipe);
      setItem(it.id, (x, st) => { x.status = 'ready'; x.progress = 100; x.extracted = ex; x.contact = existsSync(join(ROOT, out, 'contact.jpg')) ? `${out}/contact.jpg`.split(sep).join('/') : null; if (title) x.title = title;
        if (!st.reference.active || st.reference.active === x.id || !(st.reference.queue || []).some(q => q.id === st.reference.active && q.status === 'ready')) useItem(st, x); });
      return { extracted: ex };
    }, {
      step: i => { if (i === 1) setItem(it.id, x => { x.status = 'tearing'; x.progress = 100; }); },
      line: l => {
        const m = /^progress (\d+)%/.exec(l); if (m && +m[1] !== lastP && (+m[1] - lastP >= 5 || +m[1] === 100)) { lastP = +m[1]; setItem(it.id, x => { if (x.status === 'downloading') x.progress = lastP; }); }
        if (l.startsWith('{"file"')) { try { const j = JSON.parse(l); title = j.title; setItem(it.id, x => { x.title = j.title; x.seconds = j.seconds; x.trimmed = j.trimmed; }); } catch {} }
      },
      end: (status, lines) => { if (status !== 'done') setItem(it.id, x => { if (x.status !== 'ready') { x.status = status === 'cancelled' ? 'cancelled' : 'failed'; const e = lines.filter(l => /download failed|error|Error|failed|not found/i.test(l) && !l.startsWith('$')).pop(); x.error = (e || lines[lines.length - 1] || 'failed').replace(/^download failed: /, '').slice(0, 300); } }); },
    });
  } catch (e) { setItem(it.id, x => { x.status = 'failed'; x.error = e.message; }); }
}
function copyRenders(outputs) {
  const st = S.load(); if (!st.renders) return [];
  const done = [];
  for (const o of outputs) { const src = join(ROOT, o), dst = join(st.renders, basename(o)); try { copyFileSync(src, dst); done.push(dst); } catch {} }
  return done;
}

// one Studio chat turn from the page or an AG-UI run: queue it for the terminal agent, or answer with a model or keywords
const SCRIPT_ASK = /\b(script|rewrite|teleprompter)\b/i;
const SCRIPT_NOTE = 'Writing scripts needs your terminal agent, an API key or a local model (Settings). Keywords mode only changes effects.';
async function chatTurn(text, offline, attach) {
  const st = S.load(), backend = offline ? 'keywords' : st.chat.backend;
  if (backend === 'agent') {
    // queued for the terminal agent; it reads it with studio_wait_for_message or studio_get_pending and answers with studio_reply
    const s = update(x => { C.applyPatch(x, { say: text, from: 'ui', toAgent: true, attach }); });
    const a = CH.presence();
    return { via: 'agent', queued: true, agent: a, reply: null, ...view(s) };
  }
  update(s => { C.applyPatch(s, { say: text, from: 'ui', attach }); });
  const s = C.load(), cat = C.catalog();
  let reply, patch, via;
  const prov = backend === 'keywords' ? null : LLM.provider(process.env, st.chat);
  if (prov) {
    try {
      const r = await LLM.chat(text, s, cat, process.env, st.chat, SC.list(s.job)); reply = r.reply; patch = r.patch; via = r.provider;
      if (r.script && r.script.text && s.job) { const sc = SC.write(s.job, { id: r.script.id && SC.list(s.job).some(x => x.id === r.script.id) ? r.script.id : undefined, title: r.script.title, text: String(r.script.text).replace(/\u2014/g, ', '), by: r.model || r.provider }); update(x => { x.scriptsAt = Date.now(); }); reply = (reply ? reply + ' ' : '') + `Saved as the script "${sc.title}" (${sc.words} words, about ${sc.seconds} s).`; }
    }
    catch (e) { const v = C.vibes(text, s, cat); patch = v.patch; via = 'keywords'; reply = `The ${prov.name} chat failed (${e.message}), so I used the keyword matcher. ` + (v.said.length ? 'Changed: ' + v.said.join('; ') + '.' : 'Nothing matched.'); }
  } else {
    const v = C.vibes(text, s, cat); patch = v.patch; via = 'keywords';
    if (SCRIPT_ASK.test(text) && !v.said.length) { const s3 = C.load(); C.applyPatch(s3, { reply: SCRIPT_NOTE, from: 'keywords' }); C.save(s3); pushState(); return { reply: SCRIPT_NOTE, via, ...view(s3) }; }
    reply = v.said.length ? `Changed: ${v.said.join('; ')}.` : 'I did not catch an effect or vibe there. Try words like calm, punchy, cinematic, clean, names like "no glitch" or "typewriter titles", or "the transitions from the reference". For a real conversation, connect your terminal agent (Settings, Chat).';
    if (backend !== 'keywords' && !prov) reply = `No ${backend === 'auto' ? 'API key' : backend} backend is ready, so I used keywords. ` + reply;
  }
  const s2 = C.load(), r = C.applyPatch(s2, patch || {});
  if (r.errs.length) reply += ' Skipped: ' + r.errs.join('; ');
  C.applyPatch(s2, { reply, from: via }); C.save(s2); pushState();
  return { reply, via, log: r.log, errs: r.errs, ...view(s2) };
}

// ---------- http ----------
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req, max = 2e6) => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > max) { bad(new Error('too big')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(Object.assign(new Error('send JSON'), { code: 400 })); } }); });
const readRaw = (req, max) => new Promise((ok, bad) => { const parts = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { bad(Object.assign(new Error('chunk too big'), { code: 413 })); req.destroy(); } else parts.push(d); }); req.on('end', () => ok(Buffer.concat(parts))); req.on('error', bad); });
const safeName = n => basename(String(n || 'file')).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'file';

function serveFile(req, res, file) {
  let st; try { st = statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return json(res, 404, { error: 'not found' });
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': file.includes(sep + 'jobs' + sep) ? 'no-store' : file.startsWith(join(STUDIO, 'public') + sep) ? 'no-cache' : 'max-age=300' };
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
    if (kind === 'brand') {
      // a brand mark for keyword logos (kit/brands.cjs): kept with the Studio state, for every job; word=<the word>
      const word = String(u.searchParams.get('word') || '').trim().slice(0, 40);
      if (!word) return json(res, 400, { error: 'brand: say which word shows it (word=Skool)' });
      if (!['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(ext)) return json(res, 400, { error: 'brand: .svg, .png, .webp or .jpg files' });
      mkdirSync(C.brandsDir(), { recursive: true });
      await new Promise((ok, bad) => { const w = createWriteStream(join(C.brandsDir(), name)); req.pipe(w); w.on('finish', ok); w.on('error', bad); req.on('error', bad); });
      const s = update(st => { st.brands = (st.brands || []).filter(x => x.word.toLowerCase() !== word.toLowerCase()).concat({ word, logo: name }); });
      return json(res, 200, { ok: true, path: name, ...view(s) });
    }
    if (!['footage', 'reference', 'music'].includes(kind)) return json(res, 400, { error: 'kind: footage, reference, music or brand' });
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
  // Record now (kit/studio/record.mjs): start, numbered chunks while filming, finish converts to mp4
  if (p === '/api/record/start' && M === 'POST') { const b = await readBody(req); const id = update(st => REC.start(st, b)); return json(res, 200, { id, ...view(C.load()) }); }
  if (p === '/api/record/chunk' && M === 'POST') {
    const id = +u.searchParams.get('id'), sq = +u.searchParams.get('seq');
    const buf = await readRaw(req, REC.MAX_CHUNK);
    try { return json(res, 200, REC.chunk(id, sq, buf)); } catch (e) { return json(res, e.code || 500, { error: e.message, ...(e.next != null ? { next: e.next } : {}) }); }
  }
  if (p === '/api/record/finish' && M === 'POST') {
    const b = await readBody(req), id = +b.id;
    try { REC.finish(id, b, fn => update(fn)); } catch (e) { return json(res, e.code || 500, { error: e.message }); }
    return json(res, 202, { id, ...view(C.load()) });
  }
  if (p === '/api/record/abort' && M === 'POST') { const b = await readBody(req); const s = update(st => { REC.abort(st, +b.id); }); return json(res, 200, view(s)); }
  if (p === '/api/record/take' && M === 'POST') { const b = await readBody(req); try { const s = update(st => { REC.act(st, +b.id, b.action); }); return json(res, 200, view(s)); } catch (e) { return json(res, e.code || 500, { error: e.message }); } }
  if (p === '/api/record/takes' && M === 'GET') return json(res, 200, { takes: REC.list(C.load()) });
  // Scripts (kit/studio/scripts.mjs): per job, in jobs/.studio/scripts/<job>/
  if (p.startsWith('/api/scripts')) {
    const job = C.load().job, touch = () => update(st => { st.scriptsAt = Date.now(); });
    try {
      if (p === '/api/scripts' && M === 'GET') return json(res, 200, { scripts: SC.list(job) });
      if (p === '/api/scripts/get' && M === 'GET') return json(res, 200, { script: SC.get(job, u.searchParams.get('id')) });
      if (!job) return json(res, 400, { error: 'name the reel first' });
      if (p === '/api/scripts' && M === 'POST') { const b = await readBody(req); const sc = SC.write(job, { id: b.id, title: b.title, text: b.text, wpm: b.wpm, by: b.id ? undefined : 'you' }); touch(); return json(res, 200, { script: sc, ...view(C.load()) }); }
      if (p === '/api/scripts/action' && M === 'POST') {
        const b = await readBody(req); let sc = null;
        if (b.action === 'delete') SC.remove(job, b.id); else if (b.action === 'duplicate') sc = SC.duplicate(job, b.id); else if (b.action === 'rename') sc = SC.rename(job, b.id, b.title);
        else return json(res, 400, { error: 'action: delete, duplicate or rename' });
        touch(); return json(res, 200, { script: sc, ...view(C.load()) });
      }
      if (p === '/api/scripts/from-reference' && M === 'POST') {
        const b = await readBody(req), s = C.load(), ref = C.refContext(s).active;
        if (!ref) return json(res, 400, { error: 'break down a reference first' });
        const ask = `Write a script from this reference${b.topic ? ' about ' + String(b.topic).slice(0, 300) : ''}: match its structure, hook, pacing and beat timestamps, ${Math.round(ref.seconds || (ref.summary && ref.summary.seconds) || 30) || 30} seconds long. Save it with write_script.\nReference teardown: ${JSON.stringify(ref).slice(0, 6000)}`;
        return json(res, 200, await chatTurn(ask));
      }
    } catch (e) { return json(res, e.code || 500, { error: e.message }); }
  }
  if (p === '/api/footage/url' && M === 'POST') { const b = await readBody(req); const id = addFootageLink(b.url); return json(res, 202, { id, ...view(C.load()) }); }
  if (p === '/api/footage/import' && M === 'POST') {
    const b = await readBody(req), id = +b.id;
    if (b.action === 'cancel') { const ac = imports.get(id); if (ac) ac.abort(); }
    else if (b.action === 'dismiss') update(st => { st.imports = (st.imports || []).filter(x => x.id !== id || x.status === 'downloading'); });
    else return json(res, 400, { error: 'action: cancel or dismiss' });
    return json(res, 200, view(C.load()));
  }
  if (p === '/api/connect' && M === 'GET') {
    const url = `http://${req.headers.host}`;
    return json(res, 200, { agents: AGT.setups({ url }), prompt: AGT.setupPrompt({ url }), selected: S.load().agent, agent: CH.presence(), name: AGT.NAME, say: AGT.SAY });
  }
  if (p === '/api/setup' && M === 'GET') { const st = setupStatus(u.searchParams.has('fresh')); return json(res, 200, st); }
  // Install next to a "not installed" pill: the same pip line as setup (kit/setup.mjs --only), in the kit's Python, then
  // a fresh look at the tools, so the page updates without a restart
  if (p === '/api/tools/install' && M === 'POST') {
    const b = await readBody(req), step = { ytdlp: 'ytdlp', instaloader: 'ytdlp', model: 'model', effects: 'effects' }[b.tool];
    if (!step) return json(res, 400, { error: 'tool: ytdlp, instaloader, model or effects' });
    runTask('install', () => [[process.env.STUDIO_SETUP || 'kit/setup.mjs', ['--only', step]]], () => { const t = F.tools({ fresh: true }); setupStatus(true); return { tool: b.tool, ytdlp: t.ytdlp ? t.ytdlp.version : null, instaloader: t.instaloader }; });
    return json(res, 202, view(C.load()));
  }
  if (p === '/api/footage/remove' && M === 'POST') { const b = await readBody(req); const s = update(st => { st.footage = st.footage.filter(f => f !== b.path); }); return json(res, 200, view(s)); }
  if (p === '/api/reference' && M === 'POST') {
    const b = await readBody(req), s = C.load();
    if (b.url || b.urls) { const added = addLinks([].concat(b.urls || [], b.url || [])); return json(res, 202, { added, ...view(C.load()) }); }
    const t = teardownSteps(s, null);
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
  if (p === '/api/reference/url' && M === 'POST') {
    const b = await readBody(req);
    if (b.mode) update(st => { C.applyPatch(st, { reference: { mode: b.mode } }); });
    const added = addLinks([].concat(b.urls || [], b.url || []).flatMap(x => String(x).split(/\n+/)));
    return json(res, 202, { added, ...view(C.load()) });
  }
  if (p === '/api/reference/item' && M === 'POST') {
    const b = await readBody(req), id = +b.id, s = C.load(), it = (s.reference.queue || []).find(x => x.id === id);
    if (!it) return json(res, 404, { error: `no reference ${id}` });
    if (b.action === 'use') { if (it.status !== 'ready') return json(res, 400, { error: 'that reference is not broken down yet' }); update(st => useItem(st, st.reference.queue.find(x => x.id === id))); }
    else if (b.action === 'retry') { if (['downloading', 'tearing'].includes(it.status)) return json(res, 409, { error: 'it is running' }); setItem(id, x => { x.status = 'queued'; x.error = null; x.progress = 0; const c = F.classify(x.url); const miss = c.ok ? F.missingFor(c, F.tools({ fresh: true })) : c.error; if (miss) { x.status = 'failed'; x.error = miss; } }); setImmediate(pump); }
    else if (b.action === 'remove') {
      if (['downloading', 'tearing'].includes(it.status) && task && task.status === 'running' && task.kind === 'reference') { task.cancel = true; task.proc && task.proc.kill('SIGTERM'); }
      if (it.file && b.deleteFile !== false) rmSync(it.file, { force: true });
      update(st => { st.reference.queue = st.reference.queue.filter(x => x.id !== id); if (st.reference.active === id) st.reference = { ...st.reference, active: null, file: null, url: null, status: 'none', out: null, extracted: null, applied: false, contact: null }; });
    } else return json(res, 400, { error: 'action: use, retry or remove' });
    return json(res, 200, view(C.load()));
  }
  if (p === '/api/reference/apply' && M === 'POST') {
    const s = C.load(), ex = s.reference.extracted; if (!ex) return json(res, 400, { error: 'tear down a reference first' });
    const b = await readBody(req).catch(() => ({})), cat = C.catalog();
    const picks = Array.isArray(b.refs) ? Object.fromEntries(b.refs.filter(r => cat.items[r]).map(r => [r, 'allow'])) : C.referencePicks(ex, b.kinds || null, cat);
    const patch = { picks, ...(ex.music.bed && cat.beds.some(b => b.id === ex.music.bed) ? { music: { bed: ex.music.bed } } : {}), ...(ex.preset && cat.packs.some(x => x.name === ex.preset) ? { pack: ex.preset } : {}) };
    if (Array.isArray(b.refs) || b.kinds) { delete patch.music; delete patch.pack; }
    const r = C.applyPatch(s, patch); s.reference.applied = true; C.save(s); pushState();
    return json(res, 200, { ...view(s), log: r.log, errs: r.errs });
  }
  if (p === '/api/draft' && M === 'POST') {
    const s = C.load(); const d = draftSteps(s); // checks the footage first, so an empty job says that before a missing tool
    const miss = needFor('draft'); if (miss) return json(res, 400, { error: miss, setup: true });
    update(st => { st.lockedAtDraft = d.lockString || ''; });
    runTask('draft', () => d.steps, () => ({ choices: !!readChoices(C.load()) }));
    return json(res, 202, view(C.load()));
  }
  if (p === '/api/render' && M === 'POST') {
    const s = C.load(); const r = renderSteps(s);
    const miss = needFor('render'); if (miss) return json(res, 400, { error: miss, setup: true });
    runTask('render', () => r.steps, () => { const st = C.load(), outputs = C.outputsOf(st); return { outputs, copiedTo: copyRenders(outputs), fx: r.fx, effects: r.effects }; });
    return json(res, 202, { ...view(C.load()), fx: r.fx, effectsSkipped: r.effects.length && !r.fx ? 'effects need npm run effects:setup' : null });
  }
  if (p === '/api/task/cancel' && M === 'POST') { if (task && task.status === 'running') { task.cancel = true; task.proc && task.proc.kill('SIGTERM'); } return json(res, 200, view(C.load())); }
  if (p === '/api/choices' && M === 'GET') { const s = C.load(), ch = readChoices(s); return json(res, 200, { choices: ch, receipt: receiptOf(s, ch) }); }
  if (p === '/api/choices' && M === 'POST') {
    const b = await readBody(req), s = C.load(), cur = readChoices(s);
    if (!cur) return json(res, 400, { error: 'make a draft first' });
    for (const k of ['beats', 'titles', 'graphics']) if (Array.isArray(b[k])) cur[k] = b[k];
    writeFileSync(choicesPath(s), JSON.stringify(cur, null, 2) + '\n');
    const r = await new Promise(ok => { const pr = spawn(process.execPath, [join(KIT, 'choices.cjs'), s.job, '--apply', '--json'], { cwd: ROOT }); let o = '', e = ''; pr.stdout.on('data', d => o += d); pr.stderr.on('data', d => e += d); pr.on('close', code => ok({ code, o, e })); });
    if (r.code !== 0) return json(res, 400, { error: (r.e || r.o).trim().split('\n').slice(-4).join(' ') });
    update(st => { st.lockedAtDraft = C.compose(st, { refPack: refPackName(st) }).lockString || ''; });
    const ch2 = readChoices(s);
    return json(res, 200, { ok: true, choices: ch2, receipt: receiptOf(s, ch2), log: r.o.trim().split('\n').filter(l => !l.startsWith('{')).slice(-20) });
  }
  // a brand mark for the Words and brands list (kit/brands.cjs): one you added, or the kit's own
  if (p === '/api/brand' && M === 'GET') {
    const n = String(u.searchParams.get('name') || ''), abs = C.KIT_BRANDS.includes(n) ? join(ROOT, n) : join(C.brandsDir(), basename(n));
    if (!/\.(svg|png|webp|jpe?g)$/i.test(abs) || !existsSync(abs)) return json(res, 404, { error: 'no such brand mark' });
    return serveFile(req, res, abs);
  }
  // show original: the session's reference video, wherever the downloads setting put it
  if (p === '/api/reference/video' && M === 'GET') {
    const f = C.load().reference.file; if (!f) return json(res, 404, { error: 'no reference video' });
    const abs = resolve(ROOT, f); if (!VIDEO.includes(extname(abs).toLowerCase())) return json(res, 404, { error: 'no reference video' });
    return serveFile(req, res, abs);
  }
  if (p === '/api/cleanup' && M === 'GET') { const s = C.load(); if (!s.job) return json(res, 400, { error: 'name the job first' }); return json(res, 200, cleanupView(s, u.searchParams.get('silence'))); }
  if (p === '/api/cleanup' && M === 'POST') {
    const b = await readBody(req), s0 = C.load();
    if (!s0.job || !existsSync(clipsJsonPath(s0))) return json(res, 400, { error: 'make a draft first' });
    if (b.on === false) { update(st => { st.cleanup = { ...(st.cleanup || {}), on: false }; }); return json(res, 200, { ...cleanupView(C.load()), ...view(C.load()) }); }
    const sil = b.silence != null ? +b.silence : undefined;
    if (sil !== undefined && !(sil >= 0.3 && sil <= 3)) return json(res, 400, { error: 'silence: 0.3 to 3 seconds' });
    const dec = {}; for (const [k, v] of Object.entries(b.decisions || {})) if (/^[\w:.-]{1,80}$/.test(k)) dec[k] = !!v;
    const cj = JSON.parse(readFileSync(clipsJsonPath(s0), 'utf8')), items = RV.cleanup(cj, { silence: sil || (s0.cleanup && s0.cleanup.silence) || 0.7 });
    const pl = RV.plan(items, dec, cj);
    writeFileSync(join(ROOT, cleanupFile(s0)), JSON.stringify(pl, null, 1) + '\n');
    const removed = items.filter(it => dec[it.id] !== undefined ? dec[it.id] : it.remove);
    const note = `Clean-up: ${removed.filter(x => x.type === 'silence').length} pauses, ${removed.filter(x => x.type === 'filler').length} filler words and ${items.filter(x => x.type === 'take').length - pl.keep.length} retakes left out, ${pl.saved} s shorter. ${b.redraft === false ? 'Used on the next draft.' : 'Redrafting.'}`;
    update(st => { st.cleanup = { on: true, silence: sil || (st.cleanup && st.cleanup.silence) || 0.7, decisions: dec, footage: footageKey(st), at: new Date().toISOString(), saved: pl.saved };
      if (S.load().actionNotes !== false) C.applyPatch(st, { reply: note, from: 'Studio', kind: 'action' }); });
    if (b.redraft !== false) { const s = C.load(), d = draftSteps(s); update(st => { st.lockedAtDraft = d.lockString || ''; }); runTask('draft', () => d.steps, () => ({ choices: !!readChoices(C.load()), cleanup: pl })); }
    return json(res, 202, { ...cleanupView(C.load()), plan: pl, ...view(C.load()) });
  }
  // comment on the preview: a click or a box on a frame, sent to whoever answers the chat, with the frame saved in the job
  if (p === '/api/comment' && M === 'POST') {
    const b = await readBody(req, 8e6), s = C.load(), text = String(b.text || '').trim().slice(0, 1500);
    if (!s.job) return json(res, 400, { error: 'name the job first' });
    if (!text) return json(res, 400, { error: 'say what should change' });
    const t = Math.max(0, +b.t || 0), rg = b.region && typeof b.region === 'object' ? Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, Math.max(0, Math.min(1, +b.region[k] || 0))])) : null;
    const video = typeof b.video === 'string' && /^jobs\/[\w.-]+\/[\w.-]+\.mp4$/.test(b.video) ? b.video : null;
    let frame = null;
    const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.image || ''));
    if (m) {
      const dir = join('jobs', s.job, 'comments'); mkdirSync(join(ROOT, dir), { recursive: true });
      const n = (s.commentSeq || 0) + 1; frame = `${dir}/comment-${n}.${m[1] === 'png' ? 'png' : 'jpg'}`.split(sep).join('/');
      writeFileSync(join(ROOT, frame), Buffer.from(m[2], 'base64'));
      update(st => { st.commentSeq = n; });
    }
    const line = RV.commentLine({ text, t, region: rg, video, frame });
    return json(res, 200, await chatTurn(line, false, { kind: 'comment', t: +t.toFixed(2), region: rg, video, frame, note: text }));
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
    return json(res, 200, await chatTurn(text, b.offline));
  }
  if (p === '/api/settings' && M === 'GET') return json(res, 200, { settings: S.load(), tools: F.tools({ fresh: u.searchParams.has('fresh') }) });
  if (p === '/api/settings' && M === 'POST') {
    const b = await readBody(req), r = S.update(b);
    if (r.errs.length) return json(res, 400, { error: r.errs.join('; '), errs: r.errs });
    pushState(true); return json(res, 200, { settings: r.settings, ...view(C.load()) });
  }
  if (p === '/api/llm/models' && M === 'GET') {
    const st = S.load(), base = u.searchParams.get('base') || st.chat.baseUrl || process.env.STUDIO_LOCAL_URL || S.LOCAL_PRESETS[0].url;
    if (!/^https?:\/\//.test(base)) return json(res, 400, { error: 'base: an http(s) address' });
    try { return json(res, 200, { base, models: await LLM.models(base, process.env.LOCAL_LLM_API_KEY) }); }
    catch (e) { return json(res, 502, { error: `no answer from ${base} (${e.cause ? e.cause.code || e.cause.message : e.message}). Is Ollama, LM Studio or your llama.cpp server running?` }); }
  }
  if (p === '/api/agent' && M === 'GET') return json(res, 200, { agent: CH.presence(), ...CH.peek() });
  // for the Claude Code hook (kit/studio/hooks/studio-pending.mjs): a cheap peek, nothing is marked seen
  if (p === '/api/agent/pending' && M === 'GET') { const q = CH.peek(); return json(res, 200, { ...q, notice: CH.notice(q) }); }
  if (p === '/api/reset' && M === 'POST') { const s = C.defaultState(), o = C.load(); s.rev = o.rev; s.chatSeq = o.chatSeq || 0; s.refSeq = o.refSeq || 0; C.save(s); pushState(); return json(res, 200, view(s)); }
  return json(res, 404, { error: 'no such endpoint' });
}

// AG-UI run: RunAgentInput in, events out. The message joins the Studio chat; the run ends when it is answered (or times out, still queued).
async function aguiRun(req, res) {
  const input = await readBody(req), threadId = String(input.threadId || 'studio'), runId = String(input.runId || 'run-' + Date.now());
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  let closed = false; res.on('close', () => { closed = true; });
  const w = ev => { if (!closed) res.write(AG.encode(ev)); };
  const say = m => { const id = 'studio-' + m.id; w({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }); w({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: m.text }); w({ type: 'TEXT_MESSAGE_END', messageId: id }); };
  const finish = result => { w({ type: 'STATE_SNAPSHOT', snapshot: AG.snapshot(C.load()) }); w({ type: 'RUN_FINISHED', threadId, runId, result }); res.end(); };
  w({ type: 'RUN_STARTED', threadId, runId });
  const text = AG.lastUserText(input).trim();
  if (!text) { w({ type: 'RUN_ERROR', message: 'the run has no user message', code: 'no_message' }); return res.end(); }
  try {
    const r = await chatTurn(text.slice(0, 4000), false);
    if (r.via !== 'agent') { const m = r.state.chat.filter(x => x.role === 'assistant').at(-1); if (m) say(m); return finish({ status: 'answered', via: r.via }); }
    const mine = r.state.chat.filter(x => x.role === 'user').at(-1).id, sent = new Set();
    const fp = input.forwardedProps || {}, deadline = Date.now() + Math.min(600, Math.max(1, +fp.timeout_s || 300)) * 1000;
    let status = '';
    while (!closed && Date.now() < deadline) {
      const s = C.load(), m = s.chat.find(x => x.id === mine);
      if (m && m.status !== status) { status = m.status; w({ type: 'CUSTOM', name: 'studio.message_status', value: { id: 'studio-' + mine, status } }); }
      for (const x of s.chat) if (x.role === 'assistant' && x.replyTo === mine && !sent.has(x.id)) { sent.add(x.id); say(x); }
      if (status === 'answered') return finish({ status: 'answered', via: 'agent' });
      await new Promise(ok => setTimeout(ok, 250));
    }
    if (!closed) finish({ status: status || 'queued', via: 'agent', note: 'No answer yet. The message stays in the Studio chat for your agent.' });
  } catch (e) { w({ type: 'RUN_ERROR', message: e.message }); res.end(); }
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
    if (u.pathname === '/api/agui/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const c = { res, obs: AG.observer(C.load(), task) }; for (const ev of c.obs.first) res.write(AG.encode(ev)); aguiClients.add(c);
      const ka = setInterval(() => res.write(': ka\n\n'), 20e3); req.on('close', () => { clearInterval(ka); aguiClients.delete(c); }); return;
    }
    if (u.pathname === '/api/agui' && req.method === 'POST') return await aguiRun(req, res);
    if (u.pathname.startsWith('/api/')) return await api(req, res, u);
    if (u.pathname === '/' || u.pathname === '/index.html') return serveFile(req, res, join(STUDIO, 'public', 'index.html'));
    if (/^\/(favicon\.svg|assets\/[\w.-]+\.(js|css))$/.test(u.pathname)) return serveFile(req, res, join(STUDIO, 'public', u.pathname.slice(1)));
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
// the agent's presence: push when it connects, starts or stops waiting, and when it goes quiet
let lastAgent = '';
const agentTick = () => { const a = CH.presence(), k = `${a.name}|${a.connected}|${a.listening}`; if (k !== lastAgent) { lastAgent = k; pushState(true); } };
watchFile(CH.presencePath(), { interval: 700 }, agentTick);
setInterval(agentTick, 5000).unref();
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
// a take still marked recording or converting was cut off when Studio last stopped
{ const s0 = C.load(); if ((s0.takes || []).some(t => t.status === 'recording' || t.status === 'converting')) update(st => { for (const t of st.takes) if (t.status === 'recording' || t.status === 'converting') Object.assign(t, { status: 'failed', error: 'Studio stopped while this take was being saved' }); }); }
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${server.address().port}`;
  const e = env();
  console.log(`Studio: ${url}\nSession: ${C.statePath()}\nChat: ${e.backend === 'agent' ? 'your terminal agent (tell it: Run the Studio chat loop; setup in AGENTS.md)' : e.llm ? e.llm : e.backend}\nReference links: ${e.tools.ytdlp ? 'yt-dlp ' + e.tools.ytdlp : 'direct video links and Instagram only (pip install yt-dlp for YouTube, TikTok, X, Vimeo)'}\nStop with Ctrl+C.`);
  openBrowser(url);
  // the setup check runs a few quick commands; do it once after start so the page can show what is missing
  setTimeout(() => { setupStatus(true); pushState(true); }, 200).unref();
});
export { server };
