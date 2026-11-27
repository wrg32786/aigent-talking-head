// Layers of a finished teardown: existing measurements only, six plates, honest empty lines.
// Run: node tests/studio-teardown-layers.test.mjs   (npm run check runs it too)
import { strict as assert } from 'assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { extract } from '../kit/studio/reference.mjs';
import { layersView, LAYER_IDS } from '../kit/studio/teardown-layers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'td-layers-'));
const write = (name, md) => { const f = join(dir, name); writeFileSync(f, md); return f; };

const rich = write('rich.Reel.md', ['---', 'videomd: 1', 'name: ref4', 'description: a 4-shot reference', 'source:', '  file: ref.mp4', '  duration: 12', 'shots: 4', 'lang: en', 'x-reel: 1', '---', '', '# ref4', '',
  '## Brand kit', '- preset: auto', '- theme: neutral', '- colors: #101010, #FF5A1F, #f0f0f0', '- fonts: theme', '- logo: none', '',
  '## Style', '- look: boxed', '- captions: boxed', '- caption-position: bottom', '- caption-color: #f0f0f0', '- title-layer: behind', '- punch: on', '- transition: flash', '',
  '## Shots', '', '```videomd-timeline',
  '#01 0-3 | framing close-up | face 0.17@0.33',
  '#02 3-6 | framing medium shot | transition flash | face 0.17@0.33 | move push',
  '#03 6-9 | framing close-up | cutaway on',
  '#04 9-12 | framing medium shot | face 0.17@0.33 | shake on', '```', '',
  '## Titles', '', '```reel-titles',
  '#01 0.4-2.2 | entrance blur-rise | layer behind | text Hello', '```', '',
  '## B-roll', '', '```reel-broll',
  '#01 6-9 | kind full | layer front', '```', ''].join('\n'));

const bare = write('bare.Reel.md', ['---', 'videomd: 1', 'name: bare', 'description: almost empty', 'source:', '  file: ref.mp4', '  duration: 6', 'shots: 2', 'lang: en', 'x-reel: 1', '---', '', '# bare', '',
  '## Style', '- titles: off', '- finish: none', '- punch: off', '',
  '## Shots', '', '```videomd-timeline',
  '#01 0-3 | story hook',
  '#02 3-6 | story then', '```', ''].join('\n'));

const by = (layers, id) => layers.find(l => l.id === id);

{
  const ex = extract(rich);
  assert.deepEqual(ex.layers.map(l => l.id), LAYER_IDS);
  const type = by(ex.layers, 'type');
  assert.equal(type.empty, false);
  assert.ok(type.lines.some(x => /boxed/.test(x)), 'Type mentions the caption style');
  const motion = by(ex.layers, 'motion');
  assert.ok(motion.lines.some(x => /flash/.test(x) || /pace/.test(x)), 'Motion mentions pace or transitions');
  const broll = by(ex.layers, 'broll');
  assert.equal(broll.empty, false);
  assert.ok(broll.lines.some(x => /B-roll|cutaway|full/i.test(x)));
  const person = by(ex.layers, 'person');
  assert.ok(person.lines.some(x => /17%/.test(x)));
  assert.ok(person.lines.some(x => /behind/.test(x)));
  const set = by(ex.layers, 'set');
  assert.ok(set.lines.some(x => /#101010/.test(x)));
  console.log('ok rich fixture: Type, Motion, B-roll, Person and Set fill from existing fields');
}

{
  const ex = extract(bare);
  assert.equal(by(ex.layers, 'type').empty, true);
  assert.equal(by(ex.layers, 'type').lines[0], 'Nothing measured for this layer yet.');
  assert.equal(by(ex.layers, 'broll').empty, true);
  assert.equal(by(ex.layers, 'broll').lines[0], 'No B-roll was found.');
  assert.equal(by(ex.layers, 'set').empty, true);
  assert.equal(by(ex.layers, 'set').lines[0], 'We did not measure the room on its own.');
  assert.equal(by(ex.layers, 'person').empty, true);
  assert.ok(!by(ex.layers, 'layout').empty, 'Layout still has the shot count');
  assert.ok(!by(ex.layers, 'motion').empty, 'Motion still has pace');
  console.log('ok bare fixture: Type, B-roll and Set are empty, Layout and Motion still fill');
}

{
  const cinematic = extract(join(ROOT, 'examples', 'recipes', 'cinematic.Reel.md'));
  const type = by(cinematic.layers, 'type');
  assert.ok(type.lines.some(x => /kinetic/.test(x)));
  assert.equal(by(cinematic.layers, 'broll').empty, true);
  assert.ok(by(cinematic.layers, 'motion').lines.some(x => /film|crossfade|pace/.test(x)));
  const same = layersView(cinematic, null);
  // without the recipe, Set still has grade from extracted.finishes; Brand colors need the recipe
  assert.ok(by(same, 'set').lines.some(x => /teal/.test(x)));
  console.log('ok cinematic recipe and extract-only fallback do not invent a room or B-roll');
}

rmSync(dir, { recursive: true, force: true });
console.log('studio-teardown-layers: 3 passed');
