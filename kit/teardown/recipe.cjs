// Teardown converter (kit/videomd2reel.cjs): the Reel.md text.
'use strict';
const RM = require('../reelmd.cjs');
const SPL = require('../shotplan.cjs');
const RF = require('../reframe.cjs');
const GM = require('../grade-match.cjs');
const { r2, pad2, clean, hexOK } = require('./util.cjs');
const { themeFor, jobTransition } = require('./palette.cjs');
const { visionPass } = require('./captions.cjs');

// brand names the breakdown read (rea-video packaging.brands or video_context.brands), for a title's role
const colourless = b => [].concat((b.packaging && b.packaging.brands) || [], (b.video_context && b.video_context.brands) || []).map(x => typeof x === 'string' ? x : x && (x.name || x.text)).filter(Boolean);

// The look of the reference's titles as Style lines (read back by kit/reelmd.cjs titleLookOf). The pairing that carries
// the two faces is Brand kit fonts; title-key and title-partner say what was read, for the user.
function titleLookLines(t, font) {
  if (!t) return [];
  const L = [], k = t.key, p = t.partner;
  L.push(`- title-lockup: ${t.lockup}`, `- title-key: ${[k.italic ? 'italic' : null, k.category || 'kind not read'].filter(Boolean).join(' ')}`);
  if (t.lockup === 'two-line') {
    if (k.case) L.push(`- title-key-case: ${k.case}`);
    if (k.color) L.push(`- title-key-color: ${k.color}`);
    L.push(`- title-partner: ${[p.category || 'kind not read', p.place].filter(Boolean).join(' ')}`);
    if (p.case) L.push(`- title-partner-case: ${p.case}`);
    if (p.color) L.push(`- title-partner-color: ${p.color}`);
  }
  L.push(`- title-glow: ${t.glow || 'off'}`, `- title-dim: ${t.dim || 'off'}`);
  if (t.entrance) L.push(`- title-entrance: ${t.entrance}`);
  // one-word captions in the partner face when the words on screen read as the partner's kind, not the key word's
  if (t.pairing && font && p && p.category && font.category === p.category && font.category !== k.category) L.push('- caption-face: partner');
  return L;
}

function recipeMd(c) {
  const { tlook, b, opts, src, name, dur, engine, shots, titles, graphics, extraG, sfx, lines, cs, look, font, colours, bpm, level, hasMusic, bed, jobFinish, layerDefault, zoomShots, jumpCuts, avgShot, big } = c;
  const card = {
    videomd: 1, name,
    description: `Recipe torn down from ${src.file || 'a reference reel'}: ${shots.length} shots in ${dur}s, ${titles.length} big titles, ${cs.style} captions${bpm ? `, music near ${Math.round(bpm)} BPM` : ''}. Measured by ${engine}; finishes, entrances and layers are best guesses.`,
    source: { file: src.file || 'reference.mp4', duration: dur }, shots: shots.length, lang: opts.lang || b.lang || 'en',
    generator: { name: 'aigent-talking-head teardown', version: require('../../package.json').version }, 'x-reel': 1,
  };
  const L = ['---', RM.dumpYaml(card).trimEnd(), '---', '', `# Teardown: ${src.file || name}`, '',
    'Detected from the reference. Read the teardown report next to this file, change anything that looks wrong, then remake:',
    `\`npm run reel -- --recipe ${opts.recipePath || 'teardown/' + name + '/Reel.md'} --clip inbox/your-clip.mp4\``, '',
    '## Brand kit', '- preset: auto', `- theme: ${themeFor(colours)}`, `- colors: ${colours.join(', ') || 'none'}`, `- fonts: ${tlook && tlook.pairing ? tlook.pairing : font ? font.pairing : 'theme'}`, '- logo: none', '',
    '## Music', `- bed: ${!hasMusic ? 'none' : bed ? bed.name : 'auto'}`, ...(hasMusic && bed && level && level.vol ? [`- bed-volume: ${level.vol}`] : []), `- bpm: ${bpm ? Math.round(bpm) : ''}`, `- beat-sync: ${hasMusic ? 'on' : 'off'}`, '',
    '## Style', `- look: ${look}`, `- captions: ${cs.style}`, ...(cs.position ? [`- caption-position: ${cs.position}`] : []), ...(cs.color ? [`- caption-color: ${cs.color}`] : []), ...(cs.outline ? [`- caption-outline: ${cs.outline}`] : []), ...(cs.shadow ? [`- caption-shadow: ${cs.shadow}`] : []), ...(cs.textCase && cs.style === 'one-word' ? [`- caption-case: ${cs.textCase}`] : []), ...(cs.layer ? [`- caption-layer: ${cs.layer}`] : []),
    // the font read from the words on screen, matched to a pairing we ship (kit/fontmatch.py); the pairing itself is Brand kit fonts
    ...(font ? [`- font: ${[font.category, font.weight].filter(Boolean).join(' ')}`, `- font-face: ${font.face}`, `- font-match: ${font.match}`] : tlook && tlook.pairing ? [`- font: ${tlook.key.category}`, '- font-match: close'] : []), `- titles: ${titles.length ? 'on' : 'off'}`, ...titleLookLines(tlook, font), `- title-layer: ${layerDefault}`,
    `- finish: ${jobFinish ? jobFinish.split(',').join(', ') : 'none'}`, `- transition: ${jobTransition(shots)}`, `- glitch: ${shots.some(s => s.tx && s.tx.name === 'glitch') ? 'on' : 'off'}`,
    `- punch: ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'}`, '- effects: none',
    // no model looked at the frames (breakdown.json analysis.vlm): Studio says so with the reference
    ...(visionPass(b) === 'off' ? ['- vision: off'] : []), '',
    '## Shots', '', '```videomd-timeline'];
  for (const s of shots) {
    const f = [`#${pad2(s.n)} ${s.start}-${s.end}`, `story ${s.n === 1 ? 'hook' : s.n === shots.length ? 'payoff' : 'beat'}`];
    if (s.finish && s.finish !== jobFinish) f.push(`finish ${s.finish}`);
    if (big.includes(s.n)) f.push('punch big');
    if (s.tx && s.tx.name && s.n > 1) f.push(`transition ${s.tx.name}`);
    if (s.framing) f.push(`framing ${s.framing}`);
    if (s.cutaway) f.push('cutaway on');
    if (s.cutaway && s.broll) f.push(`broll ${s.broll}`);
    // where the speaker's face sits (height@eye line, kit/reframe.cjs) and the shot's colour in Lab (kit/grade-match.cjs)
    if (s.face) f.push(`face ${RF.fmtFace(s.face)}`);
    if (s.lab) f.push(`lab ${GM.fmtLab(s.lab)}`);
    const mv = (s.moves || []).find(x => SPL.MOVES[x]); if (mv) f.push(`move ${mv}`);
    // how big the reference's move was (the zoom gained, kit/camera_move.py); the draft scales it by the motion strength
    if (mv && s.moveSize) f.push(`move-size ${s.moveSize}`);
    if (s.n > 1 && ((s.moves || []).includes('shake') || (s.tx && s.tx.shake))) f.push('shake on');
    L.push(f.join(' | '));
  }
  L.push('```', '');
  if (titles.length) {
    L.push('## Titles', '', '```reel-titles');
    titles.forEach(t => {
      const f = [`#${pad2(t.n)} ${t.start}-${t.end}`];
      if (t.entrance) f.push(`entrance ${t.entrance}`);
      if (t.lowConfidence) f.push(`check ${String(t.why || 'text').replace(/\s*\|\s*/g, ' ')}`); // text the teardown is not sure of: fix it before a draft
      f.push(`layer ${t.layer || 'front'}`, `role ${SPL.roleOf(t.text, t.start, t.n - 1, colourless(b))}`, `text ${t.text}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  if (graphics.length) {
    L.push('## Graphics', '', 'Detected graphics, drawn as neutral placeholders in the remake. Add `icon <file>` to an app label, and `source <url or file>` to a screen card: a public page (a repo, a site, a tool) is captured to a screenshot and a short scrolling recording with `npm run capture -- --recipe <this file>` once you confirm the URLs, or a file of your own (an image or a screen recording). `subject~` is what the reference showed in that card, `source~` a web address read in it. Paths are relative to this file.', '', '```reel-graphics');
    graphics.forEach((g, i) => {
      const f = [`#${pad2(i + 1)} ${g.start}-${g.end}`, `type ${g.type}`];
      if (g.text) f.push(`${g.guess ? 'text~' : 'text'} ${g.text}`);
      if (g.layer) f.push(`layer ${g.layer}`);
      if (g.lowConfidence) f.push(`check ${String(g.why || 'text').replace(/\s*\|\s*/g, ' ')}`); // a label we are not sure we read right
      if (g.type === 'ordinal-sticker' && g.shape === 'starburst') f.push('shape starburst', `spikes ${g.spikes || 12}`);
      for (const k of ['color', 'tile', 'border']) if (hexOK(g[k])) f.push(`${k} ${g[k].toLowerCase()}`);
      for (const k of ['x', 'y', 'w', 'size']) if (g[k] != null) f.push(`${k} ${g[k]}`);
      if (g.head != null) f.push(`head ${g.head}`, `head-y ${g.headY}`);
      if (g.subject) f.push(`subject~ ${g.subject}`);
      if (g.sourceGuess) f.push(`source~ ${g.sourceGuess}`);
      L.push(f.join(' | '));
    });
    L.push('```', '');
  }
  if (extraG.length) {
    if (!graphics.length) L.push('## Graphics', '', '```reel-graphics');
    const at = graphics.length ? L.lastIndexOf('```') : L.length;
    const gl = extraG.map((g, i) => [`#${pad2(graphics.length + i + 1)} ${g.start}-${g.end}`, `type ${g.type}`, ...Object.entries(g.keys).map(([k, v]) => `${k} ${v}`)].join(' | '));
    L.splice(at, 0, ...gl);
    if (!graphics.length) L.push('```', '');
  }
  if (sfx.length) {
    L.push('## Sound effects', '', 'The reference\'s sound effects and when they play, as the kit\'s sounds. Recreate scales the times to your take.', '', '```reel-sfx');
    sfx.forEach((x, i) => L.push(`#${pad2(i + 1)} ${x.t}-${r2(x.t + Math.max(0.05, Math.min(1, x.dur || 0.2)))} | type ${x.type} | sound ${SPL.sfxId(x.type)}${x.on ? ` | on~ ${x.on}` : ''}`));
    L.push('```', '');
  }
  if (lines.length) {
    L.push('## Script', '', 'What the reference says, for timing and structure. Your remake uses your own words.', '', '```reel-script');
    lines.slice(0, 60).forEach((l, i) => L.push(`#${pad2(i + 1)} ${r2(l.start)}-${r2(l.end)} | say ${clean(l.text)}`));
    L.push('```', '');
  }
  return L.join('\n');
}

module.exports = { recipeMd, colourless };
