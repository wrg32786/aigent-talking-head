// The step by step builder (phase 4), in a real Chrome with no keys and no network:
// - the classic Start step links to it; #build=start opens the start screen with the three clip cards and Build my own
//   and Use a template (the Template Library, phase 8)
// - Build my own opens Pacing: the zone map, the Applies to line, five pace cards with their moving strips
// - picking a pace saves the plan (GET /api/video-plan) and today's pace setting (state.pace.tighten), and says what it does
// - Look, Sound and Finish (phase 7): filters on the hook only, music, Your notes with Change and All options, Make it
//   (Save as a template, Make my video); the old links still work
// - the Template Library (phase 8): on Teardowns your saved template with Rename, Duplicate and Delete (asks first),
//   the starters read only; New video's Use a template starts the video from one and opens Your notes
// - Repo or tool feature (phase 9): links checked before they are saved, full screen moments
// - no terminal text, both themes, phone width
// Needs Chrome. Run: node tests/studio-builder.e2e.mjs [--shots <dir>]
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-builder-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'builder-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR;
const C = await import('../kit/studio/core.mjs');
mkdirSync(SDIR, { recursive: true });
writeFileSync(join(SDIR, 'state.json'), JSON.stringify({ ...C.defaultState(), job: JOB }));
const LOOKS = join(STATE, 'looks');
const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, LOOKS_DIR: LOOKS, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const shot = async (pg, name) => { if (!shots) return; await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name), fullPage: true }); };
const CMD = /\bnpm\b|\bnode kit\/|terminal|\$ /i;
const noCmd = async (pg, what) => { const txt = await pg.innerText('#main'); const m = txt.match(CMD); assert.ok(!m, `${what} shows a command: ${m && txt.slice(Math.max(0, m.index - 40), m.index + 40)}`); };

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));

  await t('the classic Start step links to the builder; #build=start shows the clip cards, Build my own and Use a template', async () => {
    await open(pg, '#step=start'); await pg.waitForSelector('#build-open');
    await pg.click('#build-open'); await pg.waitForSelector('main[data-build="start"] #build-start');
    for (const id of ['#build-src-recording', '#build-src-upload', '#build-src-link', '#build-own', '#build-template']) assert.ok(await pg.isVisible(id), id);
    assert.strictEqual(await pg.isVisible('#stepper'), false, 'the classic step bar steps aside');
    assert.strictEqual(await pg.$('#build-name'), null, 'a named video asks for no name');
    await pg.click('#build-src-link'); await pg.waitForSelector('#build-start #footage-link');
    await noCmd(pg, 'the start screen'); await shot(pg, 'builder-start-dark.png');
  });

  await t('Build my own opens Pacing with the zone map, the Applies to line and five pace cards', async () => {
    await pg.click('#build-own'); await pg.waitForSelector('main[data-build="pace"] #build-pace');
    await pg.waitForFunction(() => document.activeElement && document.activeElement.id === 'build-h-pace');
    assert.match(await pg.textContent('#build-pace .applies'), /^Applies to: The whole video/);
    assert.ok(await pg.$('#build-pace svg[role="img"]'), 'the zone map');
    assert.deepStrictEqual(await pg.$$eval('#build-paces [data-pace]', e => e.map(x => x.dataset.pace)), ['look', 'calm', 'steady', 'lively', 'high']);
    assert.match(await pg.textContent('#build-count'), /^Pace, 1 of 1$/);
    assert.strictEqual(await pg.$('#build-sections [data-section][disabled]'), null, 'every section opens (Content came in phase 9)');
    for (const id of ['calm', 'steady', 'lively', 'high']) assert.match(await pg.getAttribute(`#build-paces [data-pace="${id}"] img`, 'src'), new RegExp(`paces/${id}\\.webp$`));
  });

  await t('picking Lively saves the plan and today\'s pace, and says what it does', async () => {
    await pg.click('#build-paces [data-pace="lively"]');
    await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-does'), /Tight lines/);
    const v = await api('/api/video-plan'); assert.strictEqual(v.plan.pace, 'lively'); assert.ok(v.plan.touched.includes('pace'));
    const st = (await api('/api/state')).state; assert.strictEqual(st.pace.tighten, 0.45);
    // arrow keys move the choice, as in any radio group
    await pg.focus('#build-paces [data-pace="lively"]'); await pg.keyboard.press('ArrowRight');
    await pg.waitForSelector('#build-paces [data-pace="high"][aria-checked="true"]'); await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.pace === 'high');
    await pg.keyboard.press('ArrowLeft'); await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.pace === 'lively');
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#build-paces [data-pace="lively"][aria-checked="true"]');
    await noCmd(pg, 'Pacing'); await shot(pg, 'builder-pace-dark.png');
  });

  await t('Next goes on to Words; Back returns to the start screen', async () => {
    await pg.click('#build-back'); await pg.waitForSelector('#build-start');
    await pg.click('#build-own'); await pg.waitForSelector('#build-pace');
    await pg.click('#build-next'); await pg.waitForSelector('main[data-build="captionType"] #build-captionType');
    await pg.click('#build-back'); await pg.waitForSelector('#build-pace');
    await open(pg, '#step=cut'); await pg.waitForSelector('main[data-step="cut"]:not([data-build])');
  });

  await t('Words on screen: type, look, how words come in, titles, place, colors, fonts, key words, then preview and lock', async () => {
    await open(pg, '#build=captionType'); await pg.waitForSelector('#build-type');
    await pg.click('#build-type [data-opt="kinetic"]'); await pg.waitForSelector('#build-type [data-opt="kinetic"][aria-checked="true"]');
    assert.match(await pg.textContent('#build-count'), /^Words, 1 of 9$/, 'kinetic words show all nine steps');
    await pg.click('#build-next'); await pg.waitForSelector('#build-look');
    assert.deepStrictEqual((await pg.$$eval('#build-look [data-opt]', e => e.map(x => x.dataset.opt))).sort(), ['kinetic', 'oneword']);
    await pg.click('#build-look-all'); await pg.waitForSelector('#build-look [data-opt="one-word"]');
    // the live preview is the real overlay, and it follows the tile you point at
    await pg.waitForSelector('#build-live[data-ready]', { timeout: 15000 });
    const k0 = await pg.getAttribute('#build-live', 'data-key');
    await pg.hover('#build-look [data-opt="oneword"]'); await pg.waitForFunction(k => document.querySelector('#build-live').dataset.key !== k, k0);
    const t0 = Date.now(); await pg.waitForSelector('#build-live[data-ready]', { timeout: 15000 }); console.log(`  (live preview ready ${Date.now() - t0} ms after the change)`);
    assert.ok(await pg.$eval('#build-live iframe', f => !!f.contentWindow.__ready && typeof f.contentWindow.seek === 'function'));
    await pg.click('#build-next'); await pg.waitForSelector('#build-in');
    await pg.click('#build-in [data-opt="cascade"]'); await pg.waitForFunction(async () => ((await (await fetch('/api/state')).json()).state.picks.captionEntrance || {}).allow?.[0] === 'cascade');
    await pg.click('#build-next'); await pg.waitForSelector('#build-titles-on');
    await pg.click('#build-te [data-opt="type"]'); await pg.waitForSelector('#build-te [data-opt="type"][aria-checked="true"]');
    await pg.click('#build-next'); await pg.waitForSelector('#build-pc');
    assert.ok(await pg.$('#build-place svg rect[stroke-dasharray], #build-place svg title'), 'the zone map marks the face');
    await pg.click('#build-pc [data-opt="lower"]'); await pg.waitForSelector('#build-pc [data-opt="lower"][aria-checked="true"]');
    await pg.waitForSelector('#build-step-soon'); // a choice the render does not draw yet says so
    await pg.click('#build-next'); await pg.waitForSelector('#build-theme');
    await pg.click('#build-color-outline'); await pg.fill('#build-color-outline-in', '#eeeeee'); await pg.click('text=Use this color');
    await pg.waitForFunction(() => /hard to read/.test(document.querySelector('#build-contrast').textContent));
    await pg.click('#build-next'); await pg.waitForSelector('#build-fonts');
    await pg.click('#build-next'); await pg.waitForSelector('#build-kw');
    await pg.click('#build-kw [data-opt="strong"]'); await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.keyWords === 'strong');
    await pg.waitForFunction(() => /clearly bigger/.test(document.querySelector('#build-does').textContent));
    await pg.click('#build-next'); await pg.waitForSelector('#build-final[data-ready]', { timeout: 15000 });
    assert.match(await pg.textContent('#build-words-sum'), /Kinetic words/);
    await noCmd(pg, 'Words'); await shot(pg, 'builder-words-preview.png');
    assert.strictEqual(await pg.textContent('#build-next'), 'Lock and continue');
    await pg.click('#build-next'); await pg.waitForSelector('#build-tr-ours');
    const v = await api('/api/video-plan'); assert.ok(v.plan.touched.includes('words')); assert.strictEqual(v.plan.words.place.captions, 'lower');
  });

  await t('Between shots, You on screen and Extras: transitions and how often, presenter effects with when, graphics', async () => {
    await open(pg, '#build=transitions'); await pg.waitForSelector('#build-tr-ours');
    await pg.click('#build-tr-ours'); await pg.waitForSelector('#build-tr');
    await pg.click('#build-tr [data-opt="whip"]'); await pg.waitForSelector('#build-tr [data-opt="whip"][aria-pressed="true"]');
    await pg.click('#build-tw [data-opt="hook-cta"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.transitionsWhen === 'hook-cta');
    await pg.waitForFunction(() => /hook and the call to action/.test(document.getElementById('build-does').textContent), null, { timeout: 10000 });
    await pg.click('#build-tr [data-opt="none"]'); await pg.waitForFunction(async () => { const p = (await (await fetch('/api/video-plan')).json()).plan; return p.transitions.ids && !p.transitions.ids.length; });
    assert.ok(!(await pg.$('#build-tw')), 'straight cuts have no how often');
    await noCmd(pg, 'Transitions'); await shot(pg, 'builder-transitions.png');
    await pg.click('#build-next'); await pg.waitForSelector('#build-pres');
    await pg.click('#build-pres [data-opt="behind-head"]'); await pg.waitForSelector('#build-pw-behind-head');
    await pg.click('[data-when-for="behind-head"] [data-when="whole"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.presenter.some(x => x.id === 'behind-head' && x.when === 'whole'));
    assert.ok((await api('/api/state')).state.picks.titleLayer.allow.includes('behind'));
    await noCmd(pg, 'Presenter'); await shot(pg, 'builder-presenter.png');
    await pg.click('#build-next'); await pg.waitForSelector('#build-gx-agent');
    await pg.click('#build-gx-agent'); await pg.waitForSelector('#build-gx-nameTag');
    await pg.click('#build-gx-nameTag');
    await pg.waitForFunction(async () => ((await (await fetch('/api/state')).json()).state.picks.graphic || { deny: [] }).deny.includes('lower-third'));
    await noCmd(pg, 'Graphics'); await shot(pg, 'builder-graphics.png');
    assert.strictEqual(await pg.textContent('#build-next'), 'Next');
  });

  await t('Look, Sound and Finish: filters on the hook only, music, your notes with Change, then Make it', async () => {
    await pg.click('#build-next'); await pg.waitForSelector('#build-fi-ours');
    await pg.click('#build-fi-ours'); await pg.waitForSelector('#build-fi');
    await pg.click('#build-fi [data-opt="mono"]'); await pg.waitForSelector('#build-fi [data-opt="mono"][aria-pressed="true"]');
    await noCmd(pg, 'Filters'); await shot(pg, 'builder-filters.png');
    await pg.click('#build-next'); await pg.waitForSelector('#build-ft');
    await pg.click('#build-ft [data-opt="hook"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.finishWhen === 'hook');
    assert.match(await pg.textContent('#build-does'), /first lines/);
    const cv = await api('/api/state'); assert.ok(cv.compose.args.join(' ').includes('--finish-when hook'), 'the hook-only filter reaches the draft');
    await shot(pg, 'builder-filter-timing.png');
    // Repo or tool feature (phase 9): off by default; a link that is not a repo is said at once and never saved
    await pg.click('#build-next'); await pg.waitForSelector('#build-repo-on');
    assert.match(await pg.textContent('#build-does'), /just you/);
    await pg.click('#build-repo-on'); await pg.waitForSelector('#build-repo-0');
    assert.ok(await pg.isVisible('#build-repo-need'), 'asks for a link first');
    await pg.fill('#build-repo-0', 'https://gitlab.com/a/b'); assert.ok(!(await pg.$('#build-repo-0-err')), 'no error while typing'); await pg.click('#build-repo-layout');
    await pg.waitForSelector('#build-repo-0-err'); assert.strictEqual((await api('/api/video-plan')).plan.content.repoFeature, false, 'a bad link is never saved');
    await pg.fill('#build-repo-0', 'https://github.com/wrg32786/aigent-talking-head'); await pg.click('#build-repo-layout');
    await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.content.repoFeature === true);
    await pg.click('#build-repo-take [data-opt="off"]'); await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.content.takeovers === 'off');
    assert.match(await pg.textContent('#build-does'), /Split on every line in the middle/);
    await pg.fill('#build-repo-example', 'not a link'); await pg.press('#build-repo-example', 'Enter'); await pg.waitForSelector('#build-repo-example-err');
    await pg.fill('#build-repo-example', 'https://www.youtube.com/watch?v=abc'); await pg.press('#build-repo-example', 'Enter');
    await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.content.example === 'https://www.youtube.com/watch?v=abc');
    await noCmd(pg, 'Repo or tool feature'); await shot(pg, 'builder-repo.png');
    // clearing the only link takes the repos out of the plan (no old repo renders)
    await pg.fill('#build-repo-0', ''); await pg.press('#build-repo-0', 'Enter');
    await pg.waitForFunction(async () => { const c = (await (await fetch('/api/video-plan')).json()).plan.content; return c.repoFeature === false && !c.repos.length; });
    await pg.click('#build-repo-on'); await pg.waitForFunction(async () => (await (await fetch('/api/video-plan')).json()).plan.content.repoFeature === false);
    await pg.click('#build-next'); await pg.waitForSelector('#build-mu');
    assert.ok(await pg.$('#build-mu-beds .snd-tile'), 'tracks to hear');
    await pg.click('#build-mu [data-opt="none"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.music.bed === 'none');
    assert.ok(!(await pg.$('#build-mu-beat')), 'no beat to cut on without music');
    await pg.click('#build-mu-sfx'); await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.sound.sfx === 'off');
    await noCmd(pg, 'Music'); await shot(pg, 'builder-music.png');
    await pg.click('#build-next'); await pg.waitForSelector('#build-notes-text');
    assert.strictEqual(await pg.textContent('#build-h-notes'), 'Anything else for the agent?');
    await pg.fill('#build-notes-text', 'Keep my jokes in.'); await pg.click('[data-chip="0"]');
    await pg.waitForFunction(async () => /Keep my jokes in\.\nHook in the first line/.test((await (await fetch('/api/video-plan')).json()).plan.notes));
    assert.match(await pg.innerText('#build-summary [data-row="filters"]'), /mono, hook only/);
    // Change opens only that step, and its Next comes back here
    await pg.click('#build-summary [data-row="music"] button'); await pg.waitForSelector('#build-mu');
    assert.strictEqual(await pg.textContent('#build-next'), 'Back to your notes');
    await pg.click('#build-next'); await pg.waitForSelector('#build-notes-text');
    assert.strictEqual(await pg.inputValue('#build-notes-text'), 'Keep my jokes in.\nHook in the first line, short and punchy.');
    await pg.click('#build-all .fold2-h'); await pg.waitForSelector('#build-all .fold2-b', { state: 'visible' });
    assert.strictEqual(await pg.$$eval('#build-all [role="tab"]', x => x.length), (await api('/api/catalog')).layers.length, 'All options has every layer');
    await noCmd(pg, 'Your notes'); await shot(pg, 'builder-notes.png');
    await pg.click('#build-next'); await pg.waitForSelector('#build-make-go');
    assert.strictEqual(await pg.$('#build-next'), null, 'Make it has its own buttons');
    await pg.fill('#build-tpl-name', 'Builder Test'); await pg.click('#build-tpl-save'); await pg.waitForSelector('#build-tpl-done');
    const tpl = JSON.parse(readFileSync(join(LOOKS, 'builder-test', 'template.json'), 'utf8')); assert.strictEqual(tpl.plan.notes, ''); assert.deepStrictEqual(tpl.plan.filters, { ids: ['mono'], when: 'hook' });
    await noCmd(pg, 'Make it'); await shot(pg, 'builder-make.png');
    // no clip in this video: Make my video says so in plain words and keeps you here
    await pg.click('#build-make-go'); await pg.waitForSelector('#build-make-err, #s-review:not([hidden])', { timeout: 20000 }).catch(() => {});
    const made = await pg.evaluate(() => ({ err: document.querySelector('#build-make-err')?.textContent || null, review: !!document.querySelector('#s-review:not([hidden])'), hash: location.hash, making: document.querySelector('#build-make-go')?.textContent || null }));
    assert.ok(made.err, 'Make my video with no clip: ' + JSON.stringify(made));
    assert.doesNotMatch(made.err, /Failed to fetch|undefined/);
  });

  await t('the Template Library: Rename, Duplicate and Delete on Teardowns, then Use a template on New video', async () => {
    await open(pg, '#tab=teardowns'); await pg.waitForSelector('#template-library [data-template="builder-test"]');
    const card = '#template-library li[data-template="builder-test"]';
    assert.match(await pg.innerText(card), /Built by you/);
    const starterName = (await api('/api/templates')).templates.find(x => x.readOnly).name; assert.ok(await pg.$(`#template-library li[data-template="${starterName}"]`), 'the starters are there');
    await pg.click('#tpl-menu-builder-test'); await pg.click('#tpl-rename-builder-test');
    await pg.fill('#tpl-name-builder-test', 'Hook in mono'); await pg.click(card + ' form button[type="submit"]');
    await pg.waitForFunction(() => /Hook in mono/i.test(document.querySelector('#template-library li[data-template="builder-test"]').innerText));
    await pg.click('#tpl-menu-builder-test'); await pg.click('#tpl-dup-builder-test');
    await pg.waitForSelector('#template-library li[data-template="builder-test-copy"]');
    await shot(pg, 'library-teardowns.png');
    await pg.click('#tpl-menu-builder-test-copy'); await pg.click('#tpl-del-builder-test-copy');
    await pg.waitForSelector('[role="alertdialog"]'); await pg.click('#tpl-del-yes-builder-test-copy');
    await pg.waitForSelector('#template-library li[data-template="builder-test-copy"]', { state: 'detached' });
    const starter = (await api('/api/templates')).templates.find(x => x.readOnly);
    await pg.click(`#tpl-menu-${starter.name}`); assert.strictEqual(await pg.$(`#tpl-del-${starter.name}`), null, 'a starter cannot be deleted'); await pg.keyboard.press('Escape');
    await noCmd(pg, 'the Template Library');
    // New video: Use a template, pick it, land on Your notes with its choices
    await api('/api/video-plan', { plan: (await import('../kit/studio/wizard/plan.mjs')).defaults('calm') });
    await open(pg, '#build=start'); await pg.click('#build-template'); await pg.waitForSelector('#build-tlib [data-template="builder-test"]');
    await pg.click('#build-tlib [data-template="builder-test"]'); await pg.waitForSelector('#build-notes-text');
    assert.strictEqual(new URL(pg.url()).hash, '#build=notes');
    assert.match(await pg.innerText('#build-summary [data-row="filters"]'), /mono, hook only/);
    assert.strictEqual((await api('/api/state')).state.finishWhen, 'hook');
    await shot(pg, 'library-picked-notes.png');
  });

  await t('Just captions skip the kinetic-only steps and take key words away', async () => {
    await open(pg, '#build=captionType'); await pg.waitForSelector('#build-type');
    await pg.click('#build-type [data-opt="captions"]'); await pg.waitForSelector('#build-type [data-opt="captions"][aria-checked="true"]');
    // the step list follows the saved state, which can land a moment after the tile shows picked
    await pg.waitForFunction(() => /^Words, 1 of 6$/.test(document.querySelector('#build-count')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    assert.match(await pg.textContent('#build-count'), /^Words, 1 of 6$/);
    assert.strictEqual((await api('/api/state')).state.keyWords, 'off');
    await open(pg, '#build=keyWords'); await pg.waitForSelector('#build-wordsPreview, #build-place, #build-colors', { timeout: 10000 });
    assert.notStrictEqual(new URL(pg.url()).hash, '#build=keyWords', 'a hidden step moves on');
  });

  await t('the address follows the builder: another tab and back, a step not built yet, a classic edit', async () => {
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace');
    await pg.click('#areas [role="tab"] >> nth=1'); await pg.waitForSelector('main[data-area="teardowns"]');
    await pg.click('#areas [role="tab"] >> nth=0'); await pg.waitForSelector('#build-pace');
    assert.strictEqual(new URL(pg.url()).hash, '#build=pace', 'coming back keeps the builder in the address');
    await open(pg, '#build=words'); await pg.waitForSelector('#build-start');
    assert.strictEqual(new URL(pg.url()).hash, '#build=start', 'a step with no screen yet starts at the beginning');
    // music energy set on a classic step stays when you pick another pace
    await api('/api/state', { music: { energy: 'low' } });
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace');
    await pg.click('#build-paces [data-pace="high"]'); await pg.waitForSelector('#build-paces [data-pace="high"][aria-checked="true"]');
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.pace.tighten === 0.25);
    assert.strictEqual((await api('/api/state')).state.music.energy, 'low');
  });

  await t('a video with no name yet: the start screen offers one, filled with the date, and a clip card uses it', async () => {
    await api('/api/state', { job: null });
    await open(pg, '#build=start'); await pg.waitForSelector('#build-name');
    assert.match(await pg.getAttribute('#build-name', 'placeholder'), /^video-\d{4}-\d{2}-\d{2}$/);
    // a dropped file starts the video with the typed name, then uploads into it
    await pg.fill('#build-name', 'My Builder Reel');
    await pg.setInputFiles('#build-file', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
    await pg.waitForFunction(async () => (await (await fetch('/api/state')).json()).state.job === 'my-builder-reel');
    await pg.waitForSelector('#build-start'); assert.strictEqual(new URL(pg.url()).hash, '#build=start', 'a new video keeps the builder in the address');
    await api('/api/state', { job: JOB });
  });

  await t('cream theme and phone width', async () => {
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'light'));
    await open(pg, '#build=pace'); await pg.waitForSelector('#build-pace'); await shot(pg, 'builder-pace-light.png');
    await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(200);
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); assert.ok(over <= 1, `the page is ${over}px wider than the phone`);
    await shot(pg, 'builder-pace-phone.png');
    await pg.evaluate(() => localStorage.setItem('studio.theme', 'dark'));
  });

  assert.deepStrictEqual(errs, []);
  console.log(`\n${n} studio builder e2e tests passed`);
} finally { await browser.close(); srv.kill(); rmSync(STATE, { recursive: true, force: true }); }
