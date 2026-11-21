// Teardown converter (kit/videomd2reel.cjs): the teardown.md report.
'use strict';

function report(c) {
  const { tlook, b, extras, src, name, dur, engine, shots, titles, dropped, graphics, scenes, lines, speech, cs, look, colours, bpm, hasMusic, bed, beatEdit, jobFinish, ambient, zoomShots, jumpCuts, avgShot } = c;
  const R = [`# Teardown report: ${src.file || name}`, '', `Engine: ${engine}. ${b.x_engine ? 'rea-video was not available, so this is the lightweight built-in analyzer.' : 'rea-video did the breakdown; this report maps it onto the talking-head menu.'}`, '',
    'Every line below is a measurement or a guess from one. Check the contact sheet, fix the Reel.md, then remake.', '',
    `![contact sheet](contact.jpg)`, '',
    '| What | Detected | How |', '|---|---|---|',
    `| Length, shots | ${dur}s, ${shots.length} shots (avg ${avgShot.toFixed(1)}s) | scene cuts${jumpCuts ? `, ${jumpCuts} jump cuts` : ''} |`,
    `| Captions | ${cs.style} (look ${look}) | ${cs.why} |`,
    `| Caption place | ${cs.position || 'unknown'}${cs.color ? ', ' + cs.color : ''} | median centre of the caption boxes${cs.y != null ? ' (' + Math.round(cs.y * 100) + '% down)' : ''} and their median fill, snapped to white or black when close |`,
    `| Caption layer | ${cs.layer || 'not measured'} | ${cs.layerN ? `${cs.layerBehind} of ${cs.layerN} caption words that overlap the person lose their letters over the person (behind the head)` : 'no caption word overlaps the person, or no person mask'}${cs.layer ? '' : '; top captions default to auto (behind at the top)'} |`,
    `| Caption look | outline ${cs.outline || 'not measured'}, shadow ${cs.shadow || 'not measured'}${cs.textCase ? ', ' + cs.textCase + ' case' : ''} | ${cs.lookN ? `the ring of picture just outside the letters on ${cs.lookN} caption words: a hard dark band is an outline, a milder darkening a shadow` : 'not measured (extras did not run)'}; case from the words read |`,
    ...(c.font ? [`| Font | ${[c.font.category, c.font.weight, c.font.case && c.font.case + ' case', c.font.color].filter(Boolean).join(', ')}; ours: ${c.font.face} (\`${c.font.pairing}\`), ${c.font.match} | ${c.font.samples} big words cut out of the frame and compared, letter by letter, with the same words drawn in the hero face of every pairing in kit/fonts. Matched: the letters sit on ours. Close: the same kind of face. Guess: nothing near, this is the nearest |`] : [`| Font | not read | no big words on screen to read a font from; the theme's own fonts are used |`]),
    `| Titles | ${titles.length} | big on-screen text that is not a running caption or a graphic's word, one at a time, up to 7${dropped.length ? `; ${dropped.length} left out (listed below)` : ''} |`,
    `| Graphics | ${graphics.length ? ['ordinal-sticker', 'app-label', 'screen-card'].map(k => `${graphics.filter(g => g.type === k).length} ${k}`).join(', ') : 'none found'} | ${extras.graphics ? 'frames every 0.25 s: spiky yellow shape + ordinal word, square tile + label, dark rectangle + small UI text' : 'not measured (extras did not run)'} |`,
    `| Title layer | ${titles.length ? titles.map(t => t.layer || '?').join(', ') : 'n/a'} | ${extras.mask ? 'text colour over the person vs over the background (MediaPipe mask)' : 'not estimated (no person mask available); front is the default'} |`,
    `| Finish | ${jobFinish || 'none'} as default; ${shots.filter(s => s.finish && s.finish !== jobFinish).length} shots differ | grade stats per shot, nearest shipped finish; only kept when the grade changes across shots or is strong${ambient.length ? '. ' + ambient.join('; ') : ''} |`,
    `| Music | ${hasMusic ? `${bpm ? Math.round(bpm) + ' BPM' : 'present'}${bed ? `, closest bed ${bed.name} (${Math.round(bed.bpm)} BPM)` : ''}` : 'none found'} | ${beatEdit ? 'cuts land on the beat more than chance' : 'beat grid'} |`,
    `| Punch | ${zoomShots || jumpCuts || avgShot < 3 ? 'on' : 'off'} | ${zoomShots} zoom moves, ${jumpCuts} jump cuts, ${avgShot.toFixed(1)}s average shot |`,
    `| Brand colours | ${colours.join(' ') || 'none'} | saturated text colours first, then the frame palette |`,
    `| Script | ${lines.length ? lines.length + ' lines' : 'not transcribed'} | ${speech.engine || (speech.ok === false ? 'speech: ' + (speech.reason || 'off') : 'rea-video')} |`, ''];
  if (titles.length) {
    const unsure = titles.filter(t => t.lowConfidence);
    if (unsure.length) R.push('## Check these titles', '', `We are not sure we read ${unsure.length === 1 ? 'this title' : 'these ' + unsure.length + ' titles'} right. Fix the text in Reel.md (the \`text\` field of each line under Titles) and take the \`check\` field off, before a draft.`, '', ...unsure.map(t => `- #${t.n} at ${t.start}s: "${t.text}" (${t.why})`), '');
    R.push('## Titles', '', '| # | Time | Text | Sure of the text | Seen as | Entrance | Layer |', '|---|---|---|---|---|---|---|');
    titles.forEach(t => R.push(`| ${t.n} | ${t.start}-${t.end}s | ${t.text} | ${t.lowConfidence ? 'no: ' + t.why : 'yes'} | ${t.seenAs} | ${t.entrance || (tlook && tlook.entrance ? tlook.entrance + ' (not read; the default for an italic serif key word)' : 'engine picks')} | ${t.layer || 'front'}${t.overlap != null ? ` (person under ${Math.round(t.overlap * 100)}% of it)` : ''} |`));
    R.push('');
    if (tlook) { const k = tlook.key, p = tlook.partner;
      R.push('## Title look', '', '| What | Read | From |', '|---|---|---|',
        `| Lockup | ${tlook.lockup === 'two-line' ? 'two lines: a small partner line ' + (p.place || 'with') + ' one big key word' : 'one line'} | ${tlook.n.twoLine} of ${tlook.n.titles} titles read as two lines |`,
        `| Key word | ${[k.italic ? 'italic' : 'upright', k.category || 'kind not read', k.case, k.color].filter(Boolean).join(', ')} | the slant of its strokes, its letters against our faces |`,
        ...(p ? [`| Partner line | ${[p.category || 'kind not read', p.case, p.color].filter(Boolean).join(', ')} | the same, on the small line |`] : []),
        `| Pairing | ${tlook.pairing || 'none of ours has both faces; the font read from the words on screen is used'} | the pairing we ship with those two kinds of face |`,
        `| Glow | ${tlook.glow || 'none'} | the key word's colour in the ring just outside its letters |`,
        `| Picture dim | ${tlook.dim ? Math.round(tlook.dim * 100) + '%' : 'none'} | the picture with the title up against the same shot without it |`, ''); }
  }
  if (dropped.length) {
    R.push('## Left out of the titles', '', '| Time | Text | Why |', '|---|---|---|');
    dropped.forEach(d => R.push(`| ${d.t}s | ${d.text} | ${d.why} |`));
    R.push('');
  }
  if (graphics.length) {
    R.push('## Graphics', '', '| # | Time | Type | Text | Detail |', '|---|---|---|---|---|');
    graphics.forEach((g, i) => R.push(`| ${i + 1} | ${g.start}-${g.end}s | ${g.type} | ${g.text ? g.text + (g.guess ? ' (guessed from its place in the list)' : '') : ''} | ${g.type === 'ordinal-sticker' ? `burst ${g.color || '?'}, ${g.layer}${g.head ? `, ${g.head} head widths wide` : g.size ? `, radius ${g.size} px` : ''}` : g.type === 'app-label' ? `tile ${g.tile || '?'}` : `border ${g.border || 'none found'}, ${g.uiText} UI text cues inside`} |`));
    R.push('', 'Icons and screenshots are not copied. The remake draws a generic glyph or placeholder window until you add your own `icon`, or a `source` for a card.', '');
    const cards = graphics.filter(g => g.type === 'screen-card');
    if (cards.length) {
      R.push('## Screen cards: what was shown', '', 'Propose a public page for each card (the repo or site of the tool named, or the address read in it), confirm the list with the user, then add `source <url>` and run `npm run capture -- --recipe <Reel.md>`. Only public pages are captured.', '',
        '| Time | Shown (read in the card) | Address read | Tool named before it |', '|---|---|---|---|');
      cards.forEach(c => R.push(`| ${c.start}-${c.end}s | ${(c.shown || []).slice(0, 2).map(x => x.slice(0, 50)).join(' / ') || 'nothing legible'} | ${c.sourceGuess || 'none'} | ${c.named || 'none'} |`));
      R.push('');
    }
  }
  R.push('## Shots', '', '| # | Time | Finish | Why |', '|---|---|---|---|');
  shots.forEach(s => R.push(`| ${s.n} | ${s.start}-${s.end}s | ${s.finish || 'none'} | ${s.finishWhy} |`));
  R.push('', '## How sure is this', '', '- Cuts, length, BPM and caption timing are measured and usually right.',
    '- Caption style, entrances and finishes are the nearest match from a short menu. A custom look maps to the closest shipped one.',
    '- Graphics are found from shape and colour plus OCR. A white tile on a white shirt, or an ordinal word OCR cannot read, is missed or guessed (marked ~).',
    '- A finish is only kept when the grade changes across shots or is strong. An even warm or cool cast on every shot is read as the room light.',
    '- Front or behind is a colour test against a person mask. It misses when the text colour matches the clothes or hair.',
    '- OCR misreads stylised or moving type. Check the title text before you remake; your remake should use your own words anyway.', '');
  if (scenes.length) {
    R.push('', '## Made for the menu', '', 'The menu had nothing for these, so they were made as scenes (HTML and CSS, kit/scenes.cjs), added to the Look menu with a REF badge and kept for later jobs.', '', '| Scene | Kind | First seen | Length |', '|---|---|---|---|');
    for (const x of scenes) R.push(`| ${x.name} (${x.id}) | ${x.kind} | ${x.from && x.from.t != null ? x.from.t + ' s' : ''} | ${x.seconds} s |`);
  }
  return R.join('\n');
}

module.exports = { report };
