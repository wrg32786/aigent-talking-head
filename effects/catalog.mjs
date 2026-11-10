// Render effects/CATALOG.md from effects/catalog.json (the JSON is the source of truth).   npm run effects:catalog
import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const HERE = dirname(fileURLToPath(import.meta.url));
import { createRequire } from 'module';
const KITR = createRequire(import.meta.url)('../kit/rules.cjs');
const PAIRS = JSON.parse(readFileSync(join(HERE, '..', 'kit', 'fonts', 'pairings.json'), 'utf8')).pairings;
const esc = s => String(s).replace(/\|/g, '\\|');
export function renderCatalog(cat) {
  const L = [];
  const E = cat.effects;
  L.push('# Effects catalog', '', `${E.length} starter effects from [claude-video-effects](${cat.source.repo}) by ${cat.source.author} (${cat.source.license}), applied as an optional second pass over a finished reel. Generated from \`catalog.json\` by \`npm run effects:catalog\`; edit the JSON, not this file.`, '');
  // one list of everything the agent can offer, so it can tell the user what exists
  const MODES = ['0 caption (styled by captionStyle)', '1 spray hero word with drips', '2 sticker', '3 count-up', '4 takeover card', '5 logo plate', '6 CTA sticker', '7 kinetic title (behind the person when masked)'];
  const STYLES = ['kinetic (default: every word animates in, one emphasis word big in the display font, optional script accent)', 'classic (the original rise-in caption)', 'pill (3-5 words in a dark rounded pill, lower third)', 'hormozi (heavy caps, thick outline, spoken word highlighted)', 'karaoke (left-to-right colour wipe per word)'];
  const TN = Object.entries(KITR.TRANSITIONS.names);
  const PN = Object.entries(PAIRS).filter(([, v]) => v).map(([k, v]) => `\`${k}\` (${[v.display, v.secondary, v.script].filter(Boolean).map(r => r.family).join(' + ')})`);
  const SND = Object.entries(KITR.SFX).filter(([k]) => !/^[FD]$/.test(k));
  const total = E.length + MODES.length + STYLES.length + KITR.ENTRANCES.length + TN.length + SND.length + PN.length;
  L.push('## Everything available', '', `${total} things to offer, in one list. Tell the user what fits their moment, not the whole list.`, '',
    `- **${E.length} video effects** (this catalog, \`npm run fx\`): ${E.map(e => '`' + e.name + '`').join(', ')}.`,
    `- **${MODES.length} overlay modes** (\`captions.js\` flips, \`mode\`): ${MODES.join('; ')}.`,
    `- **${STYLES.length} caption styles** (\`captionStyle\`, or \`style\` per flip): ${STYLES.join('; ')}.`,
    `- **${KITR.ENTRANCES.length} kinetic title entrances** (mode 7 \`entrance\`, each once per video; flicker on the hook and payoff only): ${KITR.ENTRANCES.map(x => '`' + x + '`').join(', ')}.`,
    `- **${TN.length} named transitions** (\`cut.json\` per segment \`transition\`; default \`glitch\` seam; any of ffmpeg's 58 xfade modes also works): ${TN.map(([k, v]) => '`' + k + '`' + (v ? '' : ' (seam)')).join(', ')}.`,
    `- **${SND.length} sounds**, the locked set (\`cut.json\` \`sfx\`; fewer and deeper): ${SND.map(([k, v]) => `\`${k}\` ${v.use}`).join('; ')}.`,
    `- **${PN.length} font pairings** (\`--fonts\`, plus \`theme\` and your own licensed fonts in kit/fonts/local/): ${PN.join(', ')}.`,
    '- **Camera**: zoom punch on every cut (`punch`), big punch (`bigPunch`, +12% over 0.3 s) on the cut after the hook and into the payoff.', '');
  L.push('**How to read it**', '', '- **Moments**: where in the script it fits. ' + Object.entries(cat.moments).map(([k, v]) => `\`${k}\` ${v}`).join(' '), `- **Energy**: ${Object.entries(cat.energy).map(([k, v]) => `\`${k}\` (${v})`).join(', ')}.`, '- **Needs**: `face` = placed relative to the face (needs a face in frame), `segmentation` = hides behind you, `word-cue` = should land on a spoken word, `text` / `numbers` / `images` = you supply copy, real numbers or a folder of pictures.', '- **Captions**: `safe` = keep captions on; `check` = the caption track moves up to `altY` (default 330) for that window, read a check frame (`--still`); `off` = captions and kinetic titles are hidden for that window automatically (add `"captions": "on"` to the plan entry to keep them).', '- **Required** options must be in the plan (see "Needs your copy"); upstream defaults never show. `name`/`handle` come from the plan\'s `profile`.', '');
  L.push('**Pacing rules**: 3 to 6 effects per reel, a hook effect in the first 2 s, a CTA effect at the end, and no more than one `high` effect every 5 s. Camera effects (marked 🎥) go first in the plan when windows overlap.', '');
  L.push('## By moment', '');
  for (const m of Object.keys(cat.moments)) {
    const pick = en => E.filter(e => e.moments.includes(m) && e.energy === en).map(e => `\`${e.name}\``).join(', ') || '-';
    L.push(`- **${m}** (${cat.moments[m]}) calm: ${pick('calm')} · medium: ${pick('medium')} · high: ${pick('high')}`);
  }
  L.push('', '## Needs your copy', '', 'These effects ship with the upstream author\'s brand names, handle or demo stats as defaults. `npm run fx` refuses a plan that leaves the copy below unset (`--allow-demo-copy` fills neutral `[placeholders]` for a quick look, never the upstream text). Profile fields come from the plan\'s `"profile": {"name", "handle"}`. Optional fields marked *auto* get neutral values (today\'s date, the job name, your profile) when you leave them out.', '', '| Effect | You must set | From profile | Auto (neutral) | Upstream default it replaces |', '|---|---|---|---|---|');
  for (const e of E.filter(e => e.upstreamDefaults || e.required.length || e.requiredIf)) {
    const cond = Object.entries(e.requiredIf || {}).flatMap(([k, m]) => Object.entries(m).map(([v, ks]) => `${ks.join(', ')} (when ${k}=${v})`));
    L.push(`| \`${e.name}\` | ${esc([...e.required, ...cond].join(', ') || '-')} | ${(e.fromProfile || []).map(k => k === 'text' ? 'handle (as text)' : k).join(', ') || '-'} | ${esc(Object.keys(e.neutral || {}).join(', ') || '-')} | ${esc(Object.entries(e.upstreamDefaults || {}).map(([k, v]) => `${k}: ${v}`).join('; ') || '-')} |`);
  }
  L.push('', '## Effects menu presets', '');
  for (const p of cat.presets) L.push(`- **${p.name}** (${p.for}; ${p.pace}): ` + p.picks.map(k => `${k.moment} → ${k.fx.map(f => '`' + f + '`').join(' or ')}`).join(', '));
  L.push('', '## All effects', '', '| # | Effect | What it does | Moments | Energy | Needs | Duration | Captions | Pairs well with | Avoid with |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const e of E) L.push(`| ${e.n} | \`${e.name}\`${e.camera ? ' 🎥' : ''} | ${esc(e.does)} | ${e.moments.join(', ')} | ${e.energy} | ${e.needs.join(', ') || 'nothing (no face needed)'} | ${e.duration[0]}-${e.duration[1]} s | **${e.captions}**: ${esc(e.captionNote)} | ${esc(e.pairsWith.join(', '))} | ${esc(e.avoidWith.join(', '))} |`);
  L.push('', '## Options', '', 'Pass options as keys on the plan entry (`{"fx": "backdrop-word", "start": 3.2, "end": 5, "text": "FREE"}`). Required ones are in bold.', '');
  for (const e of E) { const o = Object.entries(e.options); L.push(`- \`${e.name}\`: ${o.length ? o.map(([k, v]) => (e.required.includes(k) ? `**${k}**` : k) + ` (${v})`).join(', ') : 'no options'}`); }
  return L.join('\n') + '\n';
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const cat = JSON.parse(readFileSync(join(HERE, 'catalog.json'), 'utf8'));
  writeFileSync(join(HERE, 'CATALOG.md'), renderCatalog(cat));
  console.log('wrote effects/CATALOG.md');
}
