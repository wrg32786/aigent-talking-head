// The Asset Vault and the brief (1.29.0), with no Chrome, no keys and no network:
// - the brief: the things a line names (your words and brands, common tools, sites, numbers, plain nouns) decide the
//   subject and the shot, the reference is only a hint, the point marks the lines it serves, an agent's rewrite merges
// - the Vault index: add (the file keeps its name, rights, hash, item.json), the same file once, delete with Undo and
//   the 7 day purge, rights and what may be placed, search and the four filters, links (tidy, the same link once,
//   someone else's video is reference only, a capture, a sign in wall), the limits, the old library moving in
// - matching: a named thing wins, the reason line, the bar, reference only is never offered, no item twice
// - the tool schemas, the Studio routes and the MCP tools (words only unless pictures are on)
// Run: node tests/vault.test.mjs   (npm run check runs it too)
import assert from 'assert';
import { spawn } from 'child_process';
import { createServer } from 'http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const BB = require('../kit/broll-brief.cjs'), BS = require('../kit/broll-slots.cjs'), RM = require('../kit/reelmd.cjs'), RC = require('../kit/recreate.cjs');
const STATE = mkdtempSync(join(tmpdir(), 'vault-test-')), LIB = join(STATE, 'lib'), JOB = 'vault-test-' + process.pid;
process.env.STUDIO_DIR = join(STATE, 'studio'); process.env.STUDIO_BROLL_LIBRARY = LIB; delete process.env.STUDIO_VAULT;
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const NO_DASH = s => assert.ok(!/[–—]/.test(String(s)), 'no dash: ' + s);
const file = (name, body) => { const f = join(STATE, 'in', name); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, body); return f; };

// the library of 1.28.0, already in the folder before the Vault first opens: it must move in by itself
mkdirSync(join(LIB, 'pexels'), { recursive: true }); mkdirSync(join(LIB, '.thumbs'), { recursive: true });
writeFileSync(join(LIB, 'pexels', 'pexels-77.mp4'), 'old stock clip'); writeFileSync(join(LIB, '.thumbs', 'brold00001.jpg'), 'jpg');
writeFileSync(join(LIB, 'library.json'), JSON.stringify({ clips: [
  { id: 'brold00001', file: 'pexels/pexels-77.mp4', name: 'laptop on a desk', source: 'pexels', kind: 'video', license: { name: 'Pexels License', url: 'https://www.pexels.com/license/' }, author: { name: 'Ada', url: 'https://pexels.com/@ada' }, sourceUrl: 'https://pexels.com/video/77', tags: ['laptop', 'desk', 'pexels'], seconds: 6, width: 1080, height: 1920, thumb: '.thumbs/brold00001.jpg', extId: '77', usedIn: ['old-reel'] },
  { id: 'brgone0002', file: 'upload/missing.mp4', name: 'gone', source: 'upload', kind: 'video', tags: [] }] }));
const V = await import('../kit/studio/vault.mjs'), VM = await import('../kit/studio/vault-match.mjs'), BR = await import('../kit/studio/broll.mjs'), SC = await import('../kit/studio/vault-schema.mjs');

let srv, client, mock;
const jobDir = join(ROOT, 'jobs', JOB);
try {
  // ---------- the brief ----------
  await t('brief: a named tool gives a screen recording of it, and the card line reads "Show X. Y."', () => {
    const b = BB.rules({ start: 2, end: 6.5, kind: 'panel', line: 'First is OmniRoute. It gives you one endpoint.', fx: { motion: 'push' }, ref: { n: 1 }, what: 'Kilo Code', shot: 'screen recording', source: 'github.com/x/kilo' }, { point: 'one endpoint for every model' });
    assert.deepStrictEqual([b.subject, b.why, b.shot, b.motion, b.seconds, b.frame, b.by], ['OmniRoute on screen', 'You name it in this line.', 'screen recording', 'push', 5.5, 'wide 16:9', 'rules']);
    assert.deepStrictEqual(b.named, ['OmniRoute']); assert.strictEqual(b.line, 'First is OmniRoute. It gives you one endpoint.');
    assert.deepStrictEqual(b.reference, { showed: 'Kilo Code', shot: 'screen recording', source: 'github.com/x/kilo' }, 'the reference is a hint, kept apart from our subject');
    assert.ok(b.avoid.includes('faces of other people')); assert.strictEqual(b.serves, true, 'this line serves the point');
    assert.strictEqual(BB.text(b), 'Show OmniRoute on screen. You name it in this line.'); assert.strictEqual(BB.query(b), 'OmniRoute'); NO_DASH(JSON.stringify(b));
    assert.strictEqual(BB.rules({ start: 0, end: 3, kind: 'panel', line: 'then I open ChatGPT and ask it' }).subject, 'ChatGPT on screen');
  });
  await t('brief: your own words and brands come first; a site, a number, plain nouns and a bare slot each get their line', () => {
    const own = BB.rules({ start: 0, end: 3, kind: 'full', line: 'we built flowdesk for this' }, { glossary: [{ say: 'Flowdesk', heard: ['flow desk'] }], brands: [{ word: 'Acme' }] });
    assert.deepStrictEqual([own.named, own.shot, own.frame], [['Flowdesk'], 'screen recording', 'upright 9:16']);
    assert.strictEqual(BB.rules({ start: 0, end: 3, kind: 'panel', line: 'go to omniroute.dev and sign up' }).subject, 'the page at omniroute.dev');
    const num = BB.rules({ start: 0, end: 3, kind: 'full', line: 'leads went up 312 percent' }); assert.deepStrictEqual([num.shot, num.why], ['graphic', 'You say a number here.']); assert.ok(/312/.test(num.subject));
    const desk = BB.rules({ start: 0, end: 3, kind: 'full', line: 'my desk is where the ideas come from' }); assert.deepStrictEqual([desk.shot, desk.why], ['place', 'It fits what you say here.']); assert.ok(/desk/.test(desk.subject));
    assert.strictEqual(BB.rules({ start: 0, end: 3, kind: 'full', line: 'she types the prompt on her keyboard' }).shot, 'hands');
    const bare = BB.rules({ start: 0, end: 3, kind: 'panel', line: '', what: 'Dashboard', ref: { n: 1 } }); assert.deepStrictEqual([bare.subject, bare.why], ['Dashboard', 'The reference showed this here.']);
    assert.strictEqual(BB.rules({ start: 0, end: 3, kind: 'full', line: 'and that is it' }, { point: 'route models' }).serves, undefined);
  });
  await t('brief: an agent rewrites subject, shot and why; the rest stays the slot; a bad shot is refused', () => {
    const slot = { start: 0, end: 3, kind: 'panel', line: 'then I open ChatGPT' }, m = BB.merge(BB.rules(slot), { subject: 'the ChatGPT chat screen with a prompt typed in — dark mode', shot: 'Screen Recording', why: 'It is the tool in this line' }, 'Claude');
    assert.deepStrictEqual([m.subject, m.shot, m.by, m.seconds], ['the ChatGPT chat screen with a prompt typed in , dark mode', 'screen recording', 'Claude', 4]); NO_DASH(m.subject);
    assert.throws(() => BB.merge(BB.rules(slot), { shot: 'drone' }), /shot: screen recording/); assert.throws(() => BB.merge(BB.rules(slot), { subject: ' ' }), /subject/);
    assert.strictEqual(BB.of({ ...slot, brief: m }).subject, m.subject, 'the plan keeps the rewrite'); assert.strictEqual(BB.of({ ...slot, brief: BB.rules(slot) }, { glossary: ['ChatGPT'] }).by, 'rules');
  });

  // ---------- the Vault index ----------
  let own, pic;
  await t('the old library moves in by itself: same id, credits, license and where it was used; a clip with no file is left out', () => {
    const d = V.dir(); assert.strictEqual(d, LIB);
    const it = V.get('brold00001'); assert.ok(it, 'the clip is in the Vault');
    assert.deepStrictEqual([it.file, it.thumb, it.rights, it.author.name, it.license.name, it.extId, it.usedIn[0], it.from.type], ['items/brold00001/pexels-77.mp4', 'items/brold00001/thumb.jpg', 'licensed', 'Ada', 'Pexels License', '77', 'old-reel', 'file']);
    assert.ok(/^sha256:[0-9a-f]{64}$/.test(it.hash)); assert.strictEqual(readFileSync(V.pathOf(it), 'utf8'), 'old stock clip'); assert.ok(existsSync(join(d, it.thumb)));
    assert.ok(existsSync(join(d, 'items', 'brold00001', 'item.json'))); assert.ok(!existsSync(join(d, 'library.json')) && existsSync(join(d, 'library.migrated.json')), 'the old index is kept as a backup');
    assert.strictEqual(V.get('brgone0002'), null); assert.strictEqual(V.migrate(d, d), 0, 'it moves once');
    const cr = BR.credits([BR.get('brold00001')], 'my-reel'); assert.ok(/by Ada https:\/\/pexels\.com\/@ada/.test(cr) && /Pexels License/.test(cr) && /Videos provided by Pexels/.test(cr), cr);
    assert.ok(BR.search('laptop').some(c => c.id === 'brold00001'), 'the reel still finds it');
  });
  await t('the move is saved clip by clip and carries on after a stop: a clip whose file already moved keeps its credits', () => {
    const mf = join(STATE, 'old'), mt = join(STATE, 'new'); mkdirSync(join(mf, 'upload', 'dir.mp4'), { recursive: true }); mkdirSync(join(mt, 'items', 'brhalf0001'), { recursive: true });
    writeFileSync(join(mt, 'items', 'brhalf0001', 'a.mp4'), 'clip a'); writeFileSync(join(mf, 'upload', 'b.mp4'), 'clip b'); // a.mp4 moved before Studio was stopped, b.mp4 had not yet
    const clip = (id, f, who) => ({ id, file: 'upload/' + f, name: f, source: 'upload', kind: 'video', author: { name: who }, tags: ['walk'], usedIn: ['reel-1'] });
    writeFileSync(join(mf, 'library.json'), JSON.stringify({ clips: [clip('brhalf0001', 'a.mp4', 'Bo'), clip('brwait0002', 'b.mp4', 'Cy'), clip('brbad00003', 'dir.mp4', 'Di')] }));
    assert.throws(() => V.migrate(mf, mt), 'the third clip cannot be read, as if Studio stopped there');
    const got = V.load(mt).items; assert.deepStrictEqual(got.map(x => [x.id, x.author.name, x.usedIn[0], x.file]), [['brhalf0001', 'Bo', 'reel-1', 'items/brhalf0001/a.mp4'], ['brwait0002', 'Cy', 'reel-1', 'items/brwait0002/b.mp4']], 'what moved before the stop is in the index');
    assert.ok(existsSync(join(mf, 'library.json')), 'the old index stays until the move is whole');
  });
  await t('add: the file keeps its name beside item.json, is yours by default, and the same file is added once', () => {
    own = V.add(file('My Pricing Page.png', 'png one'), { title: 'Pricing page', tags: ['Pricing'], brand: ['Acme'] });
    assert.deepStrictEqual([own.file, own.name, own.kind, own.rights, own.source, own.brand, own.from.type], [`items/${own.id}/My-Pricing-Page.png`, 'Pricing page', 'image', 'mine', 'upload', ['Acme'], 'file']);
    assert.ok(own.tags.includes('pricing') && own.tags.includes('page')); assert.strictEqual(JSON.parse(readFileSync(join(LIB, 'items', own.id, 'item.json'), 'utf8')).hash, own.hash);
    const again = V.add(file('renamed.png', 'png one')); assert.deepStrictEqual([again.id, again.duplicate], [own.id, true]); assert.strictEqual(V.load().items.filter(x => x.hash === own.hash).length, 1);
    // a made card or a stock clip with the same bytes is its own item: only what you add yourself is checked
    const made = V.add(file('card.png', 'png one'), { source: 'agent' }); assert.notStrictEqual(made.id, own.id); assert.strictEqual(made.rights, 'mine');
    assert.throws(() => V.add(file('notes.txt', 'x')), /video .* or a picture/); assert.throws(() => V.add(join(STATE, 'nope.png')), /no such file/);
    pic = V.add(file('desk-photo.jpg', 'jpg two'), { rights: 'licensed' }); assert.strictEqual(pic.rights, 'licensed');
    // a refused upload does not leave its temp file behind; a copy (your own file) is never touched
    const tmpUp = file('upload-temp.txt', 'x'), mineF = file('mine.txt', 'x'); assert.throws(() => V.add(tmpUp, { move: true }), /video .* or a picture/); assert.ok(!existsSync(tmpUp));
    assert.throws(() => V.add(mineF), /video .* or a picture/); assert.ok(existsSync(mineF));
  });
  await t('delete waits 7 days with Undo; after that it is gone', () => {
    const tmp = V.add(file('old-logo.png', 'png three')), f = V.pathOf(tmp);
    V.remove(tmp.id); assert.strictEqual(V.get(tmp.id), null); assert.ok(!existsSync(f) && existsSync(join(LIB, '.trash', tmp.id, 'old-logo.png')));
    assert.strictEqual(V.load().trash[0].id, tmp.id);
    const back = V.restore(tmp.id); assert.strictEqual(back.id, tmp.id); assert.ok(existsSync(f) && V.get(tmp.id) && !V.load().trash.some(x => x.id === tmp.id)); assert.strictEqual(back.deletedAt, undefined);
    V.remove(tmp.id); assert.strictEqual(V.purge(Date.now() + 6 * 864e5), 0, 'six days: still there'); assert.strictEqual(V.purge(Date.now() + 8 * 864e5), 1);
    assert.ok(!existsSync(join(LIB, '.trash', tmp.id))); assert.throws(() => V.restore(tmp.id), /nothing to undo/);
  });
  let ref, page;
  await t('links: tidy, saved once, someone else\'s video is reference only, your own is yours, a page is a public page', async () => {
    assert.strictEqual(V.tidyUrl('Example.com/pricing/?utm_source=x&plan=pro&fbclid=1#top'), 'https://example.com/pricing?plan=pro');
    assert.throws(() => V.tidyUrl(''), /Paste a link/); assert.throws(() => V.tidyUrl('ftp://x.com/a'), /public web links/); assert.throws(() => V.tidyUrl('localhost'), /public web links/);
    assert.deepStrictEqual(['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://www.tiktok.com/@a/video/12', 'https://www.instagram.com/reel/Cx1', 'https://x.com/a/status/9', 'https://instagram.com/will', 'https://github.com/a/b', 'https://acme.com/pricing'].map(V.linkKind),
      ['post', 'post', 'post', 'post', 'post', 'profile', 'page', 'page']);
    const r = V.addLink('https://www.youtube.com/watch?v=abc&utm_medium=share'); ref = r.item;
    assert.deepStrictEqual([ref.rights, ref.file, ref.from.url, ref.from.what, V.placeable(ref)], ['reference', null, 'https://www.youtube.com/watch?v=abc', 'post', false]); assert.ok(/reference only/i.test(ref.license.name));
    const dup = V.addLink('youtube.com/watch?v=abc#t=4'); assert.ok(dup.duplicate && dup.item.id === ref.id);
    assert.strictEqual(V.addLink('https://www.youtube.com/watch?v=mine1', { mine: true }).item.rights, 'mine');
    assert.strictEqual(BR.get(ref.id), null, 'the reel never sees a reference only item'); assert.ok(!BR.load().clips.some(c => c.id === ref.id)); assert.ok(!BR.rank('youtube watch').some(c => c.id === ref.id));
    // a capture: the share image, the top, the full page, the scroll and the words on the page
    const cap = join(STATE, 'cap'); mkdirSync(cap, { recursive: true }); for (const f of ['shot.png', 'full.png', 'scroll.mp4', 'og.jpg']) writeFileSync(join(cap, f), 'bytes ' + f);
    let asked = null; const capture = async (u, o) => { asked = { u, o }; return { dir: cap, title: 'OmniRoute: one endpoint for every model', og: 'og.jpg', text: 'OmniRoute  Route every model through one endpoint', signin: false, final: u }; };
    const pr = V.addLink('https://github.com/acme/omniroute/', { brand: ['OmniRoute'] }, { capture }); assert.strictEqual(pr.item.status, 'getting'); assert.strictEqual(V.brief(V.get(pr.item.id)).status, 'getting');
    page = await pr.ready; assert.deepStrictEqual([asked.u, asked.o.extras, asked.o.force], ['https://github.com/acme/omniroute', true, true]);
    assert.deepStrictEqual([page.rights, page.kind, page.file, page.status, page.name, V.kindOf(page), V.fromOf(page), V.placeable(page)], ['public-page', 'video', `items/${page.id}/capture/scroll.mp4`, null, 'OmniRoute: one endpoint for every model', 'page', 'links', true]);
    assert.deepStrictEqual(Object.keys(page.capture).filter(k => page.capture[k]).sort(), ['full', 'og', 'scroll', 'top']); assert.ok(/Route every model/.test(page.text) && page.captured && page.bytes > 0);
    assert.strictEqual(V.brief(page).check, 'Check that you may show it.'); assert.strictEqual(V.brief(page).line, 'Page, github.com');
    // a video page keeps a still only; a sign in wall keeps the link and says so
    const post = await V.addLink('https://vimeo.com/123456', { mine: true }, { capture: async (u, o) => { assert.strictEqual(o.imageOnly, true); return { dir: cap, title: 'My film', signin: false }; } }).ready;
    assert.deepStrictEqual([post.kind, post.file, post.rights], ['image', `items/${post.id}/capture/top.png`, 'mine']); assert.ok(/Add the file itself/.test(post.note));
    const wall = await V.addLink('https://app.acme.com/dashboard', {}, { capture: async () => ({ dir: cap, title: 'Sign in', signin: true }) }).ready;
    assert.deepStrictEqual([wall.file, V.placeable(wall)], [null, false]); assert.ok(/needs you signed in/.test(wall.note));
    const dead = await V.addLink('https://gone.acme.com/x', {}, { capture: async () => { throw new Error('host not found'); } }).ready; assert.ok(/kept the link/.test(dead.note) && dead.file === null);
    // pasting a link that has no picture tries the capture again; one that has its picture is left alone
    let tries = 0; const good = async () => { tries++; return { dir: cap, title: 'Back again', signin: false }; };
    const retry = V.addLink('gone.acme.com/x', {}, { capture: good }); assert.deepStrictEqual([retry.duplicate, retry.item.id, retry.item.status], [true, dead.id, 'getting']);
    const back = await retry.ready; assert.deepStrictEqual([back.id, back.file, back.note, V.placeable(back)], [dead.id, `items/${dead.id}/capture/scroll.mp4`, null, true]);
    await V.addLink('gone.acme.com/x', {}, { capture: good }).ready; assert.strictEqual(tries, 1); V.remove(dead.id);
    // deleted while it was being captured: nothing is written back, and Undo still works (even over a leftover folder)
    const slow = V.addLink('https://acme.com/slow', {}, { capture: async () => { await null; V.remove(slow.item.id); return { dir: cap, title: 'Slow', signin: false }; } });
    assert.strictEqual(await slow.ready, null); assert.ok(!existsSync(join(LIB, 'items', slow.item.id)), 'no files come back after the delete');
    mkdirSync(join(LIB, 'items', slow.item.id, 'capture'), { recursive: true }); assert.strictEqual(V.restore(slow.item.id).id, slow.item.id); assert.ok(existsSync(join(LIB, 'items', slow.item.id, 'item.json'))); V.remove(slow.item.id);
  });
  await t('search by names, tags, brand and page text, with the four filters; rights can be changed and decide what may be placed', () => {
    const ids = (q, f) => V.search(q, f).map(x => x.id);
    assert.ok(ids('pricing').includes(own.id)); assert.ok(ids('acme pricing').includes(own.id)); assert.deepStrictEqual(ids('route every model'), [page.id], 'the words the capture found');
    assert.ok(ids('', { kind: 'page' }).includes(page.id) && !ids('', { kind: 'page' }).includes(own.id)); assert.ok(ids('', { kind: 'image' }).includes(own.id));
    assert.deepStrictEqual(ids('', { source: 'stock' }), ['brold00001']); assert.ok(ids('', { source: 'links' }).includes(ref.id)); assert.ok(ids('', { source: 'uploaded' }).includes(own.id));
    assert.deepStrictEqual(ids('', { tag: 'omniroute' }), [page.id], 'a brand is a tag too'); assert.deepStrictEqual(ids('', { used: true }), ['brold00001']); assert.ok(!ids('', { used: false }).includes('brold00001'));
    assert.deepStrictEqual(ids('', { rights: 'reference' }), [ref.id]); assert.deepStrictEqual(ids('zebra'), []);
    V.update(pic.id, { rights: 'reference' }); assert.strictEqual(BR.get(pic.id), null); V.update(pic.id, { rights: 'mine', tags: ['Desk', 'desk', ' wood '], brand: 'Acme' });
    assert.deepStrictEqual([V.get(pic.id).tags, V.get(pic.id).brand, !!BR.get(pic.id)], [['desk', 'wood'], ['Acme'], true]); assert.throws(() => V.update(pic.id, { rights: 'stolen' }), /rights: mine/);
    assert.ok(V.topTags(V.load().items).slice(0, 2).includes('Acme'), 'brands lead the tag chips');
    const a = V.forAgent(page); assert.ok(!('thumbnail' in a) && !JSON.stringify(a).includes(LIB), 'words only: no picture, no path'); assert.ok(a.text && a.title && a.rights === 'public-page');
  });
  await t('limits: 2 GB a file, 20 GB a Vault with a line at 80%, a link is stale after 30 days', () => {
    assert.deepStrictEqual([V.LIMITS.fileBytes, V.LIMITS.vaultBytes, V.LIMITS.staleDays, V.LIMITS.trashDays], [2e9, 20e9, 30, 7]);
    const keep = { ...V.LIMITS };
    try {
      V.LIMITS.fileBytes = 4; assert.throws(() => V.add(file('big.png', 'far too big')), /over 2 GB/); V.LIMITS.fileBytes = keep.fileBytes;
      const used = V.usage().bytes; V.LIMITS.vaultBytes = used + 3; assert.ok(V.usage().near); assert.throws(() => V.add(file('more.png', 'does not fit')), /Your Vault is full/);
    } finally { Object.assign(V.LIMITS, keep); }
    assert.strictEqual(V.usage().near, false);
    assert.strictEqual(V.stale(page), false); assert.strictEqual(V.stale(page, Date.now() + 31 * 864e5), true); assert.strictEqual(V.brief(page, Date.now() + 42 * 864e5).captured, '6 weeks ago');
  });

  // ---------- matching ----------
  const slotA = { start: 2, end: 6, kind: 'panel', line: 'First is OmniRoute. It gives you one endpoint.', fx: { motion: 'push' } };
  await t('matching: a named thing wins, the reason says why, reference only is never offered, under the bar is only a guess', () => {
    const items = V.load().items, b = BB.rules(slotA), c = VM.candidates(b, items);
    assert.strictEqual(c[0].id, page.id); assert.strictEqual(c[0].reason, 'From your Vault: matches "OmniRoute"'); assert.ok(c[0].ok && c[0].score >= 90, JSON.stringify(c[0].parts)); assert.strictEqual(c[0].check, 'Check that you may show it.');
    assert.deepStrictEqual(Object.keys(c[0].parts), ['brief', 'slot', 'from', 'fresh', 'clean']); assert.ok(c[0].parts.brief <= 45 && c[0].parts.slot <= 25 && c[0].parts.from <= 15 && c[0].parts.fresh <= 10);
    // the words only a capture read: "says ... on screen"
    const said = { ...page, id: 'x1', name: 'a repo page', title: null, brand: [], tags: [] }; assert.strictEqual(VM.score(b, said).reason, 'From your Vault: says "OmniRoute" on screen');
    const mine = { ...page, id: 'x2', rights: 'mine', name: 'Pricing', brand: ['OmniRoute'] }; assert.ok(/^From your Vault: your page "Pricing", captured today$/.test(VM.score(b, mine).reason)); assert.ok(VM.score(b, mine).score > VM.score(b, { ...mine, rights: 'public-page' }).score, 'yours first');
    assert.strictEqual(VM.score(b, { ...page, rights: 'reference' }), null); assert.strictEqual(VM.score(b, { ...page, file: null }), null); assert.strictEqual(VM.score(b, { ...page, status: 'getting' }), null);
    assert.strictEqual(VM.score(b, own), null, 'no word of the brief in it: not a candidate'); assert.ok(!c.some(x => x.id === ref.id));
    assert.ok(VM.score(b, { ...mine, usedIn: ['a', 'b', 'c'] }).score < VM.score(b, mine).score, 'used before loses points');
    // plain words: one word of two is a guess under the bar when little else fits, both words clear it
    const d = BB.rules({ start: 0, end: 3, kind: 'full', line: 'my desk is where the ideas come from' }), g = VM.score(d, pic); assert.ok(g && /matches "desk"/.test(g.reason), JSON.stringify(g));
    const weak = VM.score({ ...d, subject: 'desk and ideas and coffee and plants', frame: 'upright 9:16', motion: 'still' }, { ...pic, usedIn: ['a', 'b', 'c', 'd'], width: 1920, height: 1080 }); assert.ok(weak.score < VM.BAR, 'under the bar: ' + weak.score);
    // the reference cutaway is the second voice: it counts when our own words find nothing
    const hint = VM.score({ ...BB.rules({ start: 0, end: 3, kind: 'panel', line: 'and that is it', what: 'Pricing', ref: { n: 1 } }), subject: 'something else' }, own); assert.ok(hint && /matches "pricing"/.test(hint.reason));
    for (const x of c) NO_DASH(x.reason);
    // whole words only: "car" is not in "postcard" and the name Rob is not in "problem"; a short name and a site still match
    const clipOf = name => ({ id: 'w', file: 'items/w/' + name, name, kind: 'video', rights: 'mine', tags: V.words(name), usedIn: [] }), named = (n, extra) => ({ ...b, named: [n], subject: n, ...extra });
    assert.strictEqual(VM.score(BB.rules({ start: 0, end: 3, kind: 'full', line: 'my car is parked outside' }), clipOf('scarf-and-postcard.mp4')), null);
    assert.strictEqual(VM.score(named('Rob'), clipOf('problem-solving.mp4')), null); assert.ok(VM.score(named('Rob'), clipOf('rob-on-stage.mp4')).score >= VM.BAR);
    assert.ok(VM.score(named('AI'), clipOf('ai tools.mp4')), 'a two letter name'); assert.ok(VM.score(named('omniroute.dev'), { ...clipOf('home.mp4'), text: 'welcome to omniroute.dev today' }), 'a site in the page text');
    assert.ok(VM.score(BB.rules({ start: 0, end: 3, kind: 'full', line: 'my cars are parked outside' }), clipOf('red-car.mp4')), 'a stem still matches');
  });
  await t('matching: the same item is never the pick of two slots, and the slot that serves the point chooses first', () => {
    const items = V.load().items, b1 = BB.rules(slotA), b2 = BB.rules({ ...slotA, start: 10, end: 14, line: 'OmniRoute routes every model.' }, { point: 'route every model' });
    assert.strictEqual(b2.serves, true); const a = VM.assign([{ key: 1, brief: b1 }, { key: 2, brief: b2 }], items);
    assert.strictEqual(a[2][0].id, page.id, 'the later slot serves the point, so it takes the best item'); assert.ok(!a[1].some(x => x.id === page.id));
    assert.deepStrictEqual(VM.assign([{ key: 1, brief: b1 }], items, { used: new Set([page.id]) })[1].map(x => x.id), [], 'already in the reel');
  });

  // ---------- the schemas ----------
  await t('schemas: one definition for the MCP tools and the Studio routes; unknown keys, wrong types and bad choices are refused', () => {
    assert.deepStrictEqual(Object.keys(SC.SCHEMAS), ['add_to_vault', 'capture_link', 'search_vault', 'set_broll_brief']);
    for (const s of Object.values(SC.SCHEMAS)) assert.strictEqual(s.additionalProperties, false);
    assert.ok(SC.check('search_vault', { q: 'desk', kind: 'page', used: false, limit: 5 }));
    assert.throws(() => SC.check('search_vault', { kind: 'gif' }), /kind must be one of: video, image, page, screen/); assert.throws(() => SC.check('search_vault', { used: 'yes' }), /used must be a boolean/);
    assert.throws(() => SC.check('capture_link', {}), /link is needed/); assert.throws(() => SC.check('capture_link', { link: 'x.com', steps: [] }), /unknown option steps/);
    assert.throws(() => SC.check('add_to_vault', { file: 'a.png', tags: ['a', 3] }), /tags must be a list of strings/); assert.throws(() => SC.check('set_broll_brief', { slot: '2' }), /slot must be a number/);
    assert.throws(() => SC.check('set_broll_brief', { slot: 1, shot: 'drone' }), /shot must be one of/);
    assert.deepStrictEqual(SC.fromQuery('search_vault', new URLSearchParams('q=desk&used=false&limit=3&kind=')), { q: 'desk', used: false, limit: 3 });
    assert.ok(!Object.keys(SC.SCHEMAS).some(k => /delete|remove/.test(k)), 'there is no delete tool for agents');
  });

  // ---------- Studio and MCP ----------
  const LINES = ['Editing ate my weekends.', 'I tried every app.', 'Then I found one prompt.', 'It plans the whole edit.', 'Here is how to set it up.', 'Open the dashboard.', 'Type your topic.', 'And press go.', 'Leads went up 312 percent.', 'In three months.', 'My bike got a new saddle.', 'Tell me how it went.'];
  const WORDS = LINES.flatMap((l, k) => { const ws = l.split(' '), d = 1.6 / ws.length; return ws.map((w, i) => ({ start: +(k * 2 + 0.1 + i * d).toFixed(3), end: +(k * 2 + 0.1 + (i + 1) * d - 0.03).toFixed(3), word: w })); });
  const MD = ['---', 'videomd: 1', 'name: ref', 'source:', '  file: ref.mp4', '  duration: 48', 'x-reel: 1', '---', '', '# Ref', '', '## Style', '- captions: one-word', '', '## Shots', '', '```videomd-timeline', '#01 0-48 | framing close-up', '```', '',
    '## Script', '', '```reel-script', '#01 20-25 | say Open the dashboard and look', '```', ''].join('\n');
  const flips = LINES.map((l, k) => ({ start: +(k * 2 + 0.1).toFixed(2), end: +(k * 2 + 1.8).toFixed(2), text: l }));
  const CUT = { segs: [{ file: 'x.mp4', in: 0, out: 24 }] }, build = join(jobDir, 'build'); mkdirSync(build, { recursive: true });
  const slots = BS.forRecreate(BS.fromRecipe(RM.parse(BS.appendBlock(MD, BS.detect([{ start: 20, end: 26, box: [0.19, 0.57, 0.62, 0.21], shows: 'Kilo Code', shot: 'screen recording' }, { start: 40, end: 44, kind: 'full' }], [{ motion: 'push', in: 'pop', out: 'fade' }, { in: 'cut', out: 'cut' }])), 'Reel.md')), { k: 0.5, len: 24, words: WORDS, refLen: 48 });
  writeFileSync(join(build, 'cut.json'), JSON.stringify(CUT));
  writeFileSync(join(build, 'captions.js'), 'window.CAPTIONS = ' + JSON.stringify({ flips: [...flips, ...slots.filter(x => x.kind === 'panel').map(BS.flipOf)] }) + ';\n');
  RC.writePlan(build, RC.planOf({ recipe: { file: 'Reel.md' }, cut: CUT, broll: slots.map(x => ({ ...x, brief: BB.rules(x) })) }));
  // a stock mock that counts every call: a suggestion alone must never reach it
  let stockCalls = 0; mock = createServer((req, res) => { stockCalls++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ videos: [] })); }); await new Promise(ok => mock.listen(0, '127.0.0.1', ok));
  const env = { ...process.env, CI: '1', STUDIO_CHAT: '', STUDIO_AGENT_CLIENT: '', CHROME_PATH: join(STATE, 'no-chrome'), PEXELS_API_KEY: 'test-key', STUDIO_API_BASE_PEXELS: `http://127.0.0.1:${mock.address().port}`, PIXABAY_API_KEY: '', STUDIO_BROLL_AUTO: '', STUDIO_VAULT_CAPTURE: '0' };
  srv = spawn(process.execPath, [join(ROOT, 'kit', 'studio', 'server.mjs'), '--port', '0', '--no-open'], { cwd: ROOT, env });
  let srvOut = '';
  const url = await new Promise((ok, bad) => { srv.stdout.on('data', d => { srvOut += d; const m = srvOut.match(/Studio: (http:\/\/127\.0\.0\.1:\d+)/); if (m) ok(m[1]); }); srv.stderr.on('data', d => { srvOut += d; }); srv.on('close', c => bad(new Error('server exited ' + c + ': ' + srvOut))); });
  const req = async (path, body, headers = {}) => { const r = await fetch(url + path, { method: body !== undefined ? 'POST' : 'GET', headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers, body: body !== undefined ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch {} return { status: r.status, j, text }; };
  await req('/api/state', { job: JOB });
  V.remove(pic.id); // the desk photo from above: the Studio tests start with nothing that fits
  let dash, desk, s1, s2;
  await t('Studio: every plan slot has its brief; with nothing in the Vault the card says so, and stock is only offered, never fetched', async () => {
    const v = (await req('/api/broll')).j, ps = v.beats.filter(b => b.brief); assert.strictEqual(ps.length, 2, JSON.stringify(v.beats.map(b => [b.n, b.text, !!b.brief])));
    [s1, s2] = ps; assert.deepStrictEqual([s1.brief.slot, s2.brief.slot], [1, 2]);
    assert.ok(/dashboard/i.test(s1.brief.subject) && s1.brief.shot === 'screen recording' && /^Show .*dashboard.*\. /i.test(s1.brief.text), JSON.stringify(s1.brief)); assert.strictEqual(s1.need.show, s1.brief.text);
    assert.deepStrictEqual(s1.brief.reference.showed, 'Kilo Code'); assert.ok(!/Kilo/.test(s1.brief.subject), 'the reference subject is a hint, not ours');
    assert.deepStrictEqual([s1.candidates, s1.need.suggest, s1.need.none], [[], null, 'Nothing in your Vault fits yet.'], 'a screen slot gets no stock suggestion');
    assert.ok(s2.need.suggest && s2.need.suggest.from === 'stock' && /^From Pexels: "/.test(s2.need.suggest.reason), JSON.stringify(s2.need)); assert.strictEqual(stockCalls, 0, 'no network call for a suggestion'); NO_DASH(JSON.stringify(v));
  });
  await t('Studio: a clip only a looser search would find is not picked for a plan slot and Suggest still answers; the old library route cannot delete for an agent', async () => {
    // the reference showed "Kilo Code": "kilometers" holds those letters and is not that
    const r = await fetch(`${url}/api/vault/upload?name=kilometers.png`, { method: 'POST', body: 'png km' }), km = (await r.json()).item;
    assert.deepStrictEqual((await req('/api/broll')).j.beats.find(b => b.n === s1.n).candidates, []);
    const sg = await req('/api/broll/suggest', {}); assert.strictEqual(sg.status, 200, sg.text); assert.strictEqual(sg.j.broll.beats.find(b => b.n === s1.n).idea, null);
    assert.strictEqual((await req('/api/broll/library', { id: km.id, action: 'remove' })).status, 403); assert.ok(V.get(km.id));
    assert.strictEqual((await req('/api/broll/library', { id: km.id, action: 'remove' }, { 'x-studio-page': '1' })).status, 200); assert.strictEqual(V.get(km.id), null);
    await req('/api/broll/clear', {}).catch(() => {});
  });
  await t('Studio: the Vault routes: upload, the same file once, a link saved as reference only, filters, delete only from the page, Undo', async () => {
    const up = async (name, body, q = '') => { const r = await fetch(`${url}/api/vault/upload?name=${encodeURIComponent(name)}${q}`, { method: 'POST', body }); return { status: r.status, j: await r.json() }; };
    const a = await up('sales dashboard.png', 'png dashboard', '&brand=Acme'); assert.strictEqual(a.status, 200, JSON.stringify(a.j)); dash = a.j.item;
    assert.deepStrictEqual([dash.rights, dash.rightsLabel, dash.kind, dash.source, dash.placeable, dash.line, dash.brand], ['mine', 'Mine', 'image', 'uploaded', true, 'Image', ['Acme']]); assert.ok(!JSON.stringify(dash).includes(LIB), 'no file path on the page');
    const again = await up('copy.png', 'png dashboard'); assert.deepStrictEqual([again.j.duplicate, again.j.note, again.j.item.id], [true, 'You already have this.', dash.id]);
    desk = (await up('bike saddle.png', 'png bike')).j.item; assert.strictEqual((await up('notes.pdf', 'x')).status, 400);
    const ln = await req('/api/vault/link', { link: 'https://www.tiktok.com/@someone/video/123?utm_source=x' }); assert.strictEqual(ln.status, 202, ln.text);
    assert.deepStrictEqual([ln.j.item.rights, ln.j.item.rightsLabel, ln.j.item.placeable, ln.j.item.kind], ['reference', 'Reference only', false, 'page']); assert.ok(/never placed in a reel/.test(ln.j.reference));
    assert.strictEqual((await req('/api/vault/link', { link: 'tiktok.com/@someone/video/123' })).j.duplicate, true); assert.strictEqual((await req('/api/vault/link', { link: 'x.com/a', steps: [] })).status, 400); assert.strictEqual((await req('/api/vault/link', { link: 'not a link' })).status, 400);
    const all = (await req('/api/vault')).j; assert.ok(all.total >= 4 && all.items.some(x => x.id === dash.id) && all.usage.limit === 20e9 && all.usage.line === null && all.capture === false && all.pictures === false);
    assert.deepStrictEqual((await req('/api/vault?q=dashboard&kind=image')).j.items.map(x => x.id), [dash.id]); assert.ok((await req('/api/vault?source=links')).j.items.every(x => x.source === 'links'));
    assert.strictEqual((await req('/api/vault?kind=gif')).status, 400); assert.strictEqual((await req('/api/vault?folder=x')).status, 400);
    assert.strictEqual((await fetch(`${url}/api/vault/file?id=${dash.id}`).then(r => r.text())), 'png dashboard');
    const tmp = (await up('old.png', 'png old')).j.item;
    assert.strictEqual((await req('/api/vault/item', { id: tmp.id, action: 'delete' })).status, 403, 'an agent cannot delete'); const del = await req('/api/vault/item', { id: tmp.id, action: 'delete' }, { 'x-studio-page': '1' });
    assert.ok(del.status === 200 && /undo for 7 days/.test(del.j.note)); assert.strictEqual((await req('/api/vault')).j.undo.id, tmp.id); assert.ok(!(await req('/api/vault')).j.items.some(x => x.id === tmp.id));
    const un = await req('/api/vault/item', { action: 'undo' }); assert.strictEqual(un.j.item.id, tmp.id); assert.ok((await req('/api/vault')).j.items.some(x => x.id === tmp.id));
    const ed = await req('/api/vault/item', { id: tmp.id, action: 'update', tags: ['logo'], rights: 'licensed', patch: { file: '/etc/passwd' } }); assert.deepStrictEqual([ed.j.item.tags, ed.j.item.rights], [['logo'], 'licensed']); assert.ok(!/passwd/.test(JSON.stringify(V.get(tmp.id))));
  });
  await t('Studio: the Vault is the first source: the card shows the pick and its reason, Swap has the rest, a reference only item is refused', async () => {
    const v = (await req('/api/broll')).j, a = v.beats.find(b => b.n === s1.n), z = v.beats.find(b => b.n === s2.n);
    assert.deepStrictEqual([a.need.suggest.from, a.need.suggest.id, a.need.suggest.reason, a.need.suggest.ok], ['vault', dash.id, 'From your Vault: matches "dashboard"', true]); assert.ok(a.need.suggest.clip.thumb !== undefined && a.need.none === undefined);
    assert.ok(z.need.suggest.from === 'vault' && z.need.suggest.id === desk.id, 'the Vault comes before stock: ' + JSON.stringify(z.need.suggest)); assert.strictEqual(stockCalls, 0);
    const refId = V.load().items.find(x => x.rights === 'reference' && /tiktok/.test(x.from.url)).id, no = await req('/api/broll/slot', { beat: s1.n, clip: refId }); assert.strictEqual(no.status, 403); assert.ok(/reference only/.test(no.j.error) && /never placed/.test(no.j.error));
    // after a draft the picks over the bar go on by themselves, with the reason kept
    const sg = await req('/api/broll/suggest', { fill: true }); assert.strictEqual(sg.status, 200, sg.text);
    const f = sg.j.broll.beats.find(b => b.n === s1.n); assert.ok(f.slot && !f.need, 'the slot is filled'); assert.deepStrictEqual([f.slot.clip.id, f.slot.why, f.slot.by, f.slot.place], [dash.id, 'From your Vault: matches "dashboard"', 'Studio', 'card']);
    assert.ok(Array.isArray(f.candidates) && !f.candidates.some(c => c.id === dash.id), 'Swap never offers what is already in the reel'); assert.strictEqual(stockCalls, 0);
    const taken = sg.j.broll.beats.filter(b => b.slot).map(b => b.slot.clip.id); assert.strictEqual(new Set(taken).size, taken.length, 'no item twice');
  });
  await t('MCP: the four tools carry the shared schemas; list_broll returns brief and candidates; an agent gets words, no pictures', async () => {
    client = new Client({ name: 'vault-test', version: '1' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'kit', 'mcp.mjs')], cwd: ROOT, stderr: 'ignore', env: { ...env, STUDIO_PORT: new URL(url).port } }));
    const tools = (await client.listTools()).tools; for (const k of Object.keys(SC.SCHEMAS)) assert.deepStrictEqual(tools.find(x => x.name === k).inputSchema, JSON.parse(JSON.stringify(SC.SCHEMAS[k])), k);
    assert.ok(!tools.some(x => /delete_vault|remove_vault/.test(x.name)));
    const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); return { err: r.isError, text: r.content[0].text, out: r.structuredContent }; };
    assert.ok((await call('search_vault', { kind: 'gif' })).err); assert.ok(/unknown option/.test((await call('capture_link', { link: 'x.com', steps: ['scroll'] })).text)); assert.ok(/file or link/.test((await call('add_to_vault', {})).text));
    const lb = (await call('list_broll', {})).out, b1 = lb.beats.find(b => b.n === s1.n), b2 = lb.beats.find(b => b.n === s2.n);
    assert.ok(b1.brief && /^Show /.test(b1.brief.text) && b1.brief.slot === 1 && Array.isArray(b1.candidates), JSON.stringify(b1)); assert.ok(b2.brief && (b2.need ? b2.need.suggest : b2.slot), JSON.stringify(b2));
    const sv = (await call('search_vault', { q: 'sales dashboard' })).out; assert.deepStrictEqual(sv.items.map(x => x.id), [dash.id]); assert.ok(!('thumbnail' in sv.items[0]) && !JSON.stringify(sv).includes(LIB), 'words only by default');
    assert.deepStrictEqual((await call('search_vault', { rights: 'reference' })).out.items.every(x => x.placeable === false), true);
    const add = (await call('add_to_vault', { file: file('team photo.jpg', 'jpg team'), tags: ['team'], brand: ['Acme'], description: 'the team at the office' })).out; assert.deepStrictEqual([add.item.rights, add.item.description, add.duplicate], ['mine', 'the team at the office', false]);
    assert.strictEqual((await call('add_to_vault', { file: join(STATE, 'in', 'team photo.jpg') })).out.duplicate, true);
    const cl = (await call('capture_link', { link: 'https://www.instagram.com/reel/Cx1abc/' })).out; assert.deepStrictEqual([cl.item.rights, cl.item.placeable], ['reference', false]); assert.ok(/reference only/.test(cl.note));
    // the brief, rewritten by the agent: kept in the plan, shown on the card, matched again
    const sb = await call('set_broll_brief', { slot: 2, subject: 'the team at the office', shot: 'person', why: 'It shows who did the work' }); assert.ok(!sb.err, sb.text);
    assert.deepStrictEqual([sb.out.brief.subject, sb.out.brief.shot, sb.out.brief.text, sb.out.brief.by], ['the team at the office', 'person', 'Show the team at the office. It shows who did the work.', 'Vault Test']);
    assert.strictEqual(JSON.parse(readFileSync(join(build, 'plan.json'), 'utf8')).broll.find(x => x.n === 2).brief.subject, 'the team at the office');
    assert.ok(sb.out.candidates.some(c => c.clip === add.item.id && /matches "team/.test(c.reason)), JSON.stringify(sb.out.candidates));
    assert.ok((await call('set_broll_brief', { slot: 9, subject: 'x y z' })).err); assert.ok((await call('set_broll_brief', { slot: 2, shot: 'drone' })).err);
    const ranked = (await call('search_vault', { slot: 2 })).out; assert.ok(ranked.brief.subject === 'the team at the office' && ranked.items[0].id === add.item.id && /^From your Vault:/.test(ranked.items[0].reason));
    // pictures only when the user turned them on
    await req('/api/settings', { broll: { vaultPictures: true } });
    assert.strictEqual((await req('/api/vault')).j.pictures, true);
    await req('/api/settings', { broll: { vaultPictures: false } });
  });
  console.log(`\nVAULT PASS (${n} tests)`);
} finally {
  try { await client?.close(); } catch {}
  try { srv?.kill(); } catch {} try { mock?.close(); } catch {}
  rmSync(STATE, { recursive: true, force: true }); rmSync(jobDir, { recursive: true, force: true });
}
