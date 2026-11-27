// Repo mode's animated cards (kit/repo-mockups.mjs): the README score that decides the fallback, the facts read from a
// README (the real install and usage commands with their own output lines, the feature list, inputs -> tool -> output),
// which scenes a weak and a good README get, that every scene is a window card with a selection box (never plain text on
// its own), that text is escaped and nothing can run or load, and the cache. With Chrome and FFmpeg, one real render.
// Run: node tests/repo-mockups.test.mjs   (npm run check runs it)
import assert from 'assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

const M = await import('../kit/repo-mockups.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'repo-mock-test-'));
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok ' + name); };
const WEAK = `# Tiny Tool

Tiny Tool turns markdown notes into slide decks.

## Features

- **Live reload** - see each change at once
- **Themes**: light and dark
- **Speaker notes** for every slide
- a very long bullet that is a whole sentence and never a label for a tile

## Install

\`\`\`bash
npm install -g tiny-tool   # the CLI
tiny-tool build notes.md
\`\`\`

\`\`\`text
wrote deck.html (12 slides)
\`\`\`

## Uninstall

\`\`\`bash
npm uninstall -g tiny-tool
\`\`\`

## License

- **MIT**
- **Free**
- **Open**
`;
const facts = { owner: 'demo', repo: 'tiny-tool', description: 'Turns markdown notes into slide decks for talks.', stars: 42, forks: 3, language: 'TypeScript', license: 'MIT', topics: ['slides', 'markdown'], files: ['src/', 'package.json', 'README.md'] };
try {
  await t('the README score: a video 3, a big picture 2, a small one 1; 4 or more is good; text cards and captures never count', () => {
    assert.deepStrictEqual(M.readmeScore({ assets: [] }).good, false);
    assert.strictEqual(M.readmeScore({ assets: [{ kind: 'image', w: 1600, h: 900 }, { kind: 'image', w: 300, h: 300 }] }).score, 3);
    assert.ok(M.readmeScore({ assets: [{ kind: 'video', seconds: 6 }, { kind: 'image', w: 300, h: 300 }] }).good);
    assert.ok(M.readmeScore({ assets: [{ kind: 'image', w: 1600, h: 900 }, { kind: 'image', w: 1200, h: 700 }] }).good);
    assert.ok(!M.readmeScore({ assets: [{ kind: 'image', w: 1600, h: 900, header: true }, { kind: 'image', w: 1600, h: 900, capture: true }, { kind: 'image', w: 1600, h: 900 }] }).good);
  });
  await t('the facts come from the README as written: commands (no comment, not the uninstall), feature labels, inputs -> output', () => {
    const c = M.commands(WEAK);
    assert.deepStrictEqual(c.map(x => x.cmd), ['npm install -g tiny-tool', 'tiny-tool build notes.md'].slice(0, 1).concat(c.length > 1 ? [c[1].cmd] : []));
    assert.ok(!c.some(x => /uninstall/.test(x.cmd)), 'not the uninstall');
    assert.deepStrictEqual(M.features(WEAK), { heading: 'Features', items: ['Live reload', 'Themes', 'Speaker notes'] }, 'a long sentence is left out, never cut');
    assert.deepStrictEqual(M.flow(facts.description), { inputs: ['markdown notes'], output: 'slide decks' });
    assert.strictEqual(M.flow('A harness for long agent sessions.'), null, 'no flow without one said plainly');
    assert.strictEqual(M.features('# X\n\n## License\n\n- **MIT**\n- **Free**\n- **Open**\n'), null, 'never from the license');
    assert.deepStrictEqual(c[0].after, [], 'a plain block has no output: its other lines may be commands');
    const sess = M.commands('## Usage\n\n```console\n$ tiny build notes.md\n$ npx tiny build notes.md\nwrote deck.html (12 slides)\n```\n\n## Run\n\n```bash\ndocker run -d \\\n  -p 80:80 tiny\n```\n');
    assert.deepStrictEqual(sess.map(x => [x.cmd, x.after]), [['npx tiny build notes.md', ['wrote deck.html (12 slides)']]], 'a session block: the lines without $ are its output; a command that runs on with a backslash is left out');
    assert.strictEqual(M.flow('A CLI: a fast way to deploy.'), null); assert.strictEqual(M.flow('Everything from setup to deployment.'), null);
  });
  await t('which scenes: a weak README gets every scene that fits, a good one the proof card and the terminal; the proof card is once', () => {
    const weak = M.scenesFor(facts, WEAK, { assets: [] });
    assert.deepStrictEqual(weak.scenes.map(s => s.id), ['proof', 'terminal', 'features', 'flow', 'stars']);
    assert.deepStrictEqual(M.scenesFor({ ...facts, topics: ['slides', 'markdown', 'cli-tool'] }, WEAK, { assets: [] }).scenes.map(s => s.id), ['proof', 'terminal', 'features', 'topics', 'flow', 'stars'], 'three topics or more make a grid');
    assert.ok(weak.scenes[0].once && !weak.scenes.slice(1).some(s => s.once));
    const good = M.scenesFor(facts, WEAK, { assets: [{ kind: 'video', seconds: 5 }, { kind: 'image', w: 1600, h: 900 }] });
    assert.deepStrictEqual(good.scenes.map(s => s.id), ['proof', 'terminal']);
    const few = M.scenesFor({ ...facts, stars: 2, description: 'A paper.' }, '# P\n', { assets: [] });
    assert.deepStrictEqual(few.scenes.map(s => s.id), ['proof', 'terminal'], 'no star count under 10, no made-up features or flow');
    assert.strictEqual(few.scenes[1].cmds[0].cmd, 'git clone https://github.com/demo/tiny-tool', 'with no command in the README, the real clone');
    assert.deepStrictEqual(M.scenesFor({ ...facts, description: '' }, WEAK, { assets: [] }).scenes.map(s => s.id)[0], 'terminal', 'no About, no proof card (never a blank box)');
  });
  await t('every scene is a window card with a selection box and a cursor, types the real command, escapes text, and cannot run or load anything', () => {
    const evil = { ...facts, repo: 'x<script>alert(1)</script>', description: 'Turns <img src=x onerror=alert(1)> into "pwn".' };
    const { scenes } = M.scenesFor(facts, WEAK, { assets: [] });
    for (const s of [...scenes, { id: 'shot', img: 'data:image/png;base64,AAAA', title: 'Live preview' }]) {
      for (const f of [facts, evil]) {
        const h = M.sceneHtml(s, f);
        assert.ok(/class="win"/.test(h) && /class="sel"/.test(h) && /class="cur"/.test(h), s.id + ': a window card, a selection box and a cursor');
        const tags = (h.match(/<[^>]+>/g) || []).join('\n');
        assert.ok(!/<script/i.test(h) && !/\son\w+\s*=/i.test(tags), s.id + ': no scripts or handlers');
        assert.ok(!/(src|href)="(?!data:)/i.test(h) && !/url\((?!data:)/i.test(h), s.id + ': nothing to load');
      }
    }
    const term = M.sceneHtml(scenes[1], facts).replace(/<[^>]+>/g, '');
    assert.ok(term.includes('npm install -g tiny-tool') && !term.includes('# the CLI'), 'the README command, typed out: ' + term);
    const clone = M.sceneHtml({ id: 'terminal', cmds: [{ cmd: 'git clone https://github.com/demo/tiny-tool', after: [] }] }, facts).replace(/<[^>]+>/g, '');
    assert.ok(clone.includes('Cloning into &#39;tiny-tool&#39;...') && clone.includes('package.json'), 'a clone lists the real top-level files');
    const many = M.sceneHtml({ id: 'terminal', cmds: [{ cmd: 'git clone https://github.com/demo/tiny-tool', after: [] }] }, { ...facts, files: Array.from({ length: 13 }, (_, i) => `f${i}.md`) });
    assert.ok(!/f0\.md/.test(many), 'more than 12 files: no ls at all, so a list never looks complete when it is not');
  });
  await t('card assets: rendered once per folder and look, then read from the cache; README pictures in window cards, videos as they are', async () => {
    const dir = join(TMP, 'demo--tiny-tool'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'readme.md'), WEAK);
    writeFileSync(join(dir, '01.mp4'), 'v');
    const meta = { owner: 'demo', repo: 'tiny-tool', header: { description: facts.description, stars: 42 }, facts, assets: [{ file: '01.mp4', kind: 'video', seconds: 6, heading: 'Demo', alt: '' }] };
    let calls = 0; const render = async ps => { calls++; for (const p of ps) writeFileSync(p.out, 'mp4'); return ps.map(p => p.out); };
    const a = await M.cardAssets(meta, dir, { render });
    assert.deepStrictEqual(a.assets.map(x => x.mock || 'video'), ['proof', 'terminal', 'features', 'flow', 'stars', 'video'], 'one video is not enough: the cards lead');
    assert.ok(a.assets.every(x => existsSync(join(dir, x.file))) && a.assets[0].once);
    await M.cardAssets(meta, dir, { render }); assert.strictEqual(calls, 1, 'cached');
    await M.cardAssets({ ...meta, header: { ...meta.header, stars: 43 } }, dir, { render }); assert.strictEqual(calls, 2, 'new facts, new cards');
    assert.ok(a.assets.every(x => existsSync(join(dir, x.file))), 'the older look stays for a cut that still points at it');
  });
  await t('one real card: a 4 s 1200x960 MP4 (skipped without Chrome or FFmpeg)', async () => {
    try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); (await import('../kit/chrome.mjs')).findChrome(); } catch { console.log('  (no Chrome or FFmpeg here: skipped)'); return; }
    const out = join(TMP, 'proof.mp4');
    await M.renderPages([{ html: M.sceneHtml({ id: 'proof' }, facts), out }], { seconds: 1, fps: 12 });
    const p = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out], { encoding: 'utf8' }).trim();
    assert.strictEqual(p.replace(/,$/, ''), '1200,960');
  });
  console.log(`\nrepo mockups: ${n} tests passed`);
} finally { rmSync(TMP, { recursive: true, force: true }); }
