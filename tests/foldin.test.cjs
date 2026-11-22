// 1.29.0 fold-in: the one title effect table, the look-ahead phrase grouping and the .srt, the measured picture checks
// and the join check. node tests/foldin.test.cjs (in npm run check). The clips are drawn with ffmpeg, a few seconds.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const KIT = path.join(__dirname, '..', 'kit');
const R = require(path.join(KIT, 'rules.cjs'));
const G = require(path.join(KIT, 'phrase-group.cjs'));
const P = require(path.join(KIT, 'picturecheck.cjs'));
const J = require(path.join(KIT, 'joins.cjs'));
const PT = require(path.join(KIT, 'phrase-titles.cjs'));
const SM = require(path.join(KIT, 'sfx-map.cjs'));

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exit(1); } };
const say = (s, t0 = 0, step = 0.3) => s.split(' ').map((w, i) => ({ start: +(t0 + i * step).toFixed(2), end: +(t0 + i * step + step - 0.05).toFixed(2), word: w }));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foldin-'));
const ff = a => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { cwd: tmp });

// ---- the table
t('one table: rules, the recipe reader and the overlay name the same entrances, effects and exits', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(KIT, 'title-effects.json'), 'utf8')).rows, ids = k => rows.filter(r => r.kind === k).map(r => r.id);
  assert.deepStrictEqual(R.ENTRANCES, ids('entrance')); assert.deepStrictEqual(R.TITLE_EFFECTS, ids('effect')); assert.deepStrictEqual(R.TITLE_EXITS, ids('exit'));
  assert.strictEqual(new Set(rows.map(r => r.id)).size, rows.length, 'no name twice');
  const html = fs.readFileSync(path.join(KIT, 'overlay.html'), 'utf8'), lit = re => { const m = re.exec(html); assert.ok(m, String(re)); return m[1]; };
  assert.deepStrictEqual(JSON.parse(lit(/const ENTR=(\[[^\]]*\])/).replace(/'/g, '"')), ids('entrance'), 'overlay ENTR');
  assert.deepStrictEqual(JSON.parse(lit(/const TFX=(\[[^\]]*\])/).replace(/'/g, '"')), ids('effect'), 'overlay TFX');
  const tex = lit(/TEX=\{([^}]*)\}/);
  for (const r of rows.filter(r => r.kind === 'exit')) { const m = new RegExp(`'?${r.id}'?:([0-9.]+)`).exec(tex); assert.ok(m, 'overlay TEX has ' + r.id); assert.strictEqual(+m[1], r.lead, r.id + ': the title leaves over the lead of the picture\'s move'); }
  assert.strictEqual(tex.split(',').length, ids('exit').length);
  assert.deepStrictEqual(require(path.join(KIT, 'reelmd.cjs')).ENTRANCES, R.ENTRANCES, 'the recipe reader has no list of its own');
  for (const r of rows.filter(r => r.kind !== 'entrance')) { assert.ok(Array.isArray(r.needs), r.id + ' says what it needs'); assert.ok(r.needs.length ? r.fallback : r.fallback === null, r.id + ': a fallback exactly when it needs something'); }
  for (const id of R.TITLE_EXITS) { const m = R.TITLE_EXIT_MOVES[id], r = R.titleRow(id); assert.ok(m && m.d === r.dur && m.lead === r.lead && m.sound === r.sound, id); if (r.replaces) assert.ok(r.replaces in R.TRANSITIONS.names, id + ' replaces a named transition'); if (r.sound) assert.ok(require(path.join(KIT, 'sfx-plan.cjs')).lookup(r.sound), id + ' sound is in the pack'); }
});
t('a title exit owns the seam: its row gives the sound there, in place of the transition\'s whoosh', () => {
  const cut = { segs: [{ file: 'a', in: 0, out: 2 }, { file: 'a', in: 2, out: 4, transition: 'whip' }, { file: 'a', in: 4, out: 6, transition: 'whip' }] };
  const caps = { flips: [{ mode: 7, start: 0.5, end: 2, text: 'ONE|Thing', exit: 'polaroid' }] };
  const hits = SM.autoHits(cut, caps.flips, caps), at2 = hits.filter(h => Math.abs(h.t - 2) < 0.5 && /exit|transition/.test(h.why)), at4 = hits.filter(h => h.t === 4);
  assert.strictEqual(at2.length, 1, JSON.stringify(hits)); assert.strictEqual(at2[0].id, R.titleRow('polaroid').sound); assert.ok(/polaroid/.test(at2[0].why));
  assert.strictEqual(at4[0].id, SM.MAP.transition, 'the other seam keeps the transition sound');
  const dip = SM.autoHits(cut, [{ ...caps.flips[0], exit: 'dip-black' }], {});
  assert.ok(!dip.some(h => Math.abs(h.t - 2) < 0.5 && /exit|transition/.test(h.why)), 'dip-black is silent, and the whip it replaced makes no sound');
});
t('an effect whose needs are not met is not drawn, and the log says which and why', () => {
  const words = [...say('This is the only question you need.', 1), ...say('We made it in three long days.', 5)];
  const refs = [{ start: 1, end: 3, text: 'A|B', lines: ['A', 'B'], key: 'B', effect: 'count-up' }, { start: 5, end: 7, text: 'C D', lines: ['C D'], key: 'D', effect: 'stack-fade', exit: 'polaroid' }];
  const m = PT.mapPhrases(refs, words, { len: 9, cuts: [] });
  assert.strictEqual(m.flips.length, 2); assert.ok(m.flips.every(f => !f.effect && !f.exit));
  assert.strictEqual(m.fallbacks.length, 3, JSON.stringify(m.fallbacks));
  assert.ok(m.fallbacks.some(l => /count-up/.test(l) && /number/.test(l)) && m.fallbacks.some(l => /stack-fade/.test(l) && /two lines/.test(l)) && m.fallbacks.some(l => /polaroid/.test(l) && /cut/.test(l)), JSON.stringify(m.fallbacks));
  assert.ok(!PT.mapPhrases([{ start: 1, end: 3, text: 'A|B', lines: ['A', 'B'], effect: 'type' }], words, { len: 9 }).fallbacks.length, 'type needs nothing');
});

t('one Effect and one Exit for the titles: the recipe Style lines and their round trip', () => {
  const RM = require(path.join(KIT, 'reelmd.cjs')), errs = [];
  assert.deepStrictEqual(RM.titleLookOf({ 'title-effect': 'Decode', 'title-exit': 'polaroid' }, errs), { titleEffect: 'decode', titleExit: 'polaroid' }); assert.deepStrictEqual(errs, []);
  RM.titleLookOf({ 'title-effect': 'wobble', 'title-exit': 'vanish' }, errs); assert.strictEqual(errs.length, 2, errs.join(' | '));
  const lines = RM.titleLookLines({ titleEffect: 'type', titleExit: 'dip-black' }); assert.ok(lines.includes('- title-effect: type') && lines.includes('- title-exit: dip-black'), lines.join('|'));
});

t('the vision pass: set apart from move, a title that cannot be read is left out, the instruction states the count', () => {
  const PH = require(path.join(KIT, 'teardown', 'phrases.cjs'));
  const v = PH.validateAgentTitles([{ start: 1, end: 2, set: { lines: ['THE ONLY', 'Question'], key: 'Question', font: 'italic serif', glow: true }, move: { build: 'letter', effect: 'type', exit: 'glitch-slice' } }, { start: 4, end: 5, unread: true }]);
  assert.ok(v.ok, v.errs.join('; ')); assert.strictEqual(v.unread, 1); assert.strictEqual(v.titles.length, 1);
  assert.deepStrictEqual(v.titles[0], { start: 1, end: 2, lines: ['THE ONLY', 'Question'], key: 'Question', font: 'italic serif', effect: 'type', exit: 'glitch-slice', build: 'letter', glow: true });
  const none = PH.validateAgentTitles([{ start: 4, end: 5, unread: true }]); assert.ok(!none.ok && /nothing is kept/.test(none.errs[0]), 'all unread: the OCR read stays');
  assert.ok(!PH.validateAgentTitles([{ start: 1, end: 2, move: { effect: 'wobble' }, set: { lines: ['A'] } }]).ok);
  const shots = [{ start: 0, end: 10 }], a = PH.withAgent([], v.titles, shots)[0];
  assert.ok(a.from === 'agent' && a.state === 'fixed', 'what the agent read is fixed');
});

// ---- phrases and the .srt
t('phrase grouping looks ahead: no stranded last word, never across a pause, forced when nothing fits', () => {
  const g = (w, o) => G.group(w, { maxWords: 7, minWords: 2, ...o }).map(p => p.words.map(w => w.word).join(' '));
  assert.deepStrictEqual(g(say('one two three four five six seven eight')), ['one two three four five six', 'seven eight'], 'greedy would leave "eight" alone');
  assert.deepStrictEqual(g([...say('so here we go', 0), ...say('and then it stopped', 3)]), ['so here we go', 'and then it stopped'], 'a pause is a break');
  assert.deepStrictEqual(g(say('We tried. It worked for us.')), ['We tried.', 'It worked for us.'], 'a sentence end is a break');
  const lone = G.group(say('Why?'), { minWords: 2 }); assert.ok(lone.length === 1 && lone[0].forced, 'no split fits: marked, not stretched');
  assert.strictEqual(lone[0].end, 0.25, 'its own time, none made up');
  const fast = G.group(say('supercalifragilistic expialidocious antidisestablishment', 0, 0.05), { maxCps: 30 }); assert.ok(fast.every(p => p.forced), 'too fast to read is said, not hidden');
  const ps = PT.ourPhrases(say('I spent three hundred and sixty five days building this one thing and nobody cared at all.'));
  assert.ok(ps.every(p => p.words.length >= 2 && p.words.length <= 8), JSON.stringify(ps.map(p => p.words.length)));
});
t('an .srt from captions.js: numbered cues, two lines of about 42 letters, 1 to 7 s, none over the next', () => {
  const W = say('I spent three hundred and sixty five days building this one thing and nobody cared at all. Then one morning it changed.');
  const srt = G.toSrt({ runningCaptions: false, flips: [{ mode: 7, start: 0, end: 2, text: 'A TITLE' }, { mode: 0, start: 0, end: 7, text: 'x', words: W.map(w => [w.start, w.end, w.word]) }] }, 7);
  const cues = srt.trim().split('\n\n').map(c => c.split('\n')); assert.ok(cues.length >= 2, srt);
  const sec = s => { const [h, m, r] = s.split(':'); return +h * 3600 + +m * 60 + +r.replace(',', '.'); };
  cues.forEach((c, i) => { assert.strictEqual(c[0], String(i + 1)); const [a, z] = c[1].split(' --> ').map(sec); assert.ok(z - a >= 0.2 && z - a <= 7.001, c[1]); assert.ok(c.length <= 4 && c.slice(2).every(l => l.length <= 46), c.join('|')); if (cues[i + 1]) assert.ok(z <= sec(cues[i + 1][1].split(' --> ')[0]), 'gone before the next'); });
  assert.ok(!/A TITLE/.test(srt) && /nobody cared/.test(srt.replace(/\n/g, ' ')), 'what is said, not the titles');
  const full = G.toSrt({ flips: [{ mode: 0, start: 1, end: 2, text: 'only this' }] }, 7, [{ start: -0.18, end: 0.25, word: 'Every' }, ...W.slice(1)]);
  assert.ok(/^1\n00:00:00,000 --> /.test(full) && /Every spent/.test(full.replace(/\n/g, ' ')) && !/only this/.test(full), 'the whole transcript when there is one, a word that starts before 0 too');
  assert.strictEqual(G.toSrt({ flips: [] }), ''); assert.strictEqual(G.stamp(3661.5), '01:01:01,500');
});

// ---- picture checks
ff(['-f', 'lavfi', '-i', 'testsrc2=size=270x480:rate=24:duration=3', '-vf', 'tpad=stop_mode=clone:stop_duration=1,tpad=stop_duration=0.5:color=black', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'frozen.mp4']);
t('picture: a frozen stretch and black frames fail, and what the edit does on purpose does not', () => {
  const M = P.measure(path.join(tmp, 'frozen.mp4'), 4.5);
  assert.ok(M.freezes.length && M.blacks.length && M.stats.length > 90, JSON.stringify(M.freezes));
  const bad = P.judge(M, P.exempt({ segs: [{ in: 0, out: 4.5 }], tail: 0 }, { flips: [] }));
  assert.strictEqual(bad.fails.length, 2, JSON.stringify(bad)); assert.ok(/frozen/.test(bad.fails[0]) && /black/.test(bad.fails[1]));
  const card = P.judge(M, P.exempt({ segs: [{ in: 0, out: 4.5 }], tail: 0 }, { flips: [{ mode: 8, start: 3, end: 4.5, text: 'CARD' }] }));
  assert.deepStrictEqual(card.fails, [], 'a card may hold still and be dark');
  const tail = P.judge(M, P.exempt({ segs: [{ in: 0, out: 3 }], tail: 1.5 }, { flips: [] }));
  assert.ok(tail.fails.length === 1 && /black/.test(tail.fails[0]), 'the tail hold is ours, black in it is not');
  const title = P.judge(M, P.exempt({ segs: [{ in: 0, out: 4.5 }], tail: 0 }, { flips: [{ mode: 7, start: 3, end: 4.4, text: 'A TITLE' }] }));
  assert.strictEqual(title.fails.length, 2, 'a title never excuses a frozen picture');
  assert.ok(/did not run/.test(P.judge({ error: 'x' }, {}).notes[0]));
});
t('picture: exemptions come from the cut (fade in, dips, seams, hits, pads, inserts) and the rest are notes', () => {
  const X = P.exempt({ segs: [{ in: 0, out: 2, fadeIn: 0.25 }, { in: 0, out: 2, transition: 'dip' }, { in: 0, out: 1, pad: 0.6 }], hits: [1], inserts: [{ at: 0.5, dur: 0.5 }], tail: 0.3 }, { flips: [{ mode: 7, start: 3, end: 4, text: 'A|B', exit: 'dip-black' }] });
  assert.ok(X.dark.some(([a, z]) => a < 2 && z > 2) && X.still.some(([a, z]) => a <= 4 && z >= 5) && X.noisy.some(([a, z]) => a < 1 && z > 1));
  assert.strictEqual(X.cuts, 4, '2 seams and both ends of the insert');
  assert.strictEqual(+P.uncovered(0, 10, [[2, 4], [3, 6]]).toFixed(3), 6);
  const st = Array.from({ length: 100 }, (_, i) => ({ t: i / 24, yavg: i % 2 ? 100 : 130, ylow: 2, yhigh: 252 }));
  const j = P.judge({ freezes: [], blacks: [], stats: st, blur: 12, cuts: Array(9).fill(1) }, { still: [], dark: [], noisy: [], cuts: 2 });
  assert.deepStrictEqual(j.fails, []); assert.strictEqual(j.notes.length, 4, JSON.stringify(j.notes));
  assert.ok(/flicker/.test(j.notes[0]) && /clipping/.test(j.notes[1]) && /soft/.test(j.notes[2]) && /9 hard cuts seen, the plan has 2/.test(j.notes[3]));
});

// ---- joins
ff(['-f', 'lavfi', '-i', 'smptebars=size=270x480:rate=24:duration=3', '-f', 'lavfi', '-i', 'color=c=0xc04020:size=270x480:rate=24:duration=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'joins.mp4']);
t('joins: an invisible cut is a break, a colour jump a drift, a declared one is neither, and nothing gates', () => {
  const C = { segs: [{ file: 'a', in: 0, out: 1.5 }, { file: 'a', in: 1.5, out: 3 }, { file: 'b', in: 0, out: 1 }], tail: 0 };
  const r = J.check(path.join(tmp, 'joins.mp4'), C, { flips: [] }, { outDir: tmp });
  assert.strictEqual(r.joins.length, 2); assert.deepStrictEqual(r.findings.map(f => f.kind), ['break', 'drift'], JSON.stringify(r.joins));
  assert.ok(r.findings.every(f => f.why && f.stills && fs.existsSync(f.stills)), 'evidence: both stills beside each finding');
  assert.ok(/^[0-9a-f]{12}$/.test(r.hash) && r.notChecked.length >= 3 && JSON.parse(fs.readFileSync(path.join(tmp, 'joins.json'), 'utf8')).hash === r.hash);
  const C2 = { ...C, segs: [C.segs[0], { ...C.segs[1], transition: 'crossfade' }, { ...C.segs[2], finish: 'teal' }] }, r2 = J.check(path.join(tmp, 'joins.mp4'), C2, { flips: [] });
  assert.deepStrictEqual(r2.findings, [], 'a transition and a change of finish are declared'); assert.notStrictEqual(r2.hash, r.hash, 'an edit makes the old result stale');
  assert.ok(!('ok' in r) && !('fails' in r));
});

(async () => {
  // Studio: the picks are one each, sit in a group of their own, become flags, and need titles on
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foldin-studio-')); process.env.STUDIO_DIR = dir;
  const C = await import('file://' + path.join(KIT, 'studio', 'core.mjs').replace(/\\/g, '/'));
  t('Studio: one Effect and one Exit per reel, in their own group, sent as --title-effect and --title-exit', () => {
    const cat = C.catalog(), s = C.defaultState();
    for (const id of R.TITLE_EFFECTS) assert.strictEqual(cat.items['titleEffect:' + id].mode, 'one', id);
    for (const id of R.TITLE_EXITS) assert.strictEqual(cat.items['titleExit:' + id].mode, 'one', id);
    assert.deepStrictEqual(C.applyPatch(s, { picks: { 'titleEffect:type': 'allow', 'titleExit:polaroid': 'allow' } }, cat).errs, []);
    assert.deepStrictEqual(C.applyPatch(s, { picks: { 'titleEffect:decode': 'allow' } }, cat).errs, []);
    const a = C.compose(s).args; assert.strictEqual(a[a.indexOf('--title-effect') + 1], 'decode', 'the second pick replaces the first'); assert.strictEqual(a[a.indexOf('--title-exit') + 1], 'polaroid');
    assert.ok(C.applyPatch(s, { picks: { 'titleExit:polaroid': 'deny' } }, cat).errs.length, 'one of a kind is picked, never forbidden');
    const text = cat.layers.find(l => l.id === 'text'), own = text.groups.find(g => /Title effect and exit/.test(g.label)), rest = text.groups.filter(g => g !== own).flatMap(g => g.items || g.refs || []);
    assert.ok(own, JSON.stringify(text.groups.map(g => g.label))); assert.strictEqual((own.items || own.refs).length, R.TITLE_EFFECTS.length + R.TITLE_EXITS.length);
    assert.ok(!rest.some(x => /^title(Effect|Exit):/.test(typeof x === 'string' ? x : x.ref || x.kind + ':' + x.id)), 'not mixed into the wall of title entrances');
  });
  const SH = await import('file://' + path.join(KIT, 'sheets.mjs').replace(/\\/g, '/'));
  t('the instruction: the exact number of sheets, set and move, unread, a result and not a list of options', () => {
    const ask = SH.titlesInstruction([{ file: '/x/a.jpg', from: 0, to: 2, fps: 6 }, { file: '/x/b.jpg', from: 5, to: 8, fps: 6 }, { file: '/x/c.jpg', from: 9, to: 12, fps: 6 }], { ref: 3 });
    assert.ok(/are exactly 3 sheets/.test(ask) && /How it is set/.test(ask) && /How it moves/.test(ask) && /"unread": true/.test(ask) && /Never guess words/.test(ask) && /do not answer with a list of options/.test(ask), ask);
    assert.ok(/is exactly 1 sheet\b/.test(SH.titlesInstruction([{ file: '/x/a.jpg', from: 0, to: 2, fps: 6 }])));
    assert.ok(!/[\u2013\u2014]/.test(ask) && !/npm run|node kit/.test(ask), 'plain words, no dashes, no command');
  });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${n} fold-in checks passed`);
})();
