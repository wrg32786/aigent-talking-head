// Studio: a local web page over the kit. Drop in footage and a reference, click effects from a visual menu, set the
// music and pace, chat the vibe, read what was picked and why, render and download. Everything runs on this computer;
// the page only talks to this server, and this server only runs the kit's own commands (reel, teardown, choices, fx).
//   npm run studio                    -> http://127.0.0.1:4757 opens in your browser
//   npm run studio -- --port 5000 --no-open
// The session lives in jobs/.studio/state.json (STUDIO_DIR to move it). The MCP tools studio_get_state and
// studio_set_selections read and write the same file, and the page updates live when they do.
import http from 'http';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watchFile, writeFileSync } from 'fs';
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
import * as FX from './fixes.mjs';
import * as CUT from './cut.mjs';
import * as MEDIA from './media.mjs';
import * as KEYS from './keys.mjs';
import { capture as capturePage } from '../capture.mjs';
import { findChrome } from '../chrome.mjs';
import { mount as mountBroll } from './broll-api.mjs';
import * as PIECES from './pieces.mjs';
import * as WIZ from './wizards.mjs';
import { mount as mountFolders } from './folders.mjs';
import { mount as mountPost } from './post-api.mjs';

const require = createRequire(import.meta.url);
const SNAP = require('../snapshots.cjs');
const K = require('../packs.cjs');
const MC = require('../memcheck.cjs');
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
  // STUDIO_SETUP_STATUS: a saved status to use instead of checking this computer (the tests: a fixed set of missing things)
  if (fresh || !setupCache || Date.now() - setupAt > 5 * 60e3) { try { setupCache = process.env.STUDIO_SETUP_STATUS ? JSON.parse(readFileSync(process.env.STUDIO_SETUP_STATUS, 'utf8')) : SETUP.status(); } catch (e) { setupCache = { ready: false, items: [], missing: 0, forUser: [], error: e.message }; } setupAt = Date.now(); }
  return setupCache;
}
// only what is missing: { id: { label, feature, need } } and whether the core is ready. The page shows the fix buttons
// for an id (kit/studio/fixes.mjs, env.fixes); no command ever goes to the page as text.
function setupBrief() {
  if (!setupCache) return null;
  return { ready: setupCache.ready, missing: Object.fromEntries(setupCache.items.filter(x => x.status !== 'ready').map(x => [x.id, { label: FX.describe(x.id) ? FX.describe(x.id).label : x.label, feature: x.feature, need: x.need, user: !!x.user }])) };
}
// the setup list for the page: the same items, with the command fix swapped for the fix id
function setupForPage(st) {
  const items = st.items.map(x => ({ ...x, fix: x.status === 'ready' ? null : x.id }));
  return { ...st, items, forUser: items.filter(x => x.status !== 'ready' && x.user).map(x => { const d = FX.describe(x.id); return d ? `${d.label}: ${d.why}` : x.label; }) };
}
// a draft or render that cannot work: say so now, with the fix ids, instead of a failure later
function needFor(kind) {
  if (process.env.STUDIO_REEL) return null; // a stand-in engine (the tests) needs none of the engine's tools
  const b = setupBrief(), miss = b ? { ...b.missing } : {};
  if (!miss.ffmpeg && !F.tools().ffmpeg) miss.ffmpeg = { label: 'ffmpeg' };
  const need = kind === 'render' ? ['ffmpeg', 'python', 'chrome', 'npm'] : ['ffmpeg', 'python', 'npm'];
  const m = need.filter(k => miss[k]);
  return m.length ? { error: FX.missingLine(m, `Studio cannot ${kind} yet`), fix: m, setup: true } : null;
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
  const st = S.load(), backend = st.chat.backend, p = backend === 'agent' || backend === 'keywords' ? null : LLM.provider(KEYS.envWithKeys(), st.chat);
  const t = F.tools();
  return { llm: p ? `${p.name}${p.model ? ' (' + p.model + ')' : ''}` : null, backend, agent: CH.presence(), effectsReady: existsSync(join(ROOT, 'effects', '.venv')), port: PORT,
    settings: { downloads: st.downloads, renders: st.renders, actionNotes: st.actionNotes, agent: st.agent, chat: st.chat, from: st.from, defaultDownloads: 'teardown-in/studio/<job>/ (in the kit, not shared)', defaultRenders: 'jobs/<job>/ (in the kit)', defaultDownloadsPath: join(ROOT, 'teardown-in', 'studio'), defaultRendersPath: join(ROOT, 'jobs') },
    keys: { anthropic: KEYS.isSet('anthropic'), openai: KEYS.isSet('openai') }, broll: st.broll, localPresets: S.LOCAL_PRESETS,
    tools: { ytdlp: t.ytdlp ? t.ytdlp.version : null, instaloader: t.instaloader, ffmpeg: t.ffmpeg }, install: F.INSTALL, setup: setupBrief(), fixes: FX.all() };
}
// every view carries a rising seq (and this run's boot id) so the page can drop a reply that is older than an event it
// already applied, e.g. a POST answer that lands after the SSE state for a download that failed right away
const BOOT = Date.now().toString(36); let viewSeq = 0;
function view(s) {
  let comp; try { comp = C.compose(s, { refPack: refPackName(s) }); } catch (e) { comp = { args: [], errs: [e.message], notes: [] }; }
  let scripts = []; try { scripts = SC.list(s.job); } catch {}
  let cut = null; try { cut = cutView(s); } catch (e) { cut = { error: e.message, candidates: [] }; }
  let broll = null; try { broll = BRL.view(s); } catch (e) { broll = { error: e.message, beats: [] }; }
  let reopenable = []; try { reopenable = s.job ? SNAP.list(join(ROOT, 'jobs', s.job)).filter(x => x.snapshot).map(x => `jobs/${s.job}/${x.reel}`) : []; } catch {}
  let combo = { pieces: [], seconds: 0, key: '' }; try { combo = comboOf(s); } catch {}
  let edit = null; try { edit = editOf(s, { combo, cut, broll }); } catch (e) { edit = { error: e.message }; }
  let look = null; try { look = lookSources(s); } catch {}
  return { seq: ++viewSeq, boot: BOOT, state: s, look, compose: comp, outputs: C.outputsOf(s), reopenable, scripts, cut, broll, pieces: (() => { try { return piecesOf(s); } catch { return null; } })(), combo: { ...combo, from: draftFrom(s, combo) }, edit, env: env(), swap: swapOf(s), cleanupReady: !!(s.job && existsSync(clipsJsonPath(s))), task: task && { id: task.id, kind: task.kind, status: task.status, ...(task.cancel && task.status === 'running' ? { cancelling: true } : {}), ...(task.fix ? { fix: task.fix } : {}), startedAt: task.startedAt, endedAt: task.endedAt, lines: task.lines.slice(-12), result: task.result || null } };
}

// what a finished draft says (a draft is a plan: no video until Render)
const DRAFT_DONE = 'Plan ready, no video yet. Press Render.';
// ---------- tasks (one at a time) ----------
let task = null, seq = 0, activeRequests = 0;
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
    if (me.status === 'running') { me.status = 'done'; try { me.result = (await done(out)) || {}; } catch (e) { me.status = 'failed'; log('error: ' + e.message); }  if (me.status === 'done' && kind === 'draft') log(DRAFT_DONE); }
  })().finally(() => { me.endedAt = Date.now(); if (hooks.end) try { hooks.end(me.status, me.lines); } catch (e) { log('error: ' + e.message); } update(s => { s.task = { id: me.id, kind, status: me.status }; s.outputs = C.outputsOf(s); }); send('task', { id: me.id, status: me.status }); setImmediate(pump); });
  return me;
}

// ---------- switching videos ----------
// what would be cut off by switching now: a task, a download, a take being saved, a transcript, a generation
function busyWith(s) {
  if (activeRequests) return 'Studio is still saving a change';
  if (task && task.status === 'running') return `${task.kind === 'draft' ? 'A draft' : task.kind === 'render' ? 'A render' : 'A ' + task.kind} is running`;
  return C.videoBusy(s);
}
// { name, keepLook } starts a new video; { open: job } opens a past one (kit/studio/core.mjs switchVideo). The current
// video's session is saved first; nothing on disk is deleted.
function switchVideo(o = {}) {
  const busy = busyWith(C.load());
  if (busy) throw Object.assign(new Error(`${busy}. Cancel it or let it finish, then switch videos.`), { code: 409 });
  task = null; // do not show the previous video's finished draft or render
  let r; const s = update(st => { r = C.switchVideo(st, o); }); return { s, r };
}

// ---------- the kit's commands, from the session ----------
const refPackName = s => s.reference && s.reference.mode === 'influence' && s.reference.extracted && s.job ? `ref-${s.job}`.slice(0, 48) : null;
// force: write it whatever the mode (Save as a Look from a reference used whole, or off)
function writeRefPack(s, { force = false } = {}) {
  const name = force ? (s.reference && s.reference.extracted && s.job ? `ref-${s.job}`.slice(0, 48) : null) : refPackName(s); if (!name) return null;
  const pack = C.fitStyle(C.influencePack(s.reference.extracted, s.job, s.pack));
  const errs = K.validate(pack);
  if (errs.length) throw new Error('reference pack: ' + errs.join('; '));
  const dir = join(K.LOCAL, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pack.json'), JSON.stringify(pack, null, 2) + '\n');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n\n${pack.description}\n\nMade by Studio. Use it with npm run reel -- <clip> --pack ${name}.\n`);
  return name;
}
// where each option on the Look step came from, for the badges: the Look (the pack's locks and style), the reference
// (what its teardown suggests, and the picks Use parts added) and you (your own picks)
function lookSources(s, cat = C.catalog()) {
  const pack = new Set(), ref = new Set(), add = (set, kind, ids) => { for (const id of [].concat(ids || [])) if (id && cat.items[`${kind}:${id}`]) set.add(`${kind}:${id}`); };
  let P = null; try { P = s.pack ? K.load(s.pack) : null; } catch {}
  if (P) { const l = P.locks || {}, st = P.style || {};
    add(pack, 'transition', l.transitions); add(pack, 'entrance', l.titles); add(pack, 'graphic', l.graphics && l.graphics.allow); add(pack, 'finish', l.finishes); add(pack, 'captionEntrance', l.captionEntrance);
    add(pack, 'transition', st.transition); add(pack, 'entrance', st.entranceOrder); add(pack, 'finish', st.finishPool); add(pack, 'effect', st.effectsFavourites); add(pack, 'look', st.look); add(pack, 'captionStyle', st.captionStyle); }
  const ex = s.reference && s.reference.mode !== 'off' ? s.reference.extracted : null;
  if (ex) { for (const r of Object.keys(C.referencePicks(ex, null, cat))) ref.add(r); add(ref, 'look', ex.look); }
  const added = new Set((s.reference && s.reference.added) || []);
  for (const r of added) ref.add(r);
  return { pack: [...pack], ref: [...ref], added: [...added], packName: s.pack || null, refName: ex ? (ex.name || null) : null };
}
function draftSteps(s) {
  if (!s.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  if (!s.footage.length && !s.clips) throw Object.assign(new Error('add footage first'), { code: 400 });
  const recreate = s.reference.mode === 'recreate' && s.reference.out && existsSync(join(ROOT, s.reference.out, 'Reel.md'));
  const ref = recreate ? null : writeRefPack(s);
  const comp = C.compose(s, { refPack: ref });
  if (comp.errs.length) throw Object.assign(new Error(comp.errs.join('; ')), { code: 400 });
  let args = comp.args.slice();
  if (recreate) { const i = args.indexOf('--pack'); if (i >= 0) args.splice(i, 2); args.push('--recipe', join(s.reference.out, 'Reel.md'), '--recut'); }
  // your pieces (the Combo) when you kept any: cut once, here, and handed to the reel as they are (--as-is). Recreate
  // runs on them too, with the reference's Reel.md as the recipe, so the draft is what Your edit says it is (it used
  // to switch to the whole take, so the draft's key never matched and Render could not come on)
  const combo = comboOf(s), fromPieces = draftFrom(s, combo) === 'pieces';
  if (fromPieces) {
    const cf = comboFiles(s, combo);
    return { steps: [...cf.steps, [process.env.STUDIO_REEL || 'kit/reel.cjs', [...cf.files, '--as-is', '--name', s.job, '--force', '--draft', '--json', ...args, ...(process.env.STUDIO_REEL_ARGS ? process.env.STUDIO_REEL_ARGS.split(' ') : [])]]], lockString: comp.lockString, txPrompt: null, key: draftKey(s, combo), from: 'pieces', pieces: combo.pieces.length };
  }
  const cl = cleanupFor(s), src = cl ? ['--clips', relOf(clipsDirOf(s)), '--cleanup', cl] : s.clips ? ['--clips', s.clips] : s.footage;
  // takes filmed from a script: hand the script to Whisper as a hint (TX_PROMPT, kit/tx.py and kit/clip.py), so captions spell its words
  const said = (s.takes || []).filter(t => t.script && t.script.text && s.footage.includes(t.file)).map(t => t.script.text.replace(/\[[a-z]+\]/gi, ' ').replace(/\s+/g, ' ').trim());
  const stepEnv = said.length && !process.env.TX_PROMPT ? { TX_PROMPT: [...new Set(said)].join(' ').slice(0, 800) } : {};
  // one transcript per take: when Studio already has the words of every file (the Cut step's), clip.py uses them
  // instead of running Whisper again, so the draft cuts on the same words as Cut and Lines (not with a script hint)
  let wordsArg = [];
  if (src === s.footage && !stepEnv.TX_PROMPT) {
    const tx = s.footage.map(f => [f, MEDIA.transcript(f)]);
    if (tx.length && tx.every(([, t]) => t && t.words && t.words.length) && new Set(tx.map(([f]) => basename(f))).size === tx.length) {
      const wf = `inbox/studio/${s.job}/words.json`; mkdirSync(join(ROOT, 'inbox', 'studio', s.job), { recursive: true });
      writeFileSync(join(ROOT, wf), JSON.stringify(Object.fromEntries(tx.map(([f, t]) => [basename(f), t.words]))));
      wordsArg = ['--words', wf];
    }
  }
  return { steps: [[process.env.STUDIO_REEL || 'kit/reel.cjs', [...src, ...wordsArg, '--name', s.job, '--force', '--draft', '--json', ...args, ...(process.env.STUDIO_REEL_ARGS ? process.env.STUDIO_REEL_ARGS.split(' ') : [])], stepEnv]], lockString: comp.lockString, txPrompt: stepEnv.TX_PROMPT || null, key: 'take:' + footageKey(s), from: 'take' };
}
function renderSteps(s) {
  if (!s.job || !existsSync(join(ROOT, 'jobs', s.job, 'build', 'cut.json'))) throw Object.assign(new Error('make a draft first'), { code: 400 });
  const comp = C.compose(s, { refPack: refPackName(s) });
  const args = ['--rebuild', '--name', s.job, '--json'];
  if (comp.lockString && comp.lockString !== s.lockedAtDraft) args.push('--lock', comp.lockString);
  if (s.export) args.push('--export', s.export);
  // the b-roll lane goes into cut.json first (kit/studio/broll-run.mjs), with credits.txt for the clips it uses
  const bp = BRL.plan(s), steps = [];
  if (bp) { const f = join('jobs', s.job, 'broll.json'); writeFileSync(join(ROOT, f), JSON.stringify(bp, null, 1)); steps.push(['kit/studio/broll-run.mjs', ['apply', '--name', s.job, '--plan', f]]); }
  steps.push([process.env.STUDIO_REEL || 'kit/reel.cjs', args]);
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

// ---------- the Cut step: footage player media, the Output choice, candidates, batch render (kit/studio/cut.mjs) ----------
const okFootage = (s, rel) => typeof rel === 'string' && s.footage.includes(rel) && existsSync(join(ROOT, rel));
// the length from ffprobe, or from the transcript when there is no ffprobe (its words end near the end)
const durOf = rel => { try { const d = MEDIA.probe(rel).duration; if (d) return d; } catch {} const t = MEDIA.partial(rel); return (t && (t.duration || (t.words && t.words.length && t.words[t.words.length - 1][1]))) || 0; };
function cutSource(s, rel) {
  if (rel && okFootage(s, rel)) return rel;
  if (s.cut && okFootage(s, s.cut.source)) return s.cut.source;
  let best = null, bd = -1; for (const f of s.footage) { if (!existsSync(join(ROOT, f))) continue; const d = durOf(f); if (d > bd) { bd = d; best = f; } }
  return best;
}
function outputOf(s) { if (s.output && s.output.auto === false) return { ...CUT.defaultOutput(), ...s.output }; const src = cutSource(s); return CUT.defaultsFor(src ? durOf(src) : 0); }
const subJob = (job, id) => `${String(job).slice(0, 48 - id.length)}-${id}`;
function cutView(s) {
  const src = cutSource(s), o = outputOf(s), secs = src ? durOf(src) : 0, c = s.cut && s.cut.source === src ? s.cut : null;
  const tx = src ? (s.tx || {})[src] || (MEDIA.transcript(src) ? { status: 'ready' } : null) : null;
  const cands = c ? (c.candidates || []).slice().sort((a, b) => a.order - b.order).map(x => ({ ...x, job: s.job ? subJob(s.job, x.id) : null, outputs: s.job ? C.outputsOf({ job: subJob(s.job, x.id) }) : [], file: s.job && existsSync(join(ROOT, `inbox/studio/${s.job}/cuts/${x.id}.mp4`)) ? `inbox/studio/${s.job}/cuts/${x.id}.mp4` : null })) : [];
  const formats = Object.fromEntries(Object.entries(CUT.FORMATS).map(([k, f]) => [k, { label: f.label, sub: f.sub, aspect: f.aspect, lengths: Object.fromEntries(CUT.LENGTHS.map(l => [l, CUT.lengthLabel(k, l)])) }]));
  return { formats, footage: s.footage.filter(f => existsSync(join(ROOT, f))).map(f => ({ path: f, seconds: durOf(f) })), source: src, seconds: secs, output: o, summary: CUT.summary(o, secs), candidates: cands, scoredBy: c ? c.scoredBy : null, pending: c ? c.pending || null : null, outputOf: c ? c.summary : null, tx };
}
function txProgress(rel, st) { update(x => { x.tx = x.tx || {}; x.tx[rel] = { ...(x.tx[rel] || {}), ...st }; }); }
function startTranscribe(rel, then) {
  if (MEDIA.transcript(rel)) { if (then) then(); return { status: 'ready' }; }
  txProgress(rel, { status: 'running', done: 0, total: null, error: null, startedAt: Date.now() });
  return MEDIA.transcribe(rel, {
    onProgress: (done, total) => txProgress(rel, { status: 'running', done, total }),
    onDone: err => { txProgress(rel, err ? { status: 'failed', error: err.message, fix: err.fix || null } : { status: 'ready', error: null }); if (!err && then) try { then(); } catch (e) { console.error(e.message); } },
  });
}
const wordsOf = rel => { const t = MEDIA.transcript(rel); return t ? t.words : null; };
// cut points on the audio: every start and end moves to the quiet next to its words (kit/studio/cut.mjs snapRanges)
const energyOf = rel => MEDIA.energy(rel).catch(() => null);
const snapOne = (c, words, env, dur) => (env ? CUT.snapCandidate(c, words || [], env, dur) : c);
const CTA_LINE = 'Pick the cuts';
async function findCuts(rel, scorer = 'auto') {
  const s = C.load(), o = outputOf(s), words = wordsOf(rel); if (!words) throw Object.assign(new Error('transcribe the footage first'), { code: 400 });
  const env = await energyOf(rel), cands = CUT.candidates(words, o, { duration: durOf(rel) }).map(c => snapOne(c, words, env, durOf(rel)));
  const summary = CUT.summary(o, durOf(rel)), st = S.load(), a = CH.presence();
  const who = scorer !== 'auto' ? scorer : st.chat.backend === 'agent' && a.connected ? 'agent' : LLM.provider(KEYS.envWithKeys(), st.chat) ? 'model' : 'rules';
  update(x => { x.cut = { source: rel, summary, candidates: cands, scoredBy: 'rules', pending: who === 'rules' ? null : who, at: Date.now() }; });
  if (who === 'agent') {
    const line = `${CTA_LINE} for "${summary}": ${cands.length} candidates from the rules are on the Cut step. Read them and the transcript with get_cuts, then send your picks with set_cuts (time ranges in seconds, a 0 to 100 score and a short reason each). ${o.goal === 'ad' ? 'It is an ad: hook in the first 1 to 2 s, tight pacing, a clear call to action at the end, no long intro.' : 'It is organic: story pacing, a strong first line, short clips that loop back to the start.'}`;
    update(x => { C.applyPatch(x, { say: line, from: 'ui', toAgent: true, attach: { kind: 'cut', source: rel } }); });
  } else if (who === 'model') {
    LLM.complete('You score cuts of a talking-head video. Reply with JSON only.', CUT.scorePrompt(cands, o), KEYS.envWithKeys(), st.chat, { maxTokens: 1500 })
      .then(r => { const re = CUT.applyScores(cands, r.text); update(x => { if (!x.cut || x.cut.source !== rel) return; if (re) { x.cut.candidates = re.map(c => ({ ...c, keep: (x.cut.candidates.find(y => y.id === c.id) || c).keep })); x.cut.scoredBy = r.model || r.provider; } x.cut.pending = null; if (!re) x.cut.note = 'The model reply had no scores, so the rules scores stay.'; }); })
      .catch(e => update(x => { if (x.cut && x.cut.source === rel) { x.cut.pending = null; x.cut.note = `The model failed (${e.message}), so the rules scores stay.`; } }));
  }
  return who;
}
async function editCut(b) {
  const c0 = C.load().cut, env = c0 && b.snap !== false && (b.add || b.ranges) ? await energyOf(c0.source) : null;
  return update(x => {
    const c = x.cut; if (!c) throw Object.assign(new Error('find cuts first'), { code: 400 });
    const dur = durOf(c.source), list = c.candidates;
    if (b.add) {
      const ranges = CUT.cleanRanges(b.add.ranges, dur), kind = ['full', 'part', 'clip', 'ad'].includes(b.add.kind) ? b.add.kind : 'clip';
      const n = 1 + list.filter(y => /^m\d+$/.test(y.id)).length, words = wordsOf(c.source) || [];
      list.push(snapOne({ id: 'm' + n, kind, label: b.add.label ? String(b.add.label).slice(0, 60) : `Your ${kind === 'clip' ? 'clip' : kind} ${n}`, ranges, seconds: CUT.lengthOf({ ranges }), score: null, reason: 'Added by you', text: CUT.textIn(words, ranges), keep: true, order: list.length, by: 'you' }, words, env, dur));
      return;
    }
    const k = list.findIndex(y => y.id === b.id); if (k < 0) throw Object.assign(new Error(`no candidate ${b.id}`), { code: 404 });
    const it = list[k];
    if (b.ranges) {
      const w = wordsOf(c.source) || []; it.ranges = CUT.cleanRanges(b.ranges, dur); delete it.cuts; it.snapped = false;
      Object.assign(it, snapOne(it, w, env, dur)); it.seconds = CUT.lengthOf(it); it.text = CUT.textIn(w, it.ranges) || it.text; it.trimmed = true;
    }
    if (b.keep !== undefined) it.keep = !!b.keep;
    if (b.remove) list.splice(k, 1);
    if (b.move) { const ord = list.slice().sort((p, q) => p.order - q.order), i = ord.indexOf(it), j = Math.max(0, Math.min(ord.length - 1, i + (b.move > 0 ? 1 : -1))); ord.splice(i, 1); ord.splice(j, 0, it); ord.forEach((y, n) => { y.order = n; }); }
  });
}
// the agent's picks (MCP set_cuts): replace the candidates, scored by the agent
async function setCuts(b) {
  const s = C.load(), c = s.cut, rel = cutSource(s, b.source); if (!rel) throw Object.assign(new Error('add footage first'), { code: 400 });
  const env = b.snap === false ? null : await energyOf(rel);
  if (!Array.isArray(b.candidates) || !b.candidates.length) throw Object.assign(new Error('candidates: [{ kind, ranges: [[start, end]], score, reason }]'), { code: 400 });
  const dur = durOf(rel), words = wordsOf(rel) || [], n = {};
  const list = b.candidates.slice(0, 40).map((x, k) => {
    const kind = ['full', 'part', 'clip', 'ad'].includes(x.kind) ? x.kind : 'clip'; n[kind] = (n[kind] || 0) + 1;
    const ranges = CUT.cleanRanges(x.ranges || (x.start != null ? [[x.start, x.end]] : null), dur);
    const id = kind === 'full' && n.full === 1 ? 'full' : { full: 'f', part: 'p', clip: 'c', ad: 'ad' }[kind] + n[kind];
    return { id, kind, label: String(x.label || (kind === 'part' ? `Part ${n[kind]}` : kind === 'clip' ? `Clip ${n[kind]}` : kind === 'ad' ? `Ad cut ${n[kind]}` : 'Full edit')).slice(0, 60), ranges, seconds: CUT.lengthOf({ ranges }),
      score: x.score == null ? null : Math.max(0, Math.min(100, Math.round(+x.score))), reason: String(x.reason || '').replace(/\u2014/g, ', ').slice(0, 200), text: CUT.textIn(words, ranges), keep: x.keep !== false, order: k };
  }).map(c => snapOne(c, words, env, dur));
  const by = CH.prettyName(String(b.by || CH.presence().client || 'your agent'));
  return update(x => { x.cut = { source: rel, summary: CUT.summary(outputOf(x), dur), candidates: list, scoredBy: by, pending: null, at: Date.now() }; C.applyPatch(x, { reply: `${by} picked ${list.length} cut${list.length > 1 ? 's' : ''} on the Cut step.`, from: 'assistant', kind: 'action' }); });
}
// ---------- the Lines view: a long take as lines, keep or retake, grouped into named bites (kit/studio/cut.mjs lines) ----------
const LINES = new Map(); // source -> { key, lines }, the snapped lines of a transcript
async function linesOf(rel) {
  const t = MEDIA.transcript(rel); if (!t) return null;
  const key = `${t.words.length}:${t.words.length ? t.words[t.words.length - 1][1] : 0}`, hit = LINES.get(rel); if (hit && hit.key === key) return hit.lines;
  const L = CUT.lines(t.words, await energyOf(rel), durOf(rel)); LINES.set(rel, { key, lines: L }); return L;
}
const linesState = (s, rel) => ((s.lines || {})[rel]) || { keep: {}, bites: [], seq: 0, by: null };
const biteOut = (s, rel, b, L) => { const ranges = CUT.biteRanges(b.lines, L); const by = Object.fromEntries(L.map(l => [l.id, l]));
  return { ...b, lines: b.lines.filter(id => by[id]), ranges, seconds: +ranges.reduce((a, [x, y]) => a + y - x, 0).toFixed(2), text: b.lines.map(id => by[id] && by[id].text).filter(Boolean).join(' ').slice(0, 220),
    job: s.job ? subJob(s.job, b.id) : null, outputs: s.job ? C.outputsOf({ job: subJob(s.job, b.id) }) : [], file: s.job && existsSync(join(ROOT, `inbox/studio/${s.job}/cuts/${b.id}.mp4`)) ? `inbox/studio/${s.job}/cuts/${b.id}.mp4` : null }; };
async function linesView(s, path) {
  const rel = cutSource(s, path); if (!rel) return { source: null, lines: null, bites: [] };
  const L = await linesOf(rel), ls = linesState(s, rel), tx = (s.tx || {})[rel] || (L ? { status: 'ready' } : null);
  if (!L) return { source: rel, seconds: durOf(rel), tx, lines: null, bites: [] };
  const lines = L.map(l => ({ ...l, keep: CUT.keepOf(l, ls.keep) })), take = CUT.cleanTake(L, ls.keep);
  return { source: rel, seconds: durOf(rel), tx, lines, bites: ls.bites.map(b => biteOut(s, rel, b, L)), by: ls.by,
    cleanTake: { lines: take.length, seconds: +CUT.biteRanges(take, L).reduce((a, [x, y]) => a + y - x, 0).toFixed(2) }, kept: lines.filter(l => l.keep).length };
}
const bad = m => Object.assign(new Error(m), { code: 400 });
// keep or retake per line, and the bites: add, update (name, lines in order), remove, move, the clean take, or set them all (the agent)
async function editLines(b) {
  const s0 = C.load(), rel = cutSource(s0, b.path || b.source); if (!rel) throw bad('add footage first');
  const L = await linesOf(rel); if (!L) throw bad('transcribe the footage first (Find cuts or Transcribe on the Cut step)');
  const ids = new Set(L.map(l => l.id)), idOf = v => (typeof v === 'number' || /^\d+$/.test(String(v)) ? 'l' + (+v) : String(v));
  const lineList = v => { if (!Array.isArray(v) || !v.length) throw bad('lines: [line ids or numbers], in the order you want them'); const out = v.map(idOf); const miss = out.filter(x => !ids.has(x)); if (miss.length) throw bad(`no line ${miss.join(', ')}`); return [...new Set(out)]; };
  const by = b.by ? CH.prettyName(String(b.by)) : null;
  let note = null;
  const s = update(x => {
    x.lines = x.lines || {}; const ls = x.lines[rel] = linesState(x, rel);
    if (b.keep && typeof b.keep === 'object') for (const [k, v] of Object.entries(b.keep)) { const id = idOf(k); if (!ids.has(id)) throw bad(`no line ${k}`); ls.keep[id] = !!v; }
    const name = (v, d) => String(v || d).replace(/\u2014/g, ', ').slice(0, 60);
    if (b.action === 'add') { ls.seq++; ls.bites.push({ id: 'b' + ls.seq, name: name(b.name, `Bite ${ls.seq}`), lines: lineList(b.lines), by: by || 'you', kind: 'clip' }); }
    else if (b.action === 'clean') { const take = CUT.cleanTake(L, ls.keep); if (!take.length) throw bad('keep at least one line');
      const it = { id: 'take', name: 'Clean take', lines: take, by: by || 'you', kind: 'full' }, k = ls.bites.findIndex(y => y.id === 'take'); if (k >= 0) ls.bites[k] = it; else ls.bites.unshift(it); }
    else if (b.action === 'set') { if (!Array.isArray(b.bites)) throw bad('bites: [{ name, lines: [line numbers in order] }]');
      const keepTake = ls.bites.filter(y => y.id === 'take' && b.replace === false);
      const fresh = b.bites.slice(0, 30).map(y => { ls.seq++; return { id: 'b' + ls.seq, name: name(y.name, `Bite ${ls.seq}`), lines: lineList(y.lines), by: by || 'your agent', kind: 'clip', reason: y.reason ? String(y.reason).replace(/\u2014/g, ', ').slice(0, 160) : null }; });
      ls.bites = b.replace === false ? ls.bites.concat(fresh) : keepTake.concat(fresh); ls.by = by;
      if (b.clean) { const take = CUT.cleanTake(L, ls.keep); if (take.length) { ls.bites = ls.bites.filter(y => y.id !== 'take'); ls.bites.unshift({ id: 'take', name: 'Clean take', lines: take, by: by || 'your agent', kind: 'full' }); } }
      note = `${by || 'Your agent'} picked ${fresh.length} bite${fresh.length === 1 ? '' : 's'} on the Cut step${b.clean ? ', plus the clean take' : ''}.`; }
    else if (b.action) {
      const k = ls.bites.findIndex(y => y.id === b.id); if (k < 0) throw Object.assign(new Error(`no bite ${b.id}`), { code: 404 }); const it = ls.bites[k];
      if (b.action === 'update') { if (b.name != null) it.name = name(b.name, it.name); if (b.lines) it.lines = lineList(b.lines); }
      else if (b.action === 'remove') ls.bites.splice(k, 1);
      else if (b.action === 'move') { const j = Math.max(0, Math.min(ls.bites.length - 1, k + (b.by > 0 || b.dir > 0 ? 1 : -1))); ls.bites.splice(k, 1); ls.bites.splice(j, 0, it); }
      else throw bad('action: add, update, remove, move, clean or set');
    }
    if (note) C.applyPatch(x, { reply: note, from: 'assistant', kind: 'action' });
  });
  return { s, view: await linesView(s, rel) };
}
// bites as Cut candidates for the batch render: a bite is a clip, the clean take follows the Output choice
async function biteSteps(s, ids, path) {
  const rel = cutSource(s, path); const L = rel && await linesOf(rel); if (!L) throw bad('transcribe the footage first');
  const ls = linesState(s, rel), pick = ls.bites.filter(b => (ids && ids.length ? ids.includes(b.id) : true));
  if (!pick.length) throw bad('make a bite first');
  const list = pick.map((b, k) => ({ id: b.id, kind: b.kind === 'full' ? 'full' : 'clip', ranges: CUT.biteRanges(b.lines, L), keep: true, order: k })).filter(x => x.ranges.length);
  return cutSteps(s, null, { source: rel, candidates: list });
}

function cutSteps(s, ids, over) {
  const c = over || s.cut; if (!s.job) throw Object.assign(new Error('name the job first'), { code: 400 });
  if (!c || !c.candidates.length) throw Object.assign(new Error('find cuts first'), { code: 400 });
  const o = outputOf(s), src = c.source;
  const keep = c.candidates.filter(x => (ids ? ids.includes(x.id) : x.keep)).sort((a, b) => a.order - b.order);
  if (!keep.length) throw Object.assign(new Error('keep at least one cut'), { code: 400 });
  const comp = C.compose(s, { refPack: refPackName(s) }); if (comp.errs.length) throw Object.assign(new Error(comp.errs.join('; ')), { code: 400 });
  const base = comp.args.slice(); const e = base.indexOf('--export'); if (e >= 0) base.splice(e, 2);
  const tight = o.goal === 'ad' && !base.includes('--tighten') && !base.includes('--no-tighten') ? ['--tighten', '0.25'] : [];
  const REEL = process.env.STUDIO_REEL || 'kit/reel.cjs', steps = [], plan = [];
  // every piece is extracted on its snapped ranges, then handed to the reel as already cut: a clips.json beside the
  // files carries each one's words (from the one transcript of the take), and --as-is keeps it whole. Nothing is
  // transcribed or cut a second time, so what you made in Cut is what reaches the reel.
  const words = wordsOf(src) || [], cutsDir = join(ROOT, `inbox/studio/${s.job}/cuts`), cj = join(cutsDir, 'clips.json');
  let prev = []; try { prev = JSON.parse(readFileSync(cj, 'utf8')).clips || []; } catch {}
  const entries = keep.map((x, k) => { const ranges = CUT.renderRanges(x), w = CUT.clipWords(words, ranges), d = +ranges.reduce((a, [p, q]) => a + q - p, 0).toFixed(3);
    return { id: `clip-${String(k + 1).padStart(3, '0')}`, file: `cuts/${x.id}.mp4`, take: src.split('/').pop(), ranges, src_in: ranges[0][0], src_out: ranges[ranges.length - 1][1], dur: d, status: 'keep', text: w.map(y => y[2]).join(' '), words: w }; });
  mkdirSync(cutsDir, { recursive: true });
  writeFileSync(cj, JSON.stringify({ src, takes: [src.split('/').pop()], order: 'files', precut: true, clips: [...prev.filter(y => !entries.some(e => e.file === y.file)), ...entries] }, null, 1));
  for (const x of keep) {
    const sub = subJob(s.job, x.id), file = `inbox/studio/${s.job}/cuts/${x.id}.mp4`;
    const asClip = x.kind === 'ad' || (x.kind === 'clip' && (o.kind === 'both' || o.format !== 'long'));
    const aspect = asClip ? (o.format === 'square' ? '1:1' : '9:16') : CUT.aspectOf(o), exp = asClip ? CUT.exportOf(o, 'clip') : CUT.exportOf(o);
    steps.push(['kit/studio/cut-run.mjs', ['extract', '--src', src, '--ranges', CUT.renderRanges(x).map(r => r.join('-')).join(','), '--out', file]]);
    if (aspect === '16:9') steps.push(['kit/studio/cut-run.mjs', ['long', '--src', file, '--name', sub]]);
    else if (o.goal === 'ad') {
      steps.push([REEL, [file, '--as-is', '--name', sub, '--force', '--draft', '--json', ...base, ...tight]]);
      steps.push(['kit/studio/cut-run.mjs', ['cta', '--name', sub, '--text', o.cta || 'Learn more']]);
      steps.push([REEL, ['--rebuild', '--name', sub, '--json', ...(exp ? ['--export', exp] : [])]]);
    } else steps.push([REEL, [file, '--as-is', '--name', sub, '--force', '--json', ...base, ...(exp ? ['--export', exp] : [])]]);
    plan.push({ id: x.id, job: sub, aspect, export: exp });
  }
  return { steps, plan };
}

// ---------- the Combo: the pieces you kept on the Cut step, in order (kept cuts, then your bites) ----------
// Draft builds the one reel from these, already cut, so nothing is cut twice; Render's exports make each piece its own
// reel or a plain clip in the same run. Bites need the take's lines: a view uses the cached lines and asks for them once.
const LINES_ASKED = new Set();
function linesCached(rel) {
  const t = MEDIA.transcript(rel); if (!t) return null;
  const key = `${t.words.length}:${t.words.length ? t.words[t.words.length - 1][1] : 0}`, hit = LINES.get(rel);
  if (hit && hit.key === key) return hit.lines;
  if (!LINES_ASKED.has(rel + key)) { LINES_ASKED.add(rel + key); linesOf(rel).then(() => pushState(true)).catch(() => {}); }
  return null;
}
// the pieces of a take (kit/studio/pieces.mjs): its lines with a category, score and topics, and your Combo
const piecesState = (s, rel) => ((s.pieces || {})[rel]) || { ids: [], reasons: {}, by: null, cats: {} };
function piecesOf(s, rel = cutSource(s)) {
  const L = rel ? linesCached(rel) : null; if (!L) return null;
  const st = piecesState(s, rel), b = PIECES.build(L, { goal: outputOf(s).goal, cats: st.cats || {} }), by = Object.fromEntries(b.pieces.map(p => [p.id, p]));
  const ids = (st.ids || []).filter(id => by[id]);
  return { source: rel, cats: PIECES.CATS, topics: b.topics, pieces: b.pieces, combo: { ids, reasons: st.reasons || {}, by: st.by, seconds: +ids.reduce((a, id) => a + by[id].seconds, 0).toFixed(2) } };
}
function comboOf(s) {
  const src = cutSource(s); if (!src) return { source: null, pieces: [], seconds: 0, key: '' };
  const pieces = [], c = s.cut && s.cut.source === src ? s.cut : null, ps = piecesState(s, src);
  // your Combo, when you made one (Let AI choose or Build my own on the Cut step), wins: its pieces in your order,
  // neighbours in the take joined into one range. Otherwise the kept cuts in order, then your bites.
  const P = ps.ids && ps.ids.length ? piecesOf(s, src) : null;
  if (P && P.combo.ids.length) for (const x of PIECES.comboRanges(P.combo.ids, P.pieces)) pieces.push({ kind: 'piece', id: 'pc-' + x.ids.join('-').slice(0, 40), label: x.text.length > 48 ? x.text.slice(0, 46) + '...' : x.text, ranges: x.ranges, cutKind: 'clip', category: x.category, lines: x.ids });
  else if (c) for (const x of (c.candidates || []).filter(y => y.keep).sort((a, b) => a.order - b.order)) {
    const ranges = CUT.renderRanges(x); if (ranges.length) pieces.push({ kind: 'cut', id: x.id, label: x.label || x.id, ranges, cutKind: x.kind || 'clip' });
  }
  const ls = linesState(s, src), L = !pieces.some(x => x.kind === 'piece') && ls.bites.length ? linesCached(src) : null;
  if (L) for (const b of ls.bites) { const ranges = CUT.biteRanges(b.lines, L); if (ranges.length) pieces.push({ kind: 'bite', id: b.id, label: b.name || b.id, ranges, cutKind: b.kind === 'full' ? 'full' : 'clip' }); }
  // testimonial pieces from the B-roll step play in the Combo with their own sound, after the piece you picked
  // (else before your last piece, where the proof usually sits)
  if (pieces.length) for (const t of BRL.cutins(s)) {
    const at = t.after ? pieces.findIndex(x => x.id === t.after) + 1 : Math.max(1, pieces.length - 1), raw = t.c.raw;
    pieces.splice(at > 0 ? at : pieces.length, 0, { kind: 'testimonial', id: 't-' + t.c.id, label: t.c.name, ranges: raw.ranges, cutKind: 'clip', source: raw.src });
  }
  for (const x of pieces) x.seconds = +x.ranges.reduce((a, [p, q]) => a + q - p, 0).toFixed(2);
  const seconds = +pieces.reduce((a, x) => a + x.seconds, 0).toFixed(2);
  const key = pieces.length ? createHash('sha1').update(JSON.stringify([src, pieces.map(x => [x.kind, x.id, x.ranges, x.source || null])])).digest('hex').slice(0, 12) : '';
  return { source: src, pieces, seconds, key };
}
// what the next Draft is made from: your pieces when you kept any (finish.from auto), or the whole take
function draftFrom(s, combo = comboOf(s)) {
  const f = (s.finish && s.finish.from) || 'auto', own = combo.pieces.some(x => x.kind !== 'testimonial');
  return f === 'take' || !own ? 'take' : 'pieces';
}
const draftKey = (s, combo = comboOf(s)) => draftFrom(s, combo) === 'pieces' ? 'pieces:' + combo.key : 'take:' + footageKey(s);
// the pieces as already cut files, with a clips.json beside them that carries each one's words (one transcript)
function comboFiles(s, combo) {
  const W = {}, wordsFor = rel => (W[rel] = W[rel] || wordsOf(rel) || []), words = wordsFor(combo.source), cutsDir = join(ROOT, `inbox/studio/${s.job}/cuts`), cj = join(cutsDir, 'clips.json');
  let prev = []; try { prev = JSON.parse(readFileSync(cj, 'utf8')).clips || []; } catch {}
  const entries = combo.pieces.map((x, k) => { const w = CUT.clipWords(x.source ? wordsFor(x.source) : words, x.ranges);
    return { id: `clip-${String(k + 1).padStart(3, '0')}`, file: `cuts/${x.id}.mp4`, take: (x.source || combo.source).split('/').pop(), ranges: x.ranges, src_in: x.ranges[0][0], src_out: x.ranges[x.ranges.length - 1][1], dur: x.seconds, status: 'keep', text: w.map(y => y[2]).join(' '), words: w }; });
  mkdirSync(cutsDir, { recursive: true });
  writeFileSync(cj, JSON.stringify({ src: combo.source, takes: [combo.source.split('/').pop()], order: 'files', precut: true, clips: [...prev.filter(y => !entries.some(e => e.file === y.file)), ...entries] }, null, 1));
  const steps = combo.pieces.map(x => ['kit/studio/cut-run.mjs', ['extract', '--src', x.source || combo.source, '--ranges', x.ranges.map(r => r.join('-')).join(','), '--out', `inbox/studio/${s.job}/cuts/${x.id}.mp4`]]);
  return { steps, files: combo.pieces.map(x => `inbox/studio/${s.job}/cuts/${x.id}.mp4`) };
}
// the exports of the one Render: each piece as its own reel (clips) or as a plain clip (plain), from the Combo
function exportSteps(s, combo0, { clips, plain }) {
  const steps = [], plan = [], combo = { ...combo0, pieces: combo0.pieces.filter(x => x.kind !== 'testimonial') };
  if (!combo.pieces.length || (!clips && !plain)) return { steps, plan };
  const cand = combo.pieces.map((x, k) => ({ id: x.id, kind: x.cutKind, ranges: x.ranges, keep: true, order: k, label: x.label }));
  const r = cutSteps(s, null, { source: combo.source, candidates: cand });
  if (clips) { steps.push(...r.steps); plan.push(...r.plan); }
  else steps.push(...r.steps.filter(x => x[1][0] === 'extract'));
  return { steps, plan, plain: plain ? combo.pieces.map(x => `inbox/studio/${s.job}/cuts/${x.id}.mp4`) : [] };
}
// Your edit: what you are making, from what, the look, b-roll, sound and what comes next, in plain words (every step
// shows it; MCP get_edit reads it)
// how many pieces the user sees: a Combo's back to back lines play as one range but count one each
const pieceN = combo => combo.pieces.reduce((a, x) => a + (x.kind === 'piece' && x.lines ? x.lines.length : 1), 0);
function editOf(s, v) {
  const combo = v.combo, o = outputOf(s), cut = v.cut || {}, from = draftFrom(s, combo), fin = { ...C.defaultState().finish, ...(s.finish || {}) };
  const fmt = (CUT.FORMATS[o.format] || {}).label || o.format, aspect = CUT.aspectOf(o);
  const takes = s.footage.length, src = combo.source ? basename(combo.source) : null;
  const making = [fin.reel ? `1 ${o.format === 'long' ? 'long form video' : 'reel'}` : null, fin.clips && combo.pieces.length ? `${combo.pieces.length} clip${combo.pieces.length === 1 ? '' : 's'}` : null, fin.plain && combo.pieces.length ? 'plain clips' : null].filter(Boolean).join(' and ') || 'nothing yet';
  const picks = Object.values(s.picks || {}).reduce((a, p) => a + (p.allow || []).length + (p.deny || []).length, 0);
  const ref = s.reference && s.reference.extracted && s.reference.mode !== 'off' ? (s.reference.mode === 'recreate' ? 'recreate' : 'influence') : null;
  const spots = ((v.broll && v.broll.beats) || []).filter(b => b.slot).length;
  const drafted = s.drafted && s.drafted.key === draftKey(s, combo);
  const next = !takes && !s.clips ? { step: 'footage', label: 'Add footage' } : !s.job ? { step: 'footage', label: 'Name the reel' } : !drafted && fin.reel ? { step: 'finish', label: 'Draft it' } : { step: 'finish', label: 'Render' };
  return {
    making: { text: making, format: fmt, aspect, goal: o.goal, length: (cut.summary && cut.summary.length) || null },
    from: { takes, source: src, seconds: from === 'pieces' ? combo.seconds : (cut.seconds || null), mode: from, pieces: combo.pieces.length, text: from === 'pieces' ? `${pieceN(combo)} piece${pieceN(combo) === 1 ? '' : 's'}, ${Math.round(combo.seconds)} s, in your order${(() => { const by = piecesState(s, combo.source).by; return by && combo.pieces.some(x => x.kind === 'piece') ? (by === 'ai' ? ', picked by AI' : by === 'you' ? ', built by you' : `, ${by === 'ai, changed by you' ? 'picked by AI, changed by you' : 'set by ' + by}`) : ''; })()}` : takes ? `the whole take${takes > 1 ? ` (${takes} files)` : ''}` : 'no footage yet' },
    look: { pack: s.pack || null, reference: ref, picks, text: [s.pack || 'Studio picks', ref ? `reference (${ref})` : null, picks ? `${picks} change${picks === 1 ? '' : 's'} by you` : null].filter(Boolean).join(', ') },
    broll: { spots, ideas: ((v.broll && v.broll.beats) || []).filter(b => b.idea && !b.slot).length, cutins: combo.pieces.filter(x => x.kind === 'testimonial').length, text: [spots ? `${spots} spot${spots === 1 ? '' : 's'}` : 'none yet', combo.pieces.some(x => x.kind === 'testimonial') ? `${combo.pieces.filter(x => x.kind === 'testimonial').length} testimonial` : null].filter(Boolean).join(', ') },
    sound: { bed: s.music.bed, sfx: s.sound.sfx, text: `${s.music.bed === 'auto' ? 'Music picked for you' : s.music.bed === 'none' ? 'No music' : s.music.bed}, sounds ${s.sound.sfx}` },
    drafted: !!drafted, stale: !!(s.drafted && !drafted && fin.reel), next,
  };
}

// ---------- the Outputs library: every version with the settings that made it ----------
// Each Render writes jobs/<job>/reel-vN.settings.json beside the reel (what Your edit said at that moment, the
// Combo's pieces and the files), so a version can say how it was made long after the session moved on.
function saveSettings(s) {
  const dir = join(ROOT, 'jobs', s.job || '-'); let v = 0; try { v = Math.max(0, ...readdirSync(dir).map(f => +(f.match(/^reel-v(\d+)\.mp4$/) || [0, 0])[1])); } catch {} if (!v) return null;
  const vw = view(s), e = vw.edit, combo = vw.combo, files = C.outputsOf(s).filter(f => new RegExp(`reel(-fx)?-v${v}(-[a-z0-9]+)?\\.mp4$`).test(f));
  const out = { version: v, at: new Date().toISOString(), job: s.job, making: e.making.text, format: e.making.format, look: e.look.text, pack: s.pack || null, reference: e.look.reference, from: e.from.text, pieces: combo.pieces.map(x => ({ id: x.id, kind: x.kind, label: x.label, seconds: x.seconds, lines: x.lines || null })), count: pieceN(combo), seconds: combo.seconds,
    broll: e.broll.text, sound: e.sound.text, export: s.export || null, files };
  try { writeFileSync(join(dir, `reel-v${v}.settings.json`), JSON.stringify(out, null, 1)); } catch {}
  return out;
}
function versionsOf(job) {
  const dir = join(ROOT, 'jobs', job); if (!existsSync(dir)) return [];
  const files = C.outputsOf({ job }), snaps = Object.fromEntries((() => { try { return SNAP.list(dir); } catch { return []; } })().map(x => [x.v, x]));
  const vs = [...new Set(files.map(f => +(f.match(/reel(?:-fx)?-v(\d+)[^/]*$/) || [0, 0])[1]).filter(Boolean))].sort((a, b) => b - a);
  return vs.map(v => { let st = null; try { st = JSON.parse(readFileSync(join(dir, `reel-v${v}.settings.json`), 'utf8')); } catch {}
    const fs_ = files.filter(f => new RegExp(`/reel(-fx)?-v${v}(-[a-z0-9]+)?\\.mp4$`).test(f)), main = fs_.find(f => new RegExp(`/reel-v${v}\\.mp4$`).test(f)) || fs_[0];
    let at = null; try { at = statSync(join(ROOT, main)).mtime.toISOString(); } catch {}
    return { v, reel: main, files: fs_.map(f => ({ path: f, label: /-fx-/.test(f) ? 'With effects' : new RegExp(`-v${v}\\.mp4$`).test(f) ? 'Reel' : 'Export ' + (f.match(/-v\d+-([a-z0-9]+)\.mp4$/) || [0, ''])[1] })).sort((a, b) => (a.label === 'Reel' ? 0 : a.label === 'With effects' ? 1 : 2) - (b.label === 'Reel' ? 0 : b.label === 'With effects' ? 1 : 2) || a.path.localeCompare(b.path)), at: (st && st.at) || at, seconds: main ? +(durOf(main) || 0).toFixed(1) || null : null,
      settings: st, reopen: !!(snaps[v] && snaps[v].snapshot) }; });
}
function outputsLib(s, all) {
  const out = { job: s.job, versions: s.job ? versionsOf(s.job) : [] };
  if (all) out.jobs = C.listVideos(s.job).filter(x => x.job !== s.job && x.outputs).slice(0, 60).map(x => { const vs = versionsOf(x.job), last = vs[0];
    return { job: x.job, at: x.at, versions: vs.length, look: last && last.settings ? last.settings.look : null, seconds: last ? last.seconds : null }; });
  return out;
}
// a reference's words: from its teardown when it has speech, otherwise transcribed here
function refWords(s) {
  const out = s.reference && s.reference.out; if (out) for (const f of ['speech.json', 'fallback.json', join('videomd', 'breakdown.json')]) {
    try { const j = JSON.parse(readFileSync(join(ROOT, out, f), 'utf8')), sp = j.words ? j : j.speech; if (sp && Array.isArray(sp.words) && sp.words.length) return sp.words; } catch {}
  }
  const file = s.reference && s.reference.file; return file && existsSync(join(ROOT, file)) ? wordsOf(file) : null;
}
function pullScript(s) {
  const words = refWords(s); if (!words) return null;
  const q = (s.reference.queue || []).find(x => x.id === s.reference.active), from = (q && q.url) || s.reference.url || s.reference.file || 'the reference';
  const text = CUT.scriptFrom(words); if (!text) throw Object.assign(new Error('the reference has no speech to pull'), { code: 400 });
  const title = `From the reference${q && q.title ? ': ' + q.title : ''}`.slice(0, 100);
  const sc = SC.write(s.job, { title, text, by: 'reference transcript', from });
  update(x => { x.scriptsAt = Date.now(); C.applyPatch(x, { reply: `Pulled the reference's script into Scripts: "${sc.title}", ${sc.words} words.`, from: 'assistant', kind: 'action' }); });
  return sc;
}
const ADAPT_RULES = 'Keep the same structure: the [hook], [body] and [cta] sections, about the same number of lines and words, the same [pause] marks and the same pacing. Change the subject and the details to the new topic. Keep it in the speaker\'s own voice.';
async function adaptScript(s, id, topic) {
  const sc = SC.get(s.job, id), st = S.load(), a = CH.presence();
  if (st.chat.backend === 'agent') {
    const line = `Adapt the script "${sc.title}" (id ${sc.id}) to my topic: ${topic}. ${ADAPT_RULES} Run the humanizer skill (skills/humanizer) on the draft, then save it with write_script as a new script titled "${sc.title.slice(0, 60)} (adapted)" with from "adapted from ${sc.id}". Keep the original as it is.`;
    update(x => { C.applyPatch(x, { say: line, from: 'ui', toAgent: true, attach: { kind: 'adapt', script: sc.id, topic } }); });
    return { via: 'agent', queued: true, agent: a };
  }
  if (!LLM.provider(KEYS.envWithKeys(), st.chat)) throw Object.assign(new Error('Adapting a script needs your terminal agent, an API key or a local model (Settings).'), { code: 400 });
  const r = await LLM.complete('You rewrite talking-head scripts. ' + SC.SCRIPT_FORMAT + ' Write it so it sounds human: ' + SC.HUMANIZER_RULES.join(' ') + ' Reply with JSON only: {"title": "...", "text": "..."}.',
    `${ADAPT_RULES}\nNew topic: ${topic}\nScript:\n${sc.text}`, KEYS.envWithKeys(), st.chat, { maxTokens: 2500 });
  let j; try { j = JSON.parse(String(r.text).match(/\{[\s\S]*\}/)[0]); } catch { throw Object.assign(new Error('the model did not send a script back'), { code: 502 }); }
  const out = SC.write(s.job, { title: String(j.title || `${sc.title} (adapted)`).slice(0, 100), text: String(j.text || '').replace(/\u2014/g, ', '), wpm: sc.wpm, by: r.model || r.provider, from: `adapted from ${sc.id}` });
  update(x => { x.scriptsAt = Date.now(); });
  return { via: r.provider, script: out };
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
  st.reference = { ...st.reference, active: it.id, file: it.file, url: it.url, status: 'ready', out: it.out, extracted: it.extracted, contact: it.contact || null, applied: false, auto: null };
  C.setReferenceLook(st); // Recreate or Influence: the Look is set from it now, so nobody has to pick it again
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
      const it = { id, url: c.url || url, site: c.site || null, via: c.via || null, status: c.ok && !miss ? 'queued' : 'failed', progress: 0, error: c.ok ? miss : c.error, hint: miss || null, fix: miss ? F.fixOf(miss) : null, at: new Date().toISOString() };
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
      end: (status, lines) => { if (status !== 'done') setItem(it.id, x => { if (x.status !== 'ready') { x.status = status === 'cancelled' ? 'cancelled' : 'failed'; const e = lines.filter(l => /download failed|error|Error|failed|not found/i.test(l) && !l.startsWith('$')).pop(); x.fix = F.fixOf(e); x.error = (e || lines[lines.length - 1] || 'failed').replace(/^download failed: /, '').slice(0, 300); } }); },
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
  const prov = backend === 'keywords' ? null : LLM.provider(KEYS.envWithKeys(), st.chat);
  if (prov) {
    try {
      const r = await LLM.chat(text, s, cat, KEYS.envWithKeys(), st.chat, SC.list(s.job)); reply = r.reply; patch = r.patch; via = r.provider;
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

let chromeSeen = null; const chromeOk = () => { if (chromeSeen == null) { try { chromeSeen = !!findChrome(); } catch { chromeSeen = false; } } return chromeSeen; };
// Settings folder fields: the native folder dialog, the in-page folder list, New folder and Open folder (kit/studio/folders.mjs)
const FOLDERS = mountFolders({ ROOT, json, readBody, extraFolders: () => { const st = S.load(); return [st.downloads, st.renders, st.broll && st.broll.library, join(ROOT, 'teardown-in', 'studio'), join(ROOT, 'jobs')]; },
  ensure: [join(ROOT, 'teardown-in', 'studio'), join(ROOT, 'jobs')] });
const POSTR = mountPost({ ROOT, C, json, readBody });
// the reference's b-roll parts, on its own clock as a fraction of its length, become spots (kit/studio/lane.mjs spots)
const refBroll = s => { if (!s.reference || s.reference.mode === 'off') return []; const sw = swapOf(s); if (!sw || !sw.seconds) return [];
  return (sw.parts || []).filter(p => p.kind === 'broll').map(p => ({ frac: p.at / sw.seconds, label: p.label, detail: p.detail })); };
const BRL = mountBroll({ ROOT, C, update, json, readBody, serveFile: (...a) => serveFile(...a), CH, capturePage, chromeOk, refParts: refBroll,
  transcribe: (rel, done) => { startTranscribe(rel, () => done(null)); if (MEDIA.transcribing(rel)) watchTx(rel, done); }, wordsOf, energyOf });
// startTranscribe calls back only on success; a raw upload also wants to hear a failure
function watchTx(rel, done) { const t = setInterval(() => { const x = (C.load().tx || {})[rel]; if (x && x.status === 'failed') { clearInterval(t); done(Object.assign(new Error(x.error || 'transcription failed'), { fix: x.fix })); } else if (!MEDIA.transcribing(rel)) clearInterval(t); }, 500); }
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
    return json(res, 200, { agents: AGT.setups({ url }), prompt: AGT.setupPrompt({ url }), install: AGT.INSTALL_LINE, selected: S.load().agent, agent: CH.presence(), name: AGT.NAME, say: AGT.SAY });
  }
  if (p === '/api/setup' && M === 'GET') { const st = setupStatus(u.searchParams.has('fresh')); return json(res, 200, setupForPage(st)); }
  // ---------- footage player and the Cut step ----------
  if (p === '/api/footage/info' && M === 'GET') {
    const s = C.load(), rel = u.searchParams.get('path'); if (!okFootage(s, rel)) return json(res, 404, { error: 'not in the footage' });
    const info = MEDIA.probe(rel), want = MEDIA.needsProxy(info, rel), px = want ? MEDIA.proxy(rel, () => pushState()) : null;
    const tx = (s.tx || {})[rel] || (MEDIA.transcript(rel) ? { status: 'ready' } : null);
    return json(res, 200, { path: rel, info, proxy: px ? { status: px.status, url: px.status === 'ready' ? '/api/footage/proxy?path=' + encodeURIComponent(rel) : null } : null, tx });
  }
  if (p === '/api/footage/proxy' && M === 'GET') { const s = C.load(), rel = u.searchParams.get('path'); if (!okFootage(s, rel)) return json(res, 404, { error: 'not in the footage' }); const f = MEDIA.proxyPath(rel); return f ? serveFile(req, res, f) : json(res, 404, { error: 'no preview copy yet' }); }
  if (p === '/api/footage/peaks' && M === 'GET') { const s = C.load(), rel = u.searchParams.get('path'); if (!okFootage(s, rel)) return json(res, 404, { error: 'not in the footage' }); const pk = await MEDIA.peaks(rel); return json(res, 200, pk || { n: 0, seconds: null, peaks: null, error: 'no waveform (ffmpeg is missing or the file has no sound)' }); }
  if (p === '/api/cut/transcribe' && M === 'POST') { const b = await readBody(req), s = C.load(), rel = cutSource(s, b.path); if (!rel) return json(res, 400, { error: 'add footage first' }); startTranscribe(rel); return json(res, 202, view(C.load())); }
  if (p === '/api/cut/transcript' && M === 'GET') {
    const s = C.load(), rel = cutSource(s, u.searchParams.get('path')); if (!rel) return json(res, 400, { error: 'add footage first' });
    const t = MEDIA.transcript(rel); if (!t) return json(res, 200, { path: rel, words: null, ready: false, tx: (s.tx || {})[rel] || null });
    return json(res, 200, { path: rel, duration: t.duration, words: t.words, sentences: CUT.sentences(t.words).map(x => ({ i: x.i, start: x.start, end: x.end, text: x.text })), marks: CUT.marks(t.words) });
  }
  if (p === '/api/cut' && M === 'GET') {
    const s = C.load(), v = cutView(s), t = v.source && MEDIA.transcript(v.source);
    return json(res, 200, { ...v, lengthSeconds: Object.fromEntries(Object.entries(CUT.FORMATS).map(([k, f]) => [k, f.lengths])), sentences: t ? CUT.sentences(t.words).map(x => ({ i: x.i, start: x.start, end: x.end, text: x.text })) : null });
  }
  if (p === '/api/cut/output' && M === 'POST') {
    const b = await readBody(req), s = C.load();
    if (b.reset) { const s2 = update(x => { x.output = null; }); return json(res, 200, view(s2)); }
    const { source, ...patch } = b, r = CUT.normalize(outputOf(s), patch); if (r.errs.length) return json(res, 400, { error: r.errs.join('; ') });
    const s2 = update(x => { x.output = r.output; if (source && okFootage(x, source)) x.cut = x.cut && x.cut.source === source ? x.cut : { source, candidates: [], scoredBy: null }; });
    return json(res, 200, view(s2));
  }
  if (p === '/api/cut/find' && M === 'POST') {
    const b = await readBody(req), s = C.load(), rel = cutSource(s, b.path); if (!rel) return json(res, 400, { error: 'add footage first' });
    if (!['auto', 'rules', 'model', 'agent'].includes(b.scorer || 'auto')) return json(res, 400, { error: 'scorer: auto, rules, model or agent' });
    if (!MEDIA.transcript(rel)) { update(x => { x.cut = { source: rel, candidates: [], scoredBy: null, pending: 'transcript' }; }); startTranscribe(rel, () => findCuts(rel, b.scorer || 'auto').catch(e => console.error(e.message))); return json(res, 202, { transcribing: true, ...view(C.load()) }); }
    const who = await findCuts(rel, b.scorer || 'auto'); return json(res, 200, { scorer: who, ...view(C.load()) });
  }
  if (p === '/api/cut/edit' && M === 'POST') { const b = await readBody(req); return json(res, 200, view(await editCut(b))); }
  if (p === '/api/cut/set' && M === 'POST') { const b = await readBody(req); return json(res, 200, view(await setCuts(b))); }
  if (p === '/api/cut/render' && M === 'POST') {
    const b = await readBody(req), miss = needFor('render'); const s = C.load(); const r = cutSteps(s, Array.isArray(b.ids) ? b.ids : null); if (miss) return json(res, 400, miss);
    // only: 'file' saves each kept cut as a plain clip (the extract, no edit), like the bites below
    const steps = b.only === 'file' ? r.steps.filter(x => x[1][0] === 'extract') : r.steps;
    runTask('cuts', () => steps, () => ({ cuts: r.plan.map(x => ({ ...x, outputs: C.outputsOf({ job: x.job }) })), copiedTo: b.only === 'file' ? [] : copyRenders(r.plan.flatMap(x => C.outputsOf({ job: x.job }).slice(0, 1))) }));
    return json(res, 202, { plan: r.plan, ...view(C.load()) });
  }
  if (await FOLDERS(p, M, u, req, res)) return;
  if (await BRL.route(p, M, u, req, res)) return;
  if (await POSTR.route(p, M, u, req, res)) return;
  if (p === '/api/lines' && M === 'GET') return json(res, 200, await linesView(C.load(), u.searchParams.get('path')));
  if (p === '/api/lines' && M === 'POST') { const b = await readBody(req); const r = await editLines(b); return json(res, 200, { lines: r.view, ...view(r.s) }); }
  if (p === '/api/lines/render' && M === 'POST') {
    const b = await readBody(req), miss = needFor('render'), s = C.load(); const r = await biteSteps(s, Array.isArray(b.ids) ? b.ids : null, b.path); if (miss) return json(res, 400, miss);
    // only: 'file' joins the lines into one file (no edit), for the clean take as a plain video
    const steps = b.only === 'file' ? r.steps.filter(x => x[1][0] === 'extract') : r.steps;
    runTask('bites', () => steps, () => ({ bites: r.plan.map(x => ({ ...x, outputs: C.outputsOf({ job: x.job }) })), copiedTo: b.only === 'file' ? [] : copyRenders(r.plan.flatMap(x => C.outputsOf({ job: x.job }).slice(0, 1))) }));
    return json(res, 202, { plan: r.plan, ...view(C.load()) });
  }
  if (p === '/api/footage/move' && M === 'POST') {
    const b = await readBody(req);
    const s = update(st => {
      if (Array.isArray(b.order)) { const same = b.order.length === st.footage.length && b.order.every(f => st.footage.includes(f)); if (!same) throw bad('order: every footage path once'); st.footage = b.order.slice(); return; }
      const k = st.footage.indexOf(b.path); if (k < 0) throw Object.assign(new Error('not in the footage'), { code: 404 });
      const j = Math.max(0, Math.min(st.footage.length - 1, b.to != null ? +b.to : k + (b.dir > 0 ? 1 : -1))); const [f] = st.footage.splice(k, 1); st.footage.splice(j, 0, f);
    });
    return json(res, 200, view(s));
  }
  if (p === '/api/reference/script' && M === 'POST') {
    const s = C.load(); if (!s.job) return json(res, 400, { error: 'name the job first' });
    const sc = pullScript(s); if (sc) return json(res, 200, { script: sc, ...view(C.load()) });
    const file = s.reference && s.reference.file; if (!file || !existsSync(join(ROOT, file))) return json(res, 400, { error: 'add a reference first' });
    startTranscribe(file, () => { try { pullScript(C.load()); } catch (e) { console.error(e.message); } });
    return json(res, 202, { transcribing: true, ...view(C.load()) });
  }
  if (p === '/api/scripts/adapt' && M === 'POST') {
    const b = await readBody(req), s = C.load(), topic = String(b.topic || '').trim().slice(0, 300);
    if (!s.job) return json(res, 400, { error: 'name the job first' }); if (!topic) return json(res, 400, { error: 'say your topic' });
    const r = await adaptScript(s, String(b.id || ''), topic); return json(res, 200, { ...r, ...view(C.load()) });
  }
  // Fix buttons (kit/studio/fixes.mjs). Install: the same step as setup (kit/setup.mjs --only <step>, nothing else), then a
  // fresh look at the tools and the setup list, so the page updates without a restart. /api/tools/install is the old name.
  if ((p === '/api/fix/install' || p === '/api/tools/install') && M === 'POST') {
    const b = await readBody(req), id = String(b.id || b.tool || ''), step = FX.stepOf(id);
    if (!step) return json(res, 400, { error: `Studio cannot install ${FX.describe(id) ? FX.describe(id).label : 'that'} by itself. Your agent can.` });
    runTask('install', () => [[process.env.STUDIO_SETUP || 'kit/setup.mjs', ['--only', step]]], () => {
      const t = F.tools({ fresh: true }), st = setupStatus(true), item = st.items.find(x => x.id === id);
      return { fix: id, tool: id, ready: !!(item && item.status === 'ready'), ytdlp: t.ytdlp ? t.ytdlp.version : null, instaloader: t.instaloader };
    });
    task.fix = id;
    return json(res, 202, view(C.load()));
  }
  // Send to my agent: the fix's instruction goes to the connected terminal agent through the Studio chat channel
  if (p === '/api/fix/send' && M === 'POST') {
    const b = await readBody(req), text = FX.prompt(String(b.id || ''));
    if (!text) return json(res, 400, { error: 'Nothing to send for that.' });
    if (S.load().chat.backend !== 'agent') return json(res, 400, { error: 'Connect your agent first (Connect agent, top right).' });
    // the page shows the short ask (attach.kind fix); the agent reads the whole instruction
    return json(res, 200, await chatTurn(text, false, { kind: 'fix', fix: String(b.id), label: FX.describe(String(b.id)).label }));
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
      update(st => { st.reference.status = 'ready'; st.reference.extracted = ex; st.reference.out = t.out; st.reference.contact = existsSync(join(ROOT, t.out, 'contact.jpg')) ? `${t.out}/contact.jpg`.split(sep).join('/') : null; st.reference.auto = null; C.setReferenceLook(st); });
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
      update(st => { st.reference.queue = st.reference.queue.filter(x => x.id !== id); if (st.reference.active === id) { C.undoReferenceLook(st); } if (st.reference.active === id) st.reference = { ...st.reference, active: null, file: null, url: null, status: 'none', out: null, extracted: null, applied: false, contact: null }; });
    } else return json(res, 400, { error: 'action: use, retry or remove' });
    return json(res, 200, view(C.load()));
  }
  if (p === '/api/reference/clear' && M === 'POST') {
    // Clear reference: the reference and every pick it added go, as one undo ({ undo: true } puts it all back)
    const b = await readBody(req).catch(() => ({}));
    if (b.undo) { const s0 = C.load(); if (!s0.undoRef) return json(res, 400, { error: 'nothing to undo' });
      const st = update(x => { const u = x.undoRef; x.reference = u.reference; x.picks = u.picks; x.pack = u.pack; x.music = u.music; delete x.undoRef; }); return json(res, 200, { ...view(st), note: 'The reference is back, with its picks.' }); }
    const s0 = C.load(); if (!s0.reference.extracted && !s0.reference.file && !s0.reference.url) return json(res, 400, { error: 'no reference to clear' });
    let n = 0;
    const st = update(x => { x.undoRef = JSON.parse(JSON.stringify({ reference: x.reference, picks: x.picks, pack: x.pack || null, music: x.music }));
      n = C.undoReferenceLook(x);
      x.reference = { ...x.reference, active: null, file: null, url: null, status: 'none', out: null, extracted: null, applied: false, contact: null, added: [], prev: null, auto: null }; });
    return json(res, 200, { ...view(st), note: `Cleared the reference${n ? ` and the ${n} pick${n === 1 ? '' : 's'} it added` : ''}. Undo puts it back.` });
  }
  if (p === '/api/reference/apply' && M === 'POST') {
    const s = C.load(), ex = s.reference.extracted; if (!ex) return json(res, 400, { error: 'tear down a reference first' });
    const b = await readBody(req).catch(() => ({})), cat = C.catalog();
    const picks = Array.isArray(b.refs) ? Object.fromEntries(b.refs.filter(r => cat.items[r]).map(r => [r, 'allow'])) : C.referencePicks(ex, b.kinds || null, cat);
    const patch = { picks, ...(ex.music.bed && cat.beds.some(b => b.id === ex.music.bed) ? { music: { bed: ex.music.bed } } : {}), ...(ex.preset && cat.packs.some(x => x.name === ex.preset) ? { pack: ex.preset } : {}) };
    if (Array.isArray(b.refs) || b.kinds) { delete patch.music; delete patch.pack; }
    // what Use parts adds, so Clear reference can take exactly that back out
    const had = new Set(Object.entries(s.picks).flatMap(([k, v]) => (v.allow || []).map(id => `${k}:${id}`)));
    const prev = { pack: s.pack || null, bed: s.music && s.music.bed };
    const r = C.applyPatch(s, patch); s.reference.applied = true;
    s.reference.added = [...new Set([...(s.reference.added || []), ...Object.keys(picks).filter(x => !had.has(x))])];
    s.reference.prev = s.reference.prev || { ...(patch.pack ? { pack: prev.pack } : {}), ...(patch.music ? { bed: prev.bed } : {}) };
    C.save(s); pushState();
    return json(res, 200, { ...view(s), log: r.log, errs: r.errs });
  }
  if (p === '/api/draft' && M === 'POST') {
    const s = C.load(); const d = draftSteps(s); // checks the footage first, so an empty job says that before a missing tool
    const miss = needFor('draft'); if (miss) return json(res, 400, miss);
    update(st => { st.lockedAtDraft = d.lockString || ''; st.drafted = null; });
    runTask('draft', () => d.steps, () => { update(st => { st.drafted = { key: d.key, from: d.from, pieces: d.pieces || 0, at: Date.now() }; }); BRL.autoPick(s.job); return { choices: !!readChoices(C.load()), note: DRAFT_DONE, from: d.from }; });
    return json(res, 202, { ...view(C.load()), from: d.from });
  }
  // ---------- pieces and the Combo (kit/studio/pieces.mjs) ----------
  if (p === '/api/pieces' && M === 'GET') { const s = C.load(), rel = cutSource(s, u.searchParams.get('path')); if (!rel) return json(res, 400, { error: 'add footage first' });
    const L = await linesOf(rel); if (!L) return json(res, 200, { source: rel, pending: 'transcript', pieces: [], cats: PIECES.CATS, topics: [], combo: { ids: [], reasons: {}, by: null, seconds: 0 } });
    return json(res, 200, piecesOf(C.load(), rel)); }
  if (p === '/api/pieces' && M === 'POST') {
    // { choose: true } Let AI choose; { ids, reasons, by } your Combo; { add, remove, move: { id, to } } one piece;
    // { clear: true }; { cats: { <piece id>: category } } move pieces to another category (null puts the rules' back)
    const b = await readBody(req), s0 = C.load(), rel = cutSource(s0, b.path); if (!rel) return json(res, 400, { error: 'add footage first' });
    if (!(await linesOf(rel))) return json(res, 400, { error: 'transcribe the footage first (Find cuts or Transcribe on the Cut step)' });
    const P = piecesOf(s0, rel), by = Object.fromEntries(P.pieces.map(x => [x.id, x])), who = b.by ? CH.prettyName(String(b.by)) : 'you';
    for (const id of [...(Array.isArray(b.ids) ? b.ids : []), b.add, b.remove, b.move && b.move.id].filter(x => x != null)) if (!by[id]) return json(res, 400, { error: `no piece ${id} (get_pieces lists them)` });
    if (b.cats) for (const [id, c] of Object.entries(b.cats)) { if (!by[id]) return json(res, 400, { error: `no piece ${id}` }); if (c !== null && !PIECES.CAT_IDS.includes(c)) return json(res, 400, { error: `category: ${PIECES.CAT_IDS.join(', ')}` }); }
    let note = null;
    update(st => { st.pieces = st.pieces || {}; const x = st.pieces[rel] = { ...piecesState(st, rel) }; x.ids = [...(x.ids || [])]; x.reasons = { ...(x.reasons || {}) }; x.cats = { ...(x.cats || {}) };
      if (b.cats) for (const [id, c] of Object.entries(b.cats)) { if (c === null) delete x.cats[id]; else x.cats[id] = c; }
      if (b.choose) { const r = CUT.range(outputOf(st)), mn = r[0], mx = r[1] == null ? r[0] * 1.33 : r[1];
        const ch = PIECES.choose(piecesOf(st, rel).pieces, { min: mn, max: mx }); x.ids = ch.ids; x.reasons = ch.reasons; x.by = 'ai'; note = `Picked ${ch.ids.length} pieces, ${Math.round(ch.seconds)} s, for your Combo. Drag to reorder, click x to drop.`; }
      if (Array.isArray(b.ids)) { x.ids = [...new Set(b.ids.map(String))]; x.reasons = b.reasons && typeof b.reasons === 'object' ? Object.fromEntries(Object.entries(b.reasons).filter(([k]) => x.ids.includes(k)).map(([k, v]) => [k, String(v).replace(/\u2014/g, ', ').slice(0, 160)])) : {}; x.by = who === 'you' ? 'you' : who;
        if (who !== 'you') C.applyPatch(st, { reply: `${who} set your Combo: ${x.ids.length} piece${x.ids.length === 1 ? '' : 's'}.`, from: 'assistant', kind: 'action' }); }
      if (b.add != null && !x.ids.includes(b.add)) { x.ids.push(String(b.add)); x.by = x.by === 'ai' ? 'ai, changed by you' : x.by || 'you'; }
      if (b.remove != null) { x.ids = x.ids.filter(i => i !== b.remove); delete x.reasons[b.remove]; }
      if (b.move) { const k = x.ids.indexOf(b.move.id); if (k >= 0) { x.ids.splice(k, 1); x.ids.splice(Math.max(0, Math.min(x.ids.length, +b.move.to || 0)), 0, b.move.id); } }
      if (b.clear) { x.ids = []; x.reasons = {}; x.by = null; }
      if ((b.add != null || b.remove != null || b.move) && x.by === 'ai') x.by = 'ai, changed by you';
    });
    const s1 = C.load(); return json(res, 200, { ...view(s1), pieces: piecesOf(s1, rel), note });
  }
  if (p === '/api/outputs' && M === 'GET') return json(res, 200, outputsLib(C.load(), u.searchParams.get('all') === '1'));
  if (p === '/api/edit' && M === 'GET') { const v = view(C.load()); return json(res, 200, { edit: v.edit, combo: v.combo, finish: v.state.finish }); }
  if (p === '/api/render' && M === 'POST') {
    // the one Render: the reel (from the draft), and in the same run the exports you ticked in Finish: each piece as its
    // own reel (clips) or as a plain clip (plain). Body { exports: { reel, clips, plain } } overrides finish for this run.
    const s0 = C.load(), b = await readBody(req).catch(() => ({}));
    const fin = { ...C.defaultState().finish, ...(s0.finish || {}), ...(b.exports && typeof b.exports === 'object' ? Object.fromEntries(['reel', 'clips', 'plain'].filter(k => b.exports[k] !== undefined).map(k => [k, !!b.exports[k]])) : {}) };
    if (!fin.reel && !fin.clips && !fin.plain) return json(res, 400, { error: 'pick something to make: the reel, clips or plain clips' });
    const combo = comboOf(s0);
    if (!fin.reel && !combo.pieces.length) return json(res, 400, { error: 'keep a piece on the Cut step first, or turn the reel back on' });
    if (!fin.reel) {
      const miss = needFor('render'); if (miss) return json(res, 400, miss);
      const x = exportSteps(s0, combo, fin);
      runTask('render', () => x.steps, () => ({ cuts: x.plan.map(y => ({ ...y, outputs: C.outputsOf({ job: y.job }) })), plain: x.plain || [], copiedTo: copyRenders(x.plan.flatMap(y => C.outputsOf({ job: y.job }).slice(0, 1))) }));
      return json(res, 202, { ...view(C.load()), exports: fin, plan: x.plan });
    }
    const s = s0; const r = renderSteps(s), xs = exportSteps(s, combo, fin);
    // memory for the person mask (kit/memcheck.cjs): short, the page says so and offers titles in front or the lighter mask
    const mem = MC.renderCheck(join(ROOT, 'jobs', s.job, 'build'));
    if (mem.needed && !mem.ok && !['front', 'light', 'anyway'].includes(b.memory)) return json(res, 409, { error: mem.message, memory: mem });
    const miss = needFor('render'); if (miss) return json(res, 400, miss);
    if (b.memory === 'front') r.steps[0][1].push('--no-mask');
    if (b.memory === 'light') r.steps[0][1].push('--mask', 'mediapipe');
    if (b.memory === 'anyway') r.steps[0][2] = { ...(r.steps[0][2] || {}), MASK_FORCE: '1' };
    runTask('render', () => [...r.steps, ...xs.steps], () => { const st = C.load(), outputs = C.outputsOf(st); saveSettings(st); const cuts = xs.plan.map(y => ({ ...y, outputs: C.outputsOf({ job: y.job }) })); return { outputs, cuts, plain: xs.plain || [], copiedTo: copyRenders([...outputs, ...cuts.flatMap(y => y.outputs.slice(0, 1))]), fx: r.fx, effects: r.effects }; });
    return json(res, 202, { ...view(C.load()), exports: fin, plan: xs.plan, fx: r.fx, effectsSkipped: r.effects.length && !r.fx ? 'Effects are not set up on this computer, so this reel renders without them.' : null, ...(r.effects.length && !r.fx ? { fix: ['effects'] } : {}) });
  }
  // Edit this reel: the build behind a finished reel back into build/ (kit/snapshots.cjs); the build it replaces is saved
  if (p === '/api/reopen' && M === 'POST') {
    const b = await readBody(req), s = C.load();
    if (!s.job) return json(res, 400, { error: 'name the job first' });
    if (task && task.status === 'running') return json(res, 409, { error: 'wait for the running task to finish' });
    let r; try { r = SNAP.reopen(join(ROOT, 'jobs', s.job), String(b.reel || '').split('/').pop()); } catch (e) { return json(res, 400, { error: e.message }); }
    // the reopened build is what Render uses now, whatever the pieces say: it counts as drafted
    update(st => { st.drafted = { key: draftKey(st), from: 'reopen', reel: r.reel, at: Date.now() }; if (S.load().actionNotes !== false) C.applyPatch(st, { reply: `${r.reel} is back in the editor. Change the picks, then Render makes the next version.${r.backup ? ' The draft it replaced is saved as ' + r.backup + '.' : ''}`, from: 'Studio', kind: 'action' }); });
    return json(res, 200, { reopened: r, ...view(C.load()) });
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
    if (b.redraft !== false) { const s = C.load(), d = draftSteps(s); update(st => { st.lockedAtDraft = d.lockString || ''; st.drafted = null; }); runTask('draft', () => d.steps, () => { update(st => { st.drafted = { key: d.key, from: d.from, pieces: d.pieces || 0, at: Date.now() }; }); return { choices: !!readChoices(C.load()), cleanup: pl, note: DRAFT_DONE }; }); }
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
    // a time range (end after t) is a note on a stretch of the reel or the take, not one frame
    const end = b.end != null && +b.end > t + 0.05 ? +(+b.end).toFixed(2) : null, source = typeof b.source === 'string' && okFootage(s, b.source) ? b.source : null;
    const line = RV.commentLine({ text, t, end, region: rg, video: video || source, frame });
    return json(res, 200, await chatTurn(line, false, { kind: 'comment', t: +t.toFixed(2), ...(end != null ? { end } : {}), region: rg, video: video || source, frame, note: text }));
  }
  if (p === '/api/pack/save' && M === 'POST') {
    const b = await readBody(req), s = C.load(), name = String(b.name || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) return json(res, 400, { error: 'pack name: lowercase letters, numbers and dashes' });
    if (K.shipped().some(x => x.name === name)) return json(res, 400, { error: `${name} is a shipped pack; pick another name` });
    // a Look saved with a reference in use keeps the reference's look too (its soft defaults as the base)
    const useRef = b.reference !== false && s.reference.extracted && (b.fromReference || s.reference.mode !== 'off'), ref = useRef ? writeRefPack(s, { force: true }) : null;
    const comp = C.compose(s, { refPack: ref }), base = ref ? K.load(ref) : s.pack ? K.load(s.pack) : null, refName = ref && s.reference.extracted.name;
    const pack = { format: K.FORMAT, formatVersion: K.FORMAT_VERSION, name, version: '1.0.0', label: String(b.label || (refName ? `From the reference ${refName}` : `My look (${name})`)).slice(0, 80), description: String(b.label || (refName ? `Saved from Studio with the reference ${refName}.` : 'Saved from Studio.')).slice(0, 200), author: 'you', license: 'Apache-2.0',
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
  if (p === '/api/wizard' && M === 'GET') return json(res, 200, { wizards: WIZ.WIZARDS, goals: WIZ.GOALS, clipCounts: WIZ.CLIP_COUNTS });
  if (p === '/api/wizard' && M === 'POST') {
    // one wizard step (or all of them at once): reel { goal, look, choose }, clips { clips, ads }, reference { url }
    const b = await readBody(req), s0 = C.load(), w = WIZ.plan(b, C.catalog().packs.map(x => x.name)); if (w.errs.length) return json(res, 400, { error: w.errs.join('; ') });
    const rel = cutSource(s0, b.path), done = []; let next = null, pending = null, note = null;
    if ((w.wizard !== 'reference') && !rel) return json(res, 400, { error: 'add footage first, on the Footage step' });
    const setOut = o => { const r = CUT.normalize(outputOf(C.load()), o); if (r.errs.length) throw new Error(r.errs.join('; ')); update(x => { x.output = r.output; if (!x.cut || x.cut.source !== rel) x.cut = { source: rel, candidates: [], scoredBy: null }; }); };
    if (w.goal) { setOut(WIZ.GOALS[w.goal].out); done.push(`goal: ${WIZ.GOALS[w.goal].label}`); next = 'look'; }
    if (w.look) { update(x => { C.applyPatch(x, { pack: w.look }); }); done.push(`look: ${w.look}`); next = 'choose'; }
    if (w.choose) {
      if (!(await linesOf(rel))) { if (!MEDIA.transcript(rel)) startTranscribe(rel, () => findCuts(rel, 'auto').catch(e => console.error(e.message))); pending = 'transcript'; next = 'cut'; note = 'Transcribing the take first. Let AI choose on Cut when it is ready.'; }
      else { update(st => { const r = CUT.range(outputOf(st)), mn = r[0], mx = r[1] == null ? r[0] * 1.33 : r[1], ch = PIECES.choose(piecesOf(st, rel).pieces, { min: mn, max: mx });
        st.pieces = st.pieces || {}; st.pieces[rel] = { ...piecesState(st, rel), ids: ch.ids, reasons: ch.reasons, by: 'ai' }; note = `Picked ${ch.ids.length} pieces, ${Math.round(ch.seconds)} s, for your Combo. Draft it in Finish.`; });
        done.push('combo: AI chose'); next = 'finish'; }
    }
    if (w.wizard === 'clips') { setOut(WIZ.clipsOutput(w.clips, w.ads)); done.push(`clips: ${w.clips}${w.ads ? ' with ad cuts' : ''}`); next = 'cut';
      if (!MEDIA.transcript(rel)) { update(x => { x.cut = { source: rel, candidates: [], scoredBy: null, pending: 'transcript' }; }); startTranscribe(rel, () => findCuts(rel, 'auto').catch(e => console.error(e.message))); pending = 'transcript'; note = `Transcribing, then finding ${w.clips} clips on whole words.`; }
      else { await findCuts(rel, 'auto'); note = `Found the clips on whole words. Check them on Cut.`; } }
    if (w.wizard === 'reference') { update(st => { C.applyPatch(st, { reference: { mode: 'recreate' } }); }); const added = addLinks([w.url]); done.push('reference: reading it, Use all'); next = 'reference'; note = 'Reading the reference. We will set your look from it when it is ready.'; if (!added.length) note = 'That link is already in.'; }
    return json(res, 200, { ...view(C.load()), wizard: { done, next, pending, note } });
  }
  if (p === '/api/chat/apply' && M === 'POST') {
    // Apply on an agent's answer: the change it suggested (studio_reply suggest), made only when the user says so
    const b = await readBody(req), id = +b.id, s0 = C.load(), m = s0.chat.find(x => x.id === id);
    if (!m || !m.suggest) return json(res, 404, { error: 'no suggestion on that message' });
    if (m.applied) return json(res, 400, { error: 'already applied' });
    const g = m.suggest; let errs = [], log = [];
    const st = update(x => { const mm = x.chat.find(y => y.id === id);
      if (g.patch) { const r = C.applyPatch(x, g.patch); errs = r.errs; log = r.log; if (errs.length) return; }
      if (g.combo && Array.isArray(g.combo.ids)) { const rel = cutSource(x), P = rel ? piecesOf(x, rel) : null;
        if (!P) { errs.push('the take is not transcribed yet'); return; }
        const ok = new Set(P.pieces.map(p => p.id)), ids = g.combo.ids.map(String).filter(i => ok.has(i));
        x.pieces = x.pieces || {}; x.pieces[rel] = { ...piecesState(x, rel), ids, reasons: Object.fromEntries(Object.entries(g.combo.reasons || {}).filter(([k]) => ids.includes(k)).map(([k, v]) => [k, String(v).slice(0, 160)])), by: mm.from || 'agent' }; log.push(`combo: ${ids.length} pieces`); }
      mm.applied = new Date().toISOString();
      C.applyPatch(x, { reply: `Applied ${mm.from || 'your agent'}'s change${log.length ? ': ' + log.slice(0, 4).join(', ') : ''}.`, from: 'Studio', kind: 'action' }); });
    if (errs.length) return json(res, 400, { error: errs.join('; ') });
    return json(res, 200, { ...view(st), applied: log });
  }
  if (p === '/api/chat' && M === 'POST') {
    const b = await readBody(req), text = String(b.text || '').trim();
    if (!text) return json(res, 400, { error: 'say something' });
    // Ask my agent: the step it was asked from rides along, so the agent knows what "this" is
    const STEP = { footage: 'Footage', cut: 'Cut', look: 'Look', broll: 'B-roll', finish: 'Finish', post: 'Post' };
    const said = b.step && STEP[b.step] ? `(On the ${STEP[b.step]} step) ${text}` : text;
    return json(res, 200, await chatTurn(said, b.offline));
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
  // New video and Open a past video (kit/studio/core.mjs: freshSession, openSession). Nothing on disk is deleted.
  if (p === '/api/videos' && M === 'GET') { const s = C.load(); return json(res, 200, { videos: C.listVideos(s.job), current: s.job, busy: busyWith(s) }); }
  if (p === '/api/videos/new' && M === 'POST') { const b = await readBody(req); const { s, r } = switchVideo({ name: b.name, keepLook: b.keepLook !== false }); return json(res, 200, { ...view(s), video: r }); }
  if (p === '/api/videos/open' && M === 'POST') { const b = await readBody(req); const { s, r } = switchVideo({ open: String(b.job || '') }); return json(res, 200, { ...view(s), video: r }); }
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
    if (u.pathname.startsWith('/api/')) {
      // Requests which await work may still write the old edit when they finish. Do not switch underneath them.
      const changing = req.method !== 'GET' && !u.pathname.startsWith('/api/videos/') && u.pathname !== '/api/task/cancel';
      if (changing) activeRequests++;
      try { return await api(req, res, u); } finally { if (changing) activeRequests--; }
    }
    if (u.pathname === '/' || u.pathname === '/index.html') return serveFile(req, res, join(STUDIO, 'public', 'index.html'));
    if (/^\/(favicon\.svg|assets\/[\w.-]+\.(js|css))$/.test(u.pathname)) return serveFile(req, res, join(STUDIO, 'public', u.pathname.slice(1)));
    if (u.pathname.startsWith('/files/')) {
      const relp = decodeURIComponent(u.pathname.slice(7));
      const abs = resolve(ROOT, relp);
      if (!abs.startsWith(ROOT + sep) || relp.includes('..') || !SERVE.some(d => relp.startsWith(d)) || /(^|\/)\.studio\//.test(relp)) return json(res, 403, { error: 'not served' });
      return serveFile(req, res, abs);
    }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, { error: e.message, ...(e.fix ? { fix: e.fix } : {}) }); }
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
// a task, download, transcript or generate still marked running was cut off when Studio last stopped
if (C.settleStale(C.load())) update(st => { C.settleStale(st); });
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
