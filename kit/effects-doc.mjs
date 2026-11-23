// Writes docs/effects.md, the browsable effects menu, from the same catalogs as npm run menu, so every name in it is a
// name the kit accepts. Previews are the animated WebPs under docs/menu/ from npm run menu:render.
//   node kit/effects-doc.mjs        (npm run menu:render -- --docs-only does the same)
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadMenu } from './menu.mjs';

const KIT = dirname(fileURLToPath(import.meta.url)), ROOT = dirname(KIT);
const DOC = join(ROOT, 'docs', 'effects.md');
const code = s => '`' + String(s).replace(/\|/g, '\\|') + '`';
const cell = s => String(s).replace(/\|/g, '\\|');
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const img = (rel, alt, w = 120) => existsSync(join(ROOT, 'docs', rel)) ? `<img src="${rel}" width="${w}" alt="${alt}">` : '';

export function effectsDoc(menu = loadMenu()) {
  const sec = id => menu.sections.find(s => s.id === id);
  const trans = JSON.parse(readFileSync(join(KIT, 'transitions.json'), 'utf8'));
  const T = sec('transitions').items, TE = sec('title-entrances').items, TX = sec('title-effects').items, CE = sec('caption-entrances').items;
  const CS = sec('caption-styles').items, G = sec('graphics').items, E = sec('effects').items, ED = sec('editing').items;
  // aliases: names that map to the same engine mode as an earlier name
  const firstOf = {};
  for (const it of T) { const k = JSON.stringify(trans.names[it.id]); if (trans.names[it.id] != null && !(k in firstOf)) firstOf[k] = it.id; }
  const sameAs = it => { const f = firstOf[JSON.stringify(trans.names[it.id])]; return f && f !== it.id ? ` Same as ${code(f)}.` : ''; };
  const L = [];
  L.push('# Effects menu', '');
  L.push('Every transition, title entrance, caption entrance and caption style in aigent-talking-head, with a looping preview rendered by the kit itself, the exact name to use, and where to put it. Graphics and video effects are listed at the end.', '');
  L.push(`**${T.length} transitions · ${TE.length} title entrances · ${TX.length} title effects and exits · ${CE.length} caption entrances · ${CS.length} caption styles · ${G.length} graphics · ${E.length} effects**`, '');
  L.push('Jump to: [Transitions](#transitions) · [Title entrances](#title-entrances) · [Title effects and exits](#title-effects-and-exits) · [Caption entrances](#caption-entrances) · [Caption styles](#caption-styles) · [Graphics](#graphics) · [Effects](#effects) · [Editing principles](#editing-principles) · [For agents](#for-agents)', '');
  L.push('## How to pick', '');
  L.push('- Browse the previews below. Each one loops: the effect plays, holds for a moment, then starts again. The name is burned into the bottom of every preview.');
  L.push('- Copy the name into your `cut.json`, `captions.js`, Reel.md or command line, as shown in the **Use** column.');
  L.push('- From a terminal: `npm run list -- transitions` (or `titles`, `captions`, `graphics`, `effects`) prints the same names with a one-line description (`editing` lists the editing principles). Add `--json` for machine-readable output.');
  L.push('- Previews use an AI-generated fictional presenter made for this project (`showcase/source/presenter.jpg`) and a plain gradient plate. Rebuild them with `npm run menu:render`.');
  L.push('- Want a whole look, or to stop the kit picking for you? [Style packs](packs.md) bundle a set of these with locks (`--pack magazine`, `--lock "transitions=whip,zoom; titles=typewriter"`), and every draft writes `choices.json` listing what was picked per beat and why, for you to edit.', '');

  L.push('## Transitions', '');
  L.push(`${T.length} named cuts between segments. The default is \`glitch\`, a hard cut with a quick shake on the seam. Set one per segment in \`cut.json\` (\`"transition": "crossfade"\`, optional \`"transitionDur"\` in seconds, default 0.3), at the top level of \`cut.json\` for every cut, or in a Reel.md (\`- transition: crossfade\` under Style, or \`| transition crossfade\` on a shot line). Any raw ffmpeg xfade mode name also works.`, '');
  L.push('<img src="menu/sheets/transitions.webp" width="720" alt="Animated grid of all transitions, each labelled with its name">', '');
  L.push('| Preview | Name | What it does | Use |', '|---|---|---|---|');
  for (const it of T) L.push(`| ${img(`menu/transitions/${it.id}.webp`, `${it.id} transition`)} | ${code(it.id)} | ${cell(cap((trans.about || {})[it.id] || it.label))}.${sameAs(it)} | ${code(`"transition": "${it.id}"`)}<br>Reel.md ${code(`transition ${it.id}`)} |`);
  L.push('');

  L.push('## Title entrances', '');
  L.push(`${TE.length} ways a kinetic title (a mode 7 flip) comes in. Use each one at most once per video. In \`captions.js\` set \`"entrance"\` on the title; in a Reel.md put \`entrance <name>\` on a line of the \`reel-titles\` block. Titles sit in front of the presenter by default; \`"layer": "behind"\` tucks the hero word behind the head.`, '');
  L.push('<img src="menu/sheets/titles.webp" width="720" alt="Animated grid of the title entrances, each labelled with its name">', '');
  L.push('| Preview | Name | What it does | Use |', '|---|---|---|---|');
  for (const it of TE) L.push(`| ${img(`menu/titles/${it.id}.webp`, `${it.id} title entrance`, 160)} | ${code(it.id)} | ${cell(cap(it.label))}. | ${code(`{ "mode": 7, "text": "Record one take", "entrance": "${it.id}" }`)}<br>Reel.md ${code(`#01 0.3-1.8 | entrance ${it.id} | text Record one take`)} |`);
  L.push('');

  L.push('## Title effects and exits', '');
  L.push('A title can be set as a designed phrase: one to three lines split by `|`, small partner words in the text colour and one larger key word (`"key"`) in the accent. Add `"phrase": true` to draw the lines as written. `"words": [[start, end, word], ...]` times each word, and a word is never drawn before its start. With no effect the words come in as you say them (`"build": "word"`), typed (`"letter"`) or a line at a time (`"line"`).', '');
  L.push('An effect is how the title arrives, one per title: `"effect"` on the title, or `"titleEffect"` in `captions.js` for every title that names none. An exit is how it leaves, over its last 0.2 to 0.45 s: `"exit"` on the title, or `"titleExit"` for the job. When the title ends within 0.2 s of a cut, the exit is the transition at that cut: the picture makes the same move, in place of the segment\'s own transition, and the build log says so. The previews show the title only. `"glow": "soft"` or `"strong"` and `"dim": 0.4` work on one title, also when the job has `titleGlow` and `titleDim` off.', '');
  L.push('For the whole reel: `--title-effect <name>` and `--title-exit <name>`, or `- title-effect:` and `- title-exit:` under Style in a Reel.md. In Studio they are one Effect and one Exit pick on Text and graphics. Some effects need something from the title: `slot-roll` a number in the key word or a `"swap"` list, `count-up` a number, `stack-fade` two lines or more, and `polaroid`, `glitch-slice` and `dip-black` a cut where the title ends. When a draft from a reference cannot give an effect what it needs, the title comes in by its plain build (an exit just ends) and the build log says which effect was not drawn and why. The table behind this is `kit/title-effects.json`.', '');
  L.push('<img src="menu/sheets/title-effects.webp" width="720" alt="Animated grid of the title effects and exits, each labelled with its name">', '');
  L.push('| Preview | Name | What it does | Use |', '|---|---|---|---|');
  const TXU = { 'slot-roll': '{ "mode": 7, "text": "$3.9M\\|WAS THE LOWEST", "key": "$3.9M", "effect": "slot-roll" }<br>{ "mode": 7, "text": "I DON\'T KNOW\\|How to pitch", "key": "How to pitch", "swap": ["pitch", "market", "do sales"] }', 'count-up': '{ "mode": 7, "text": "THAT\'D KEEP ME GOING FOR\\|365 Days", "key": "365 Days", "count": { "from": 1, "to": 365, "unit": "Days", "final": "1 Year" } }' };
  for (const it of TX) { const exit = it.kind === 'titleExit', use = TXU[it.id] || `{ "mode": 7, "text": "THE ONLY\\|Question\\|YOU NEED", "phrase": true, "key": "Question", "${exit ? 'exit' : 'effect'}": "${it.id}" }`;
    L.push(`| ${img(`menu/title-effects/${it.id}.webp`, `${it.id} title ${exit ? 'exit' : 'effect'}`, 160)} | ${code(it.id)} | ${cell(cap(it.label))}. | ${use.split('<br>').map(u => '`' + u + '`').join('<br>')} |`); }
  L.push('');

  L.push('## Caption entrances', '');
  L.push(`${CE.length} ways the big hero word of a kinetic caption comes in, most of them letter by letter. Set one for the whole reel with \`--caption-entrance <name>\`, \`"captionEntrance": "<name>"\` in \`captions.js\`, or \`- caption-entrance: <name>\` under Style in a Reel.md. A caption flip's own \`"entrance"\` wins. They apply to the \`kinetic\` caption style (the default look).`, '');
  L.push('<img src="menu/sheets/caption-entrances.webp" width="720" alt="Animated grid of the caption entrances, each labelled with its name">', '');
  L.push('| Preview | Name | What it does | Use |', '|---|---|---|---|');
  for (const it of CE) L.push(`| ${img(`menu/caption-entrances/${it.id}.webp`, `${it.id} caption entrance`, 160)} | ${code(it.id)} | ${cell(cap(it.label))}. | ${code(`--caption-entrance ${it.id}`)}<br>${code(`"captionEntrance": "${it.id}"`)} |`);
  L.push('');

  L.push('## Caption styles', '');
  L.push(`${CS.length} kinetic caption styles. A look (\`--look\`) picks one for you; override it with \`--style <name>\`, \`"captionStyle": "<name>"\` in \`captions.js\`, or \`- captions: <name>\` under Style in a Reel.md.`, '');
  L.push('<img src="menu/sheets/caption-styles.webp" width="720" alt="Animated grid of the caption styles, each labelled with its name">', '');
  L.push('| Preview | Name | What it does | Use |', '|---|---|---|---|');
  for (const it of CS) L.push(`| ${img(`menu/caption-styles/${it.id}.webp`, `${it.id} caption style`, 160)} | ${code(it.id)} | ${cell(cap(it.label))}. | ${code(`--style ${it.id}`)}<br>${code(`"captionStyle": "${it.id}"`)} |`);
  L.push('');

  L.push('## Graphics', '');
  L.push(`${G.length} overlay graphics drawn in the theme colours and fonts, each with its own entrance. Add one as a flip in \`captions.js\` with its \`"mode"\`, or as a line in a Reel.md \`reel-graphics\` block with \`type <name>\`. Words on a graphic must be words you say. Field details are in [reel-md.md](reel-md.md) and [contract.json](../contract.json); stills of every one are in the [gallery](../showcase/GALLERY.md#graphics).`, '');
  L.push('![Contact sheet of the overlay graphics](../showcase/sheets/graphics.jpg)', '');
  L.push('| Name | Mode | Entrance | What it is | Use |', '|---|---|---|---|---|');
  for (const it of G) L.push(`| ${code(it.id)} | ${it.mode} | ${code(it.entrance)} | ${cell(it.label)} | ${code(`"mode": ${it.mode}`)}<br>Reel.md ${code(`type ${it.id}`)} |`);
  L.push('');

  L.push('## Effects', '');
  L.push(`${E.length} optional second-pass video effects, applied with \`npm run fx\`. Pick them by the moment in your script. The full catalog with options, energy and pairings is [effects/CATALOG.md](../effects/CATALOG.md); stills are in the [gallery](../showcase/GALLERY.md#effects).`, '');
  L.push('![Contact sheet of the video effects](../showcase/sheets/effects.jpg)', '');
  L.push('| Name | Moments | What it does | Use |', '|---|---|---|---|');
  for (const it of E) L.push(`| ${code(it.id)} | ${it.moments.join(', ')} | ${cell(it.label)} | ${code(`"fx": "${it.id}"`)} |`);
  L.push('');

  L.push('## Editing principles', '');
  L.push(`Common short-form editing advice, built into the engine. Each one works on its own; \`--preset magazine\` (or \`- preset: magazine\` under Brand kit in a Reel.md) turns them all on, and [examples/recipes/magazine.Reel.md](../examples/recipes/magazine.Reel.md) shows every line. Why each one helps, in plain words: [guide.md](guide.md#editing-principles-built-in). The \`typewriter\` entrances are in the tables above and \`number-pop\` is in Graphics.`, '');
  L.push('| Name | What it does | Use |', '|---|---|---|');
  for (const it of ED) L.push(`| ${code(it.id)} | ${cell(cap(it.label))}. | ${code(it.flag)} |`);
  L.push('');

  L.push('## For agents', '');
  L.push('- `npm run list -- <kind> --json` returns `{ kind, sections: [{ id, title, hint, items: [{ id, flag, label, preview }] }] }`. Kinds: `transitions`, `titles`, `captions` (caption entrances and caption styles), `graphics`, `effects`, `editing`, or any section id from `npm run menu`.');
  L.push('- The MCP server (`npm run mcp`) has a `list_effects` tool with the same kinds, and the `menu` tool for every option.');
  L.push('- `npm run check` fails if a name in the kit is missing from this page, so the menu cannot fall behind the code.', '');
  return L.join('\n');
}

export function writeEffectsDoc(menu) { writeFileSync(DOC, effectsDoc(menu)); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) writeEffectsDoc();
