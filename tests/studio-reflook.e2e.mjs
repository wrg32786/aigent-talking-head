// A reference's look on the page (Studio report 4, items 7 and 13), in a real Chrome with no keys and no network:
// - a Recreate on a board that kept the last video's look uses the reference's look alone: no line. After Back to my
//   look the Picture reference card and the breakdown say "Your saved look is in use, not the reference's" with one
//   button; the button sets the board from the reference again, the change note's Undo puts the saved look back
// - titles the breakdown may have misread: one line by the reference card and by Draft, and in the breakdown a
//   "Check this text" list with the reason, a field and Save for each; Save rewrites the title in the reference's
//   Reel.md and the line counts down
// - screenshots, dark and light
// Needs Chrome. Run: node tests/studio-reflook.e2e.mjs [--shots <dir>]   (npm run smoke runs it)
import assert from 'assert';
import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { findChrome } from '../kit/chrome.mjs';
import { patient } from './fixtures/patient.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATE = mkdtempSync(join(tmpdir(), 'studio-reflook-e2e-')), SDIR = join(STATE, 'studio'), JOB = 'reflook-e2e-' + process.pid;
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
process.env.STUDIO_DIR = SDIR; mkdirSync(SDIR, { recursive: true });
const C = await import('../kit/studio/core.mjs');
const cat = C.catalog();

// the reference: the shipped cinematic recipe with two titles the teardown was not sure of (as kit/teardown writes them)
const L1 = '#01 0.4-2.2 | check read with low confidence (82%) | entrance blur-rise | layer behind | text Kng', L3 = '#03 24.3-26.5 | check the number is not in the speech | entrance stagger-rise | layer auto | text 360 Days';
const RECIPE = readFileSync(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'), 'utf8')
  .replace('#01 0.4-2.2 | entrance blur-rise | layer behind | text Ten years ago', L1).replace('#03 24.3-26.5 | entrance stagger-rise | layer auto | text Now', L3);
assert.ok(RECIPE.includes(L1) && RECIPE.includes(L3));
const OUT = `teardown/${JOB}`, DIR = join(ROOT, OUT), FILE = join(DIR, 'Reel.md');
mkdirSync(DIR, { recursive: true }); writeFileSync(FILE, RECIPE);
// the board: a new video that kept the look of the one before (titles in front, one entrance), then Recreate
const s0 = C.defaultState(); s0.job = 'video-one';
assert.deepStrictEqual(C.applyPatch(s0, { picks: { 'captionStyle:one-word': 'allow', 'titleLayer:front': 'allow', 'entrance:pop-zoom': 'allow' } }, cat).errs, []);
C.freshSession(s0, { job: JOB, keepLook: true });
s0.reference = { ...s0.reference, status: 'ready', mode: 'off', out: OUT, extracted: C.extract(FILE) };
assert.deepStrictEqual(C.applyPatch(s0, { reference: { mode: 'recreate' } }, cat).errs, []);
writeFileSync(join(SDIR, 'state.json'), JSON.stringify(s0));

const env = { ...process.env, CI: '1', STUDIO_DIR: SDIR, STUDIO_CHAT: '', STUDIO_BROLL_AUTO: '' };
const srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
const url = await new Promise((ok, bad) => { let out = ''; srv.stdout.on('data', d => { out += d; const m = out.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { out += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + out))); });
const api = async (p, b) => (await fetch(url + p, b === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const theme = async (pg, th) => { await pg.evaluate(x => localStorage.setItem('studio.theme', x), th); await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const open = async (pg, hash) => { await pg.goto('about:blank'); await pg.goto(url + '/' + hash, { waitUntil: 'domcontentloaded' }); await pg.waitForSelector('#areas'); };
const shot = async (pg, name, sel) => { if (!shots) return; await pg.evaluate(() => scrollTo(0, 0)); if (sel) await pg.$eval(sel, e => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(400); await pg.screenshot({ path: join(shots, name) }); };
const text = async (pg, sel) => (await pg.textContent(sel)).replace(/\s+/g, ' ').trim();
const SAYS = "Your saved look is in use, not the reference's";

const browser = patient(await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] }));
try {
  const errs = [];
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.addInitScript(() => { try { localStorage.setItem('studio.paused', '1'); } catch {} });

  await t('Picture: a Recreate on a board that kept the last look uses the reference\'s look, says nothing, and counts the titles to check', async () => {
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card[data-mode="recreate"]');
    const v = await api('/api/state'); assert.strictEqual(v.savedLook.inUse, false); assert.strictEqual(v.state.picks.titleLayer, undefined); assert.ok(!v.compose.args.includes('--title-layer') && !/titles=/.test(v.compose.lockString || ''), 'nothing of the kept look is sent');
    assert.strictEqual(await pg.$('#saved-look'), null, 'the reference wins, so there is no line');
    assert.strictEqual(await text(pg, '#title-check-line'), '2 titles may be misread. Check them before you draft.');
    assert.deepStrictEqual(errs, []);
  });
  await t('Review says it too: the count by Draft', async () => {
    await pg.click('#stepper [data-step="start"]'); await pg.waitForSelector('#recreate-card'); assert.strictEqual(await pg.$('#recreate-card .saved-look'), null);
    await pg.click('#stepper [data-step="review"]'); await pg.waitForSelector('#draft-title-check');
    assert.strictEqual(await text(pg, '#draft-title-check'), '2 titles may be misread. Check them before you draft.');
    await pg.click('#draft-title-check-go'); await pg.waitForSelector('main[data-area="teardowns"] #title-checks');
  });
  await t('the breakdown lists the titles to check, each with the reason, a field and Save', async () => {
    assert.strictEqual(await text(pg, '#title-checks-h'), 'Check this text'); assert.strictEqual(await pg.$('#saved-look-td'), null);
    assert.deepStrictEqual(await pg.$$eval('#title-checks .tc', x => x.map(e => e.dataset.title)), ['1', '3']);
    assert.strictEqual(await pg.inputValue('#tc-1'), 'Kng'); assert.strictEqual(await text(pg, '#tc-1-why'), 'Read with low confidence (82%).');
    assert.strictEqual(await pg.inputValue('#tc-3'), '360 Days'); assert.strictEqual(await text(pg, '#tc-3-why'), 'The number is not in the speech.');
    assert.match(await text(pg, '#title-checks .tc-h'), /We may have misread these 2 titles\. Fix the words, or save them as they are\./);
    await shot(pg, 'r4-check-title-text.png', '#title-checks');
    await theme(pg, 'light'); await pg.waitForSelector('#title-checks'); await shot(pg, 'r4-check-title-text-light.png', '#title-checks'); await theme(pg, 'dark'); await pg.waitForSelector('#title-checks');
  });
  await t('Save writes the fixed text into the reference\'s recipe and the list counts down to nothing', async () => {
    await pg.fill('#tc-1', 'King'); await pg.click('#tc-1-save'); await pg.waitForSelector('#tc-1', { state: 'detached' });
    assert.strictEqual(readFileSync(FILE, 'utf8'), RECIPE.replace(L1, '#01 0.4-2.2 | entrance blur-rise | layer behind | text King'), 'only that title changed');
    assert.match(await text(pg, '#title-checks .tc-h'), /We may have misread this title\./);
    await pg.fill('#tc-3', '347 Days'); await pg.press('#tc-3', 'Enter'); await pg.waitForSelector('#title-checks', { state: 'detached' });
    assert.ok(readFileSync(FILE, 'utf8').includes('#03 24.3-26.5 | entrance stagger-rise | layer auto | text 347 Days\n'));
    assert.deepStrictEqual((await api('/api/state')).state.reference.extracted.checks, []);
    await pg.click('#tab-new'); await pg.click('#stepper button[data-step="picture"]'); await pg.waitForSelector('#ref-card'); assert.strictEqual(await pg.$('#title-check-line'), null, 'nothing left to check');
  });
  await t('Back to my look: the reference card and the breakdown say the saved look is in use, with one button', async () => {
    await api('/api/state', { reference: { mode: 'off' } });
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card #saved-look');
    assert.strictEqual(await text(pg, '#saved-look-text'), SAYS); assert.strictEqual(await text(pg, '#saved-look p'), SAYS, 'one line, nothing else');
    assert.deepStrictEqual(await pg.$$eval('#saved-look button', x => x.map(e => e.textContent.trim())), ["Use the reference's look"], 'one button');
    assert.match(await pg.getAttribute('#saved-look', 'title'), /title layer front/);
    assert.strictEqual(await pg.$$eval('.saved-look', x => x.length), 1, 'one line on the page');
    await shot(pg, 'r4-saved-look-banner.png');
    await theme(pg, 'light'); await pg.waitForSelector('#saved-look'); await shot(pg, 'r4-saved-look-banner-light.png'); await theme(pg, 'dark');
    await open(pg, '#step=reference'); await pg.waitForSelector('#saved-look-td');
    assert.strictEqual(await text(pg, '#saved-look-td-text'), SAYS); assert.strictEqual(await pg.$('#ref-notice-td'), null, 'one notice, not a second one beside it');
    await open(pg, '#step=picture'); await pg.waitForSelector('#ref-card #saved-look');
  });
  await t('the button switches to the reference\'s look; Undo on the change note brings the saved look back', async () => {
    await pg.click('#saved-look-use'); await pg.waitForSelector('#saved-look', { state: 'detached' });
    let v = await api('/api/state'); assert.strictEqual(v.savedLook.inUse, false); assert.strictEqual(v.state.reference.mode, 'recreate', 'on again, in the mode it was last copied with');
    assert.strictEqual(v.state.picks.titleLayer, undefined); assert.ok(!v.compose.args.includes('--title-layer') && !/titles=/.test(v.compose.lockString || ''));
    assert.deepStrictEqual(v.state.picks.captionStyle.allow, ['kinetic'], 'the reference\'s caption style');
    await pg.waitForSelector('#change-note'); assert.strictEqual(await text(pg, '#change-note span'), "Switched to the reference's look.");
    await pg.click('#change-undo'); await pg.waitForSelector('#saved-look');
    v = await api('/api/state'); assert.strictEqual(v.savedLook.inUse, true); assert.strictEqual(v.state.reference.mode, 'off'); assert.deepStrictEqual(v.state.picks.titleLayer.allow, ['front']);
    await pg.click('#saved-look-use'); await pg.waitForSelector('#saved-look', { state: 'detached' });
    // a pick made now is a choice for this video: no line comes back
    await api('/api/state', { picks: { 'titleLayer:behind': 'allow' } }); await pg.waitForTimeout(500);
    v = await api('/api/state'); assert.strictEqual(v.savedLook.inUse, false); assert.deepStrictEqual(v.savedLook.yours, ['titles']); assert.strictEqual(await pg.$('#saved-look'), null);
    assert.deepStrictEqual(errs, []);
  });
} finally {
  await browser.close(); srv.kill();
  rmSync(STATE, { recursive: true, force: true }); rmSync(DIR, { recursive: true, force: true });
  rmSync(join(ROOT, 'jobs', JOB), { recursive: true, force: true }); rmSync(join(ROOT, 'packs', 'local', `ref-${JOB}`), { recursive: true, force: true });
}
console.log(`\n${n} studio reflook e2e tests passed`);
process.exit(0);
