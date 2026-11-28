// Repo or tool feature mode (kit/repo-broll.mjs, spec section 9 and 14.10), with a saved README and no network:
// the README's pictures in order with their headings, badges and tiny logos left out, every URL and redirect hop
// checked with the connection pinned to the checked address, no private address, the 25 MB cap, pictures and videos
// only, the download with meta.json, and the plan: the repo in its card on the body (never full screen, never README
// or page text), you on the hook, punch lines and CTA; takeovers off; frame breakout.
// Run: node tests/repo-broll.test.mjs   (npm run check runs it)
import assert from 'assert';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TMP = mkdtempSync(join(tmpdir(), 'repo-broll-test-')); process.env.ATH_ASSETS = TMP;
const RB = await import('../kit/repo-broll.mjs');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const README = readFileSync(join(ROOT, 'tests', 'fixtures', 'repo', 'README.md'), 'utf8');
// a PNG of a given size (header only is enough for sizeOf), a GIF, an mp4
const png = (w, h) => { const b = Buffer.alloc(40); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const gif = (w, h) => { const b = Buffer.alloc(16); b.write('GIF89a', 0); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
// DNS: public names get a public address, evil.example a private one
const resolver = (host, o, cb) => cb(null, [{ address: host === 'evil.example' ? '10.0.0.5' : '140.82.112.3', family: 4 }]);
// the network: answers by URL, and like a socket it asks the lookup it was handed first (so a private answer stops it)
const routes = {};
const request = (u, { lookup }) => new Promise((ok, bad) => lookup(new URL(u).hostname, {}, err => { if (err) return bad(err); const r = routes[u]; if (!r) return ok({ status: 404, headers: {}, body: Buffer.alloc(0) }); ok(typeof r === 'function' ? r() : r); }));
const R = (type, body, extra = {}) => ({ status: 200, headers: { 'content-type': type, ...extra }, body });

try {
  await t('the README gives its pictures and videos in order, with the heading above each; code blocks are skipped', () => {
    const a = RB.readmeAssets(README, 'https://raw.githubusercontent.com/demo/tool/main/');
    assert.deepStrictEqual(a.map(x => x.url.replace('https://raw.githubusercontent.com/demo/tool/main/', '')), ['docs/logo.png', 'https://github.com/demo/tool/actions/workflows/ci.yml/badge.svg', 'https://img.shields.io/npm/v/demo-tool.svg', 'docs/preview.png', 'https://example.com/batch.gif', 'https://example.com/install.mp4', 'https://github.com/user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-123456789abc', 'docs/dot.png']);
    const byUrl = Object.fromEntries(a.map(x => [x.url.split('/').pop(), x]));
    assert.strictEqual(byUrl['preview.png'].heading, 'Live preview'); assert.strictEqual(byUrl['preview.png'].alt, 'The live preview window');
    assert.strictEqual(byUrl['batch.gif'].heading, 'Batch export'); assert.strictEqual(byUrl['batch.gif'].width, 800);
    assert.strictEqual(byUrl['install.mp4'].kind, 'video'); assert.strictEqual(byUrl['logo.png'].heading, 'Demo Tool');
  });
  await t('badges, shields, SVGs and small logos are never b-roll', () => {
    const a = RB.readmeAssets(README, 'https://raw.githubusercontent.com/demo/tool/main/').filter(RB.usable).map(x => x.url.split('/').pop());
    assert.deepStrictEqual(a, ['preview.png', 'batch.gif', 'install.mp4', '0f1e2d3c-aaaa-bbbb-cccc-123456789abc', 'dot.png']);
    assert.ok(!RB.usable({ url: 'https://example.com/x.png', alt: '', height: 20 }), 'under 40 px tall');
    assert.deepStrictEqual(RB.sizeOf(png(1280, 720)), { w: 1280, h: 720 }); assert.deepStrictEqual(RB.sizeOf(gif(800, 450)), { w: 800, h: 450 });
  });
  await t('only public addresses: names, DNS answers and every redirect hop are checked', async () => {
    const ask = (u, o = {}) => RB.safeGet(u, { request, resolver, ...o });
    await assert.rejects(ask('file:///etc/passwd'), /only http and https/);
    await assert.rejects(ask('http://localhost/x.png'), /not a public host/);
    await assert.rejects(ask('http://192.168.1.4/x.png'), /not a public host/);
    await assert.rejects(ask('https://user:pw@example.com/x.png'), /no logins/);
    await assert.rejects(ask('https://evil.example/x.png'), /private address/, 'a public-looking name that resolves to a private address');
    routes['https://example.com/hop.png'] = { status: 302, headers: { location: 'https://evil.example/x.png' }, body: Buffer.alloc(0) };
    await assert.rejects(ask('https://example.com/hop.png'), /private address/, 'a redirect to a private address is stopped');
    routes['https://example.com/hop2.png'] = { status: 302, headers: { location: 'http://127.0.0.1:8080/x' }, body: Buffer.alloc(0) };
    await assert.rejects(ask('https://example.com/hop2.png'), /not a public host/);
    for (const h of ['[::1]', '[fd00::1]', '[::ffff:127.0.0.1]', '[64:ff9b::a00:1]', '[2002::1]', '[fec0::1]', '[fe80::1]', '[::]']) await assert.rejects(ask(`http://${h}:8080/x.png`), /not a public host/, h);
    assert.ok(!RB.privateIp('2606:4700::1111') && RB.privateIp('2001:db8::1') && RB.privateIp('2001::1') && RB.privateIp('::ffff:7f00:1'), 'IPv6: global unicast only');
    let lk = null; RB.safeLookup(resolver)('example.com', {}, (e, addr) => { lk = [e, addr]; }); assert.deepStrictEqual(lk, [null, '140.82.112.3'], 'the socket gets the checked address');
    routes['https://example.com/loop.png'] = { status: 302, headers: { location: 'https://example.com/loop.png' }, body: Buffer.alloc(0) };
    await assert.rejects(ask('https://example.com/loop.png'), /too many redirects/);
  });
  await t('the real request asks our lookup on its socket: a name that resolves to a private address never connects', async () => {
    const seen = []; const priv = (host, o, cb) => { seen.push(host); cb(null, [{ address: '127.0.0.1', family: 4 }]); };
    await assert.rejects(RB.safeGet('http://pin.test:9/x.png', { resolver: priv }), /private address/);
    assert.deepStrictEqual(seen, ['pin.test'], 'the socket used the checked lookup (no request swapped in)');
  });
  await t('pictures and videos only, at most 25 MB, checked while it downloads too', async () => {
    const ask = (u, o = {}) => RB.safeGet(u, { request, resolver, ...o });
    routes['https://example.com/page.png'] = R('text/html', Buffer.from('<html>'));
    await assert.rejects(ask('https://example.com/page.png'), /not a picture or a video/);
    routes['https://example.com/big.mp4'] = R('video/mp4', Buffer.alloc(10), { 'content-length': String(RB.MAX_BYTES + 1) });
    await assert.rejects(ask('https://example.com/big.mp4'), /over 25 MB/);
    let read = 0, aborted = 0; async function* chunks() { for (let i = 0; i < 3000; i++) { read++; yield Buffer.alloc(1024); } }
    routes['https://example.com/liar.mp4'] = () => ({ ...R('video/mp4', chunks()), abort: () => { aborted++; } });
    await assert.rejects(ask('https://example.com/liar.mp4', { max: 1048576 }), /over 1 MB/, 'a file bigger than it said stops at the cap');
    assert.ok(read <= 1026 && aborted >= 1, `reading stops and the connection is closed (${read} read, ${aborted} aborts)`);
    let ab2 = 0; routes['https://example.com/huge.png'] = () => ({ ...R('image/png', Buffer.alloc(1), { 'content-length': String(RB.MAX_BYTES * 2) }), abort: () => { ab2++; } });
    await assert.rejects(ask('https://example.com/huge.png'), /over 25 MB/); assert.ok(ab2 >= 1, 'a too-big answer is closed unread');
    let ab3 = 0; routes['https://example.com/wrong.png'] = () => ({ ...R('text/html', Buffer.alloc(1)), abort: () => { ab3++; } });
    await assert.rejects(ask('https://example.com/wrong.png'), /not a picture/); assert.ok(ab3 >= 1, 'a wrong type is closed unread');
    routes['https://example.com/ok.png'] = R('image/png', png(1280, 720));
    assert.strictEqual((await ask('https://example.com/ok.png')).body.length, 40);
  });
  await t('a repo is fetched to assets/web/<owner>--<repo> with meta.json; a GIF becomes a looping MP4; no text card of the repo; bad files are skipped and said', async () => {
    const raw = 'https://raw.githubusercontent.com/demo/tool/main/';
    routes['https://api.github.com/repos/demo/tool'] = R('application/json', Buffer.from(JSON.stringify({ full_name: 'demo/tool', stargazers_count: 1234, description: 'Notes into videos', default_branch: 'main' })));
    routes['https://api.github.com/repos/demo/tool/readme'] = R('application/vnd.github.raw', Buffer.from(README));
    routes[raw + 'docs/preview.png'] = R('image/png', png(1600, 900));
    routes['https://example.com/batch.gif'] = R('image/gif', gif(800, 450));
    const mp4 = tag => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom' + tag)]);
    routes['https://example.com/install.mp4'] = R('video/mp4', mp4('a'));
    routes['https://github.com/user-attachments/assets/0f1e2d3c-aaaa-bbbb-cccc-123456789abc'] = { status: 302, headers: { location: 'https://objects.example.com/clip.mp4' }, body: Buffer.alloc(0) };
    routes['https://objects.example.com/clip.mp4'] = R('video/mp4', mp4('b'));
    routes[raw + 'docs/dot.png'] = R('image/png', png(16, 16));
    const conv = (src, out) => (writeFileSync(out, 'mp4 from gif')), secs = () => 6;
    const m = await RB.fetchRepo('https://github.com/demo/tool', { request, resolver, convert: conv, seconds: secs });
    assert.strictEqual(m.dir, join(TMP, 'demo--tool'));
    assert.deepStrictEqual(m.header, { name: 'demo/tool', stars: 1234, description: 'Notes into videos', url: 'https://github.com/demo/tool' });
    assert.deepStrictEqual(m.assets.map(a => [a.file, a.kind, a.heading]), [['01.png', 'image', 'Live preview'], ['02.mp4', 'video', 'Batch export'], ['03.mp4', 'video', 'Install'], ['04.mp4', 'video', 'Install']]);
    assert.ok(m.assets.every(a => !a.header && !a.capture), 'no social preview card and no page capture'); assert.strictEqual(m.assets[3].source, 'https://objects.example.com/clip.mp4', 'where it really came from');
    assert.ok(m.skipped.some(x => /dot\.png/.test(x.url) && /too small/.test(x.why)) && m.skipped.some(x => /shields/.test(x.url)));
    const meta = JSON.parse(readFileSync(join(m.dir, 'meta.json'), 'utf8')); assert.strictEqual(meta.assets.length, 4); assert.ok(existsSync(join(m.dir, '02.mp4')) && !existsSync(join(m.dir, '02.gif'))); assert.strictEqual(m.assets[1].seconds, 6);
    assert.strictEqual((await RB.fetchRepo('https://github.com/demo/tool', { request: () => { throw new Error('no network'); }, resolver })).cached, true, 'a second time reads the cache');
    // a failed fetch (README unreachable) is not cached and leaves the good folder alone
    const down = (u, o) => u.endsWith('/readme') ? Promise.resolve({ status: 503, headers: {}, body: Buffer.alloc(0) }) : request(u, o);
    const again = await RB.fetchRepo('https://github.com/demo/tool', { request: down, resolver, force: true, convert: conv, seconds: secs });
    assert.ok(again.stale && existsSync(join(m.dir, '01.png')) && JSON.parse(readFileSync(join(m.dir, 'meta.json'), 'utf8')).assets.length === 4, 'the older good folder stays');
    const none = await RB.fetchRepo('https://github.com/demo/gone', { request, resolver });
    assert.ok(none.failed && !existsSync(join(TMP, 'demo--gone', 'meta.json')), 'nothing cached for a repo we could not read');
    // a file that is not what its label says never reaches FFmpeg (a playlist called a video)
    assert.ok(!RB.magicOk('video/mp4', Buffer.from('#EXTM3U\n#EXTINF:1,\nfile:///etc/passwd')) && RB.magicOk('video/mp4', mp4('c')) && !RB.magicOk('image/gif', Buffer.from('<html>')));
    // a partial fetch (one file timed out) does not replace the fuller folder
    const slow = (u, o) => /preview\.png|install\.mp4/.test(u) ? Promise.reject(new Error('timed out: ' + u)) : request(u, o);
    const part = await RB.fetchRepo('https://github.com/demo/tool', { request: slow, resolver, force: true, convert: conv, seconds: secs });
    assert.ok(part.stale && JSON.parse(readFileSync(join(m.dir, 'meta.json'), 'utf8')).assets.length === 4, 'the fuller folder stays');
    const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp[20] = 2; assert.ok(RB.animatedWebp(webp));
    assert.throws(() => { if (!RB.parseRepo('https://github.com/../x')) throw new Error('refused'); }, /refused/); assert.strictEqual(RB.parseRepo('https://gitlab.com/a/b'), null);
  });
  await t('a README with nothing usable is never captured as a page; its text and facts are kept for the animated cards', async () => {
    routes['https://api.github.com/repos/demo/bare'] = R('application/json', Buffer.from(JSON.stringify({ full_name: 'demo/bare', stargazers_count: 12, forks_count: 3, language: 'Go', license: { spdx_id: 'MIT' }, topics: ['cli'] })));
    routes['https://api.github.com/repos/demo/bare/contents'] = R('application/json', Buffer.from(JSON.stringify([{ name: '.github', type: 'dir' }, { name: 'cmd', type: 'dir' }, { name: 'go.mod', type: 'file' }])));
    routes['https://api.github.com/repos/demo/bare/readme'] = R('text/plain', Buffer.from('# Bare\n\n[![x](https://img.shields.io/x.svg)](x)'));
    const m = await RB.fetchRepo('https://github.com/demo/bare', { request, resolver });
    assert.ok(!m.failed && !m.assets.length && !m.assets.some(a => a.capture), JSON.stringify(m.assets));
    assert.deepStrictEqual(m.facts, { language: 'Go', license: 'MIT', forks: 3, topics: ['cli'], files: ['cmd/', 'go.mod'] });
    assert.match(readFileSync(join(m.dir, 'readme.md'), 'utf8'), /# Bare/);
    assert.ok((await RB.fetchRepo('https://github.com/demo/bare', { request: () => { throw new Error('no network'); }, resolver })).cached, 'cached too');
    // no README at all is an empty one; GitHub's facts failing for now (a rate limit) are used but not cached
    routes['https://api.github.com/repos/demo/noreadme'] = R('application/json', Buffer.from(JSON.stringify({ full_name: 'demo/noreadme', description: 'A thing' })));
    const nr = await RB.fetchRepo('https://github.com/demo/noreadme', { request, resolver }); assert.ok(!nr.failed && nr.header.description === 'A thing');
    const limited = (u, o) => (u === 'https://api.github.com/repos/demo/rl' ? Promise.resolve({ status: 403, headers: {}, body: Buffer.alloc(0) }) : request(u, o));
    routes['https://api.github.com/repos/demo/rl/readme'] = R('text/plain', Buffer.from('# RL'));
    const rl = await RB.fetchRepo('https://github.com/demo/rl', { request: limited, resolver }); assert.ok(!rl.failed && rl.partial, 'used this time');
    routes['https://api.github.com/repos/demo/rl'] = R('application/json', Buffer.from(JSON.stringify({ full_name: 'demo/rl', stargazers_count: 7 })));
    assert.strictEqual((await RB.fetchRepo('https://github.com/demo/rl', { request, resolver })).header.stars, 7, 'and asked again next time');
  });
  const lines = [
    { start: 0, end: 3, text: 'This tool saves me hours every week.', section: 'hook' },
    { start: 3, end: 7, text: 'It reads your notes and makes a draft video.', section: 'body' },
    { start: 7, end: 11, text: 'The live preview shows every change as you type.', section: 'body' },
    { start: 11, end: 14, text: 'Look at this, ten clips in one go.', section: 'body' },
    { start: 14, end: 16, text: 'It is wild!', section: 'body' },
    { start: 16, end: 20, text: 'Follow for more tools like this.', section: 'cta' },
  ];
  const assets = [{ path: '/a/01.png', kind: 'image', heading: '', alt: 'demo/tool', header: true }, { path: '/a/02.png', kind: 'image', heading: 'Live preview', alt: 'The live preview window' }, { path: '/a/03.gif', kind: 'image', heading: 'Batch export', alt: 'Exporting ten clips at once' }];
  await t('the plan: the repo in its card on the body (a named heading picks its picture), you on the hook, punch lines and CTA', () => {
    const p = RB.planRepo(lines, assets);
    assert.deepStrictEqual(p.inserts.map(x => [x.line.slice(0, 12), x.place, x.file]), [['It reads you', 'top', '/a/02.png'], ['The live pre', 'top', '/a/03.gif'], ['Look at this', 'top', '/a/02.png']], 'the picture changes on every line');
    assert.strictEqual(RB.planRepo([lines[2]], [...assets].reverse()).inserts[0].file, '/a/02.png', 'a line that names a heading gets that picture');
    assert.deepStrictEqual(p.takeovers.map(x => x.why), ['hook', 'punch line', 'cta']);
    assert.ok(p.inserts.every(x => x.repo && x.image && x.at >= 3 && x.at + x.dur <= 16), 'never on the hook or the CTA');
  });
  await t('the repo rule (Will, 2026-11-27): never full screen, never README or page text, whatever the line says', () => {
    const pointy = [{ start: 3, end: 9, text: 'Look at this, right here, the live preview on screen.', section: 'body' }, { start: 9, end: 15, text: 'Check this out, batch export, as you can see.', section: 'body' }];
    for (const o of [{}, { breakout: true }, { takeovers: 'off' }, { breakout: true, swapSec: [8, 10] }]) {
      const p = RB.planRepo(pointy, assets, o);
      assert.ok(p.inserts.length && p.inserts.every(x => ['top', 'frame'].includes(x.place)), JSON.stringify(p.inserts.map(x => x.place)));
      assert.deepStrictEqual(RB.repoRuleBreaks(p.inserts), []);
      assert.ok(!p.inserts.some(x => x.file === '/a/01.png'), 'the text card of the repo is never a shot');
      assert.ok(p.takeovers.every(x => x.who === 'you'), 'only you go full screen');
    }
    const page = { path: '/a/page.png', kind: 'image', heading: '', alt: 'demo/tool', capture: true };
    assert.deepStrictEqual(RB.planRepo(pointy, [page, assets[0]]).inserts, [], 'a page capture or a text card alone gives no shots');
    assert.deepStrictEqual(RB.repoRuleBreaks([{ repo: true, at: 3, place: 'full' }, { repo: true, at: 5, place: 'frame', src: 'page' }, { repo: true, at: 6, place: 'top', file: 'assets/web/a--b/page.png' }, { at: 7, place: 'full' }, { at: 9, place: 'top' }]).map(x => [x.at, x.why]), [[3, 'the repo full screen'], [5, 'README or page text as a shot'], [6, 'README or page text as a shot'], [7, 'b-roll full screen']], 'the repo full screen, a page or text card (old cuts too), and lane b-roll full screen');
    assert.ok(RB.planRepo(pointy, assets).inserts.every(x => x.src === 'readme'), 'every repo shot says where it came from');
    assert.strictEqual(RB.usable({ url: 'https://opengraph.githubassets.com/1/a/b', alt: '' }), false, "GitHub's text card is never a README picture");
  });
  await t('a card marked once (the proof look at the repo page) is shown one time per reel', () => {
    const L = [3, 7, 11, 15].map(a => ({ start: a, end: a + 4, text: 'It does one more useful thing for you here.', section: 'body' }));
    const p = RB.planRepo(L, [{ path: '/m/proof.mp4', kind: 'video', seconds: 4, heading: 'About', alt: 'demo/tool', once: true }, { path: '/m/term.mp4', kind: 'video', seconds: 4, heading: 'Install', alt: '' }, { path: '/m/feat.mp4', kind: 'video', seconds: 4, heading: '', alt: '' }]);
    assert.strictEqual(p.inserts.filter(x => x.file === '/m/proof.mp4').length, 1, JSON.stringify(p.inserts.map(x => x.file)));
    assert.strictEqual(p.inserts[0].file, '/m/proof.mp4', 'and it comes first');
  });
  await t('a short gap is held over, but never across a punch line that is yours', () => {
    const L2 = [{ start: 3, end: 7, text: 'It reads your notes and makes a draft video.', section: 'body' }, { start: 7.1, end: 8, text: 'Wild!', section: 'body' }, { start: 8.1, end: 12, text: 'And the output keeps every word you said.', section: 'body' }, { start: 12.5, end: 16, text: 'It sorts every file in the folder for you.', section: 'body' }];
    const p = RB.planRepo(L2, assets.slice(1, 2), { minDur: 0.5 });
    assert.ok(p.takeovers.some(x => x.why === 'punch line' && x.at === 7.1));
    assert.ok(p.inserts.every(x => !(x.at < 8 && x.at + x.dur > 7.1)), 'the punch line stays yours: ' + JSON.stringify(p.inserts.map(x => [x.at, x.dur])));
    const second = p.inserts.find(x => x.at === 8.1); assert.ok(second && Math.abs(second.at + second.dur - 12.5) < 0.01, 'the pause before the next line is held over');
  });
  await t('a quick list said in short pieces keeps the card up: the pieces are one line, not punch lines', () => {
    const L3 = [{ start: 3.4, end: 4.4, text: 'Rabbit hole, spotlight,', section: 'body' }, { start: 5.1, end: 6.7, text: 'backdrop board, orbit,', section: 'body' }, { start: 7.4, end: 8, text: 'LED sign,', section: 'body' }, { start: 8.5, end: 9.0, text: 'dot reveal.', section: 'body' }];
    const p = RB.planRepo(L3, assets.slice(1, 3));
    assert.strictEqual(p.takeovers.length, 0, JSON.stringify(p.takeovers));
    assert.ok(p.inserts.length && p.inserts[0].at === 3.4 && Math.abs(p.inserts[p.inserts.length - 1].at + p.inserts[p.inserts.length - 1].dur - 9) < 0.01, JSON.stringify(p.inserts.map(x => [x.at, x.dur])));
  });
  await t('takeovers off: split on the whole body; frame breakout uses the framed cards', () => {
    const off = RB.planRepo(lines, assets, { takeovers: 'off' }); assert.ok(off.inserts.length >= 4 && off.inserts.every(x => x.place === 'top'), JSON.stringify(off.inserts)); assert.strictEqual(off.takeovers.length, 0);
    const fr = RB.planRepo(lines, assets, { breakout: true }); assert.strictEqual(fr.inserts[0].place, 'frame');
    assert.deepStrictEqual(RB.planRepo(lines, []).inserts, []);
  });
  await t('repo style: pictures change every 2 to 4 s, framed cards carry the bands', () => {
    const long = [{ start: 3, end: 11, text: 'It reads your notes and makes a draft video with a longer walkthrough.', section: 'body' }];
    const swapped = RB.planRepo(long, assets, { takeovers: 'off', breakout: true });
    assert.ok(swapped.inserts.length >= 2 && swapped.inserts.every(x => x.place === 'frame' && x.dur <= 4.01 && x.dur >= 2), 'swaps: ' + JSON.stringify(swapped.inserts.map(x => [x.at, x.dur, x.place])));
    assert.ok(new Set(swapped.inserts.map(x => x.file)).size >= 2, 'the pictures change');
    for (let i = 1; i < swapped.inserts.length; i++) assert.notStrictEqual(swapped.inserts[i].file, swapped.inserts[i - 1].file, 'a swap does not repeat the last picture');
    assert.ok(swapped.inserts.every(x => x.bands && x.bands.repo === 0.45 && x.frameBg), 'framed cards carry the default bands and backdrop');
    const one = RB.planRepo(long, assets.slice(1, 2), { takeovers: 'off', breakout: true });
    assert.strictEqual(one.inserts.length, 1, 'one still is not split against itself');
  });
  await t('apply: a drafted job gets repo card inserts from the cached repo (never full screen), you on the hook and CTA; off clears them', async () => {
    const { mkdirSync } = await import('fs'), { execFileSync } = await import('child_process');
    const jobs = join(TMP, 'jobs'), build = join(jobs, 'rj', 'build'), clips = join(TMP, 'clips'); mkdirSync(build, { recursive: true }); mkdirSync(clips, { recursive: true });
    const L = [...lines.slice(0, 4), { start: 14, end: 18, text: 'It sorts every file in the folder for you.' }, { start: 18, end: 20, text: 'It is wild!' }, { start: 20, end: 24, text: 'Follow for more tools like this.' }];
    const words = []; for (const l of L) { const ws = l.text.split(' '), step = (l.end - l.start) / ws.length; ws.forEach((w, i) => words.push([+(l.start + i * step).toFixed(2), +(l.start + (i + 0.8) * step).toFixed(2), w])); }
    writeFileSync(join(clips, 'clips.json'), JSON.stringify({ clips: [{ file: 'take.mp4', words }] }));
    writeFileSync(join(build, 'cut.json'), JSON.stringify({ segs: [{ file: join(clips, 'take.mp4'), in: 0, out: 24 }], inserts: [{ file: 'lane.mp4', at: 18.5, dur: 1, place: 'full', studio: true }] }));
    const plan = join(build, 'video-plan.json'), run = p => { writeFileSync(plan, JSON.stringify(p)); return execFileSync(process.execPath, [join(ROOT, 'kit', 'repo-broll.mjs'), 'apply', '--name', 'rj', '--plan', plan, '--jobs', jobs], { env: { ...process.env, ATH_ASSETS: TMP, ATH_REPO_MOCKS: '0' }, encoding: 'utf8' }); };
    const out = run({ content: { repoFeature: true, repos: ['https://github.com/demo/tool'], takeovers: 'auto' }, presenter: [] });
    const cut = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')), rep = cut.inserts.filter(x => x.repo);
    assert.ok(rep.length && rep.every(x => x.place === 'top'), out + JSON.stringify(rep)); assert.deepStrictEqual(RB.repoRuleBreaks(rep), []);
    assert.ok(rep.every(x => x.at >= 3 && x.at < 20), 'nothing on the hook or the CTA'); assert.ok(rep.every(x => !(x.at < 19.5 && x.at + x.dur > 18.5)), 'the lane keeps its spot');
    const lane = cut.inserts.find(x => x.studio); assert.ok(lane && lane.place === 'top' && lane.fullBefore, 'the lane clip stays, in the card while repo mode is on: ' + JSON.stringify(lane));
    const you = cut.repoTakeovers.filter(x => x.who === 'you').map(x => x.why); assert.ok(you[0] === 'hook' && you.includes('punch line') && you[you.length - 1] === 'cta', you.join());
    assert.ok(rep.every(x => !x.file.startsWith('/')), 'files relative to build, as the lane writes them');
    run({ content: { repoFeature: false, repos: [] } }); const off = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8'));
    assert.ok(!(off.inserts || []).some(x => x.repo) && off.inserts.some(x => x.studio) && !off.repoTakeovers, 'turning it off takes only its own inserts away');
    assert.ok(off.inserts.find(x => x.studio).place === 'full' && !off.inserts.find(x => x.studio).fullBefore, 'and the lane clip goes back to full screen');
    run({ content: { repoFeature: true, repos: ['https://github.com/demo/tool'], takeovers: 'auto' }, presenter: [] }); rmSync(plan);
    execFileSync(process.execPath, [join(ROOT, 'kit', 'repo-broll.mjs'), 'apply', '--name', 'rj', '--plan', plan, '--jobs', jobs], { env: { ...process.env, ATH_ASSETS: TMP, ATH_REPO_MOCKS: '0' }, encoding: 'utf8' });
    const gone = JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')); assert.ok(!(gone.inserts || []).some(x => x.repo) && !gone.repoTakeovers, 'a cleared plan clears its inserts too');
  });
  await t('Edit this reel then Render keeps the repo cards: the reopened cut still has its words', async () => {
    const { mkdirSync, existsSync } = await import('fs'), { execFileSync } = await import('child_process'), { createRequire } = await import('module');
    const SNAP = createRequire(import.meta.url)('../kit/snapshots.cjs');
    const jobs = join(TMP, 'jobs2'), dir = join(jobs, 'rj'), build = join(dir, 'build'), clips = join(dir, 'clips'); mkdirSync(build, { recursive: true }); mkdirSync(clips, { recursive: true });
    const L = [...lines.slice(0, 4), { start: 14, end: 18, text: 'It sorts every file in the folder for you.' }, { start: 20, end: 24, text: 'Follow for more tools like this.' }];
    const words = []; for (const l of L) { const ws = l.text.split(' '), step = (l.end - l.start) / ws.length; ws.forEach((w, i) => words.push([+(l.start + i * step).toFixed(2), +(l.start + (i + 0.8) * step).toFixed(2), w])); }
    writeFileSync(join(clips, 'clips.json'), JSON.stringify({ clips: [{ file: 'clip-001.mp4', words }] })); writeFileSync(join(clips, 'clip-001.mp4'), 'TAKE');
    writeFileSync(join(build, 'cut.json'), JSON.stringify({ segs: [{ file: '../clips/clip-001.mp4', in: 0, out: 24 }] }));
    const plan = join(build, 'video-plan.json'); writeFileSync(plan, JSON.stringify({ content: { repoFeature: true, repos: ['https://github.com/demo/tool'], takeovers: 'auto' }, presenter: [] }));
    const run = () => execFileSync(process.execPath, [join(ROOT, 'kit', 'repo-broll.mjs'), 'apply', '--name', 'rj', '--plan', plan, '--jobs', jobs], { env: { ...process.env, ATH_ASSETS: TMP, ATH_REPO_MOCKS: '0' }, encoding: 'utf8' });
    const reps = () => (JSON.parse(readFileSync(join(build, 'cut.json'), 'utf8')).inserts || []).filter(x => x.repo).length;
    run(); const first = reps(); assert.ok(first > 0, 'v1 has repo cards');
    writeFileSync(join(dir, 'reel-v1.mp4'), 'REEL'); SNAP.save(dir, join(dir, 'reel-v1.mp4'));
    assert.ok(existsSync(join(dir, '.media', 'clips.json')), 'the stashed clip keeps its words');
    SNAP.reopen(dir, 'v1'); writeFileSync(plan, JSON.stringify({ content: { repoFeature: true, repos: ['https://github.com/demo/tool'], takeovers: 'auto' }, presenter: [] }));
    const out = run(); assert.strictEqual(reps(), first, 'the re-render after Edit this reel has the same repo cards: ' + out);
    // an older reopened build with no words for its clips: the cards it has stay, rather than all going
    rmSync(join(dir, '.media', 'clips.json')); const out2 = run();
    assert.strictEqual(reps(), first, out2); assert.ok(/could not read the words/.test(out2));
    // and the repo rule still holds there: an old full-screen repo shot or README text shot goes, a lane clip goes into the card
    const cf = join(build, 'cut.json'), cj = JSON.parse(readFileSync(cf, 'utf8'));
    cj.inserts.push({ repo: true, at: 30, dur: 2, place: 'full', file: 'x.png' }, { repo: true, at: 33, dur: 2, place: 'top', src: 'page', file: 'y.png' }, { studio: true, at: 36, dur: 2, place: 'full', file: 'z.mp4' });
    writeFileSync(cf, JSON.stringify(cj)); const out3 = run(), after = JSON.parse(readFileSync(cf, 'utf8')).inserts;
    assert.strictEqual(after.filter(x => x.repo).length, first, out3); assert.ok(/2 that broke the repo rule/.test(out3), out3);
    assert.deepStrictEqual(RB.repoRuleBreaks(after), []); assert.ok(after.find(x => x.studio).fullBefore);
  });
  await t('a real GIF becomes a 12 second looping MP4 (skipped without FFmpeg)', async () => {
    const { execFileSync } = await import('child_process');
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.log('  (no FFmpeg here: skipped)'); return; }
    const g = join(TMP, 'real.gif'), o = join(TMP, 'real.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=1:r=10', g]);
    RB.gifToMp4(g, o); const secs = RB.videoSeconds(o); assert.ok(secs > 11 && secs < 13, String(secs));
  });
  console.log(`\nrepo broll: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
