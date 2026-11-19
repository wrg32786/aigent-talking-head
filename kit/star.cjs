// Quiet reminders after a successful render.
// Star: prints once on the first render, then at most once more after 5 renders,
// and never again on this machine.
// Skool: prints at most twice, never on the same run as the star reminder, and
// with the same spacing (first eligible non-star run, then once more after 5
// renders). At most one prompt per run.
// Skipped (and the state file is left alone) when --json is set, when CI is set,
// or when stdout is not a TTY. AIGENT_NO_STAR=1 turns off only the star line.
// AIGENT_NO_SKOOL=1 turns off only the Academy line. Both together, or a
// silenced run, leave the state file alone.
// State lives in the user cache dir (see statePath). Set AIGENT_STAR_STATE to
// a file path to override it (used by tests).
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = 'https://github.com/wrg32786/aigent-talking-head';
const LINE = `Reel saved. If aigent-talking-head helped, a star helps others find it: ${REPO}`;
const SKOOL_URL = 'https://www.skool.com/the-aigent-academy/about?ref=gh-aigent-talking-head';
const SKOOL_LINE = `Want help turning this into a business? Join The AIgent Academy: ${SKOOL_URL}`;
const SECOND_AFTER = 5;

function statePath() {
  if (process.env.AIGENT_STAR_STATE) return process.env.AIGENT_STAR_STATE;
  const home = os.homedir();
  const base = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'aigent-talking-head')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'aigent-talking-head')
      : path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'aigent-talking-head');
  return path.join(base, 'star.json');
}

function flagSet(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function optedOutStar() {
  return flagSet('AIGENT_NO_STAR');
}

function optedOutSkool() {
  return flagSet('AIGENT_NO_SKOOL');
}

function ciSet() {
  return String(process.env.CI || '').trim() !== '';
}

function silenced(opts = {}) {
  if (opts.json) return true;
  if (ciSet()) return true;
  const tty = opts.tty != null ? opts.tty : Boolean(process.stdout && process.stdout.isTTY);
  if (!tty) return true;
  return false;
}

// True when the star reminder itself would be allowed to consider this run.
function shouldPrompt(opts = {}) {
  if (silenced(opts)) return false;
  if (optedOutStar()) return false;
  return true;
}

function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const renders = Number(s && s.renders);
    const prompts = Number(s && s.prompts);
    const skoolPrompts = Number(s && s.skoolPrompts);
    const lastSkoolRender = Number(s && s.lastSkoolRender);
    return {
      renders: Number.isFinite(renders) && renders > 0 ? renders : 0,
      prompts: Number.isFinite(prompts) && prompts > 0 ? prompts : 0,
      skoolPrompts: Number.isFinite(skoolPrompts) && skoolPrompts > 0 ? skoolPrompts : 0,
      lastSkoolRender: Number.isFinite(lastSkoolRender) && lastSkoolRender > 0 ? lastSkoolRender : 0,
    };
  } catch {
    return { renders: 0, prompts: 0, skoolPrompts: 0, lastSkoolRender: 0 };
  }
}

function saveState(file, st) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    renders: st.renders,
    prompts: st.prompts,
    skoolPrompts: st.skoolPrompts,
    lastSkoolRender: st.lastSkoolRender,
  }) + '\n');
}

// Call after a successful render (not --draft). Returns whether a line was printed.
function maybePrompt(opts = {}) {
  if (silenced(opts)) return false;
  const starOk = !optedOutStar();
  const skoolOk = !optedOutSkool();
  if (!starOk && !skoolOk) return false;
  const file = opts.stateFile || statePath();
  const st = loadState(file);
  st.renders += 1;
  const starDue = starOk && st.prompts < 2 && (st.renders === 1 || st.renders > SECOND_AFTER);
  let line = null;
  if (starDue) {
    st.prompts = st.renders === 1 ? 1 : 2;
    line = LINE;
  } else if (skoolOk && st.skoolPrompts < 2) {
    const spacingOk = st.skoolPrompts === 0 || st.renders >= st.lastSkoolRender + SECOND_AFTER;
    if (spacingOk) {
      st.skoolPrompts += 1;
      st.lastSkoolRender = st.renders;
      line = SKOOL_LINE;
    }
  }
  try { saveState(file, st); } catch { /* never fail a render over the reminder */ }
  if (line) {
    try { (opts.log || console.log)(line); } catch { /* ignore */ }
    return true;
  }
  return false;
}

function selfTest() {
  const errs = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ath-star-'));
  const file = path.join(tmp, 'star.json');
  const hold = {
    CI: process.env.CI,
    AIGENT_NO_STAR: process.env.AIGENT_NO_STAR,
    AIGENT_NO_SKOOL: process.env.AIGENT_NO_SKOOL,
    AIGENT_STAR_STATE: process.env.AIGENT_STAR_STATE,
  };
  const lines = [];
  const log = m => lines.push(m);
  const resetEnv = () => {
    delete process.env.CI;
    delete process.env.AIGENT_NO_STAR;
    delete process.env.AIGENT_NO_SKOOL;
    delete process.env.AIGENT_STAR_STATE;
  };
  const restore = () => {
    for (const [k, v] of Object.entries(hold)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  try {
    resetEnv();
    if (shouldPrompt({ json: true, tty: true })) errs.push('printed under --json');
    if (shouldPrompt({ tty: false })) errs.push('printed when stdout is not a TTY');
    process.env.CI = 'true';
    if (shouldPrompt({ tty: true })) errs.push('printed when CI is set');
    delete process.env.CI;
    process.env.AIGENT_NO_STAR = '1';
    if (shouldPrompt({ tty: true })) errs.push('printed when AIGENT_NO_STAR=1');
    delete process.env.AIGENT_NO_STAR;
    if (!shouldPrompt({ tty: true })) errs.push('skipped a normal TTY render');

    // Star cadence, with the Academy line off so these assertions stay about stars.
    process.env.AIGENT_NO_SKOOL = '1';
    const run = () => maybePrompt({ tty: true, stateFile: file, log });
    const expect = (n, printed, renders, prompts, label) => {
      lines.length = 0;
      const got = run();
      if (got !== printed) errs.push(`${label}: printed=${got}, expected ${printed}`);
      if (printed && lines[0] !== LINE) errs.push(`${label}: wrong line ${JSON.stringify(lines[0])}`);
      if (!printed && lines.length) errs.push(`${label}: unexpected line`);
      const st = loadState(file);
      if (st.renders !== renders || st.prompts !== prompts) errs.push(`${label}: state ${JSON.stringify(st)}, expected renders=${renders} prompts=${prompts}`);
    };
    expect(1, true, 1, 1, 'first render');
    for (let i = 2; i <= 5; i++) expect(i, false, i, 1, `render ${i}`);
    expect(6, true, 6, 2, 'after 5 renders');
    expect(7, false, 7, 2, 'render 7');
    expect(8, false, 8, 2, 'render 8');
    delete process.env.AIGENT_NO_SKOOL;

    // silenced calls, and both opt-outs, must not touch state
    const before = loadState(file);
    maybePrompt({ json: true, tty: true, stateFile: file, log });
    process.env.CI = '1';
    maybePrompt({ tty: true, stateFile: file, log });
    delete process.env.CI;
    process.env.AIGENT_NO_STAR = '1';
    process.env.AIGENT_NO_SKOOL = '1';
    maybePrompt({ tty: true, stateFile: file, log });
    delete process.env.AIGENT_NO_STAR;
    delete process.env.AIGENT_NO_SKOOL;
    maybePrompt({ tty: false, stateFile: file, log });
    const after = loadState(file);
    if (after.renders !== before.renders || after.prompts !== before.prompts || after.skoolPrompts !== before.skoolPrompts) {
      errs.push(`suppressed call changed state ${JSON.stringify(after)}`);
    }

    // catch-up: already past 5 renders with no prompts yet, print the star once and stop
    process.env.AIGENT_NO_SKOOL = '1';
    const late = path.join(tmp, 'late.json');
    fs.writeFileSync(late, JSON.stringify({ renders: 9, prompts: 0 }) + '\n');
    lines.length = 0;
    if (!maybePrompt({ tty: true, stateFile: late, log })) errs.push('late state did not print');
    if (lines[0] !== LINE) errs.push(`late state wrong line ${JSON.stringify(lines[0])}`);
    const lateSt = loadState(late);
    if (lateSt.prompts !== 2 || lateSt.renders !== 10) errs.push(`late state ${JSON.stringify(lateSt)}`);
    lines.length = 0;
    if (maybePrompt({ tty: true, stateFile: late, log })) errs.push('late state printed a second time');
    delete process.env.AIGENT_NO_SKOOL;

    // Skool: at most twice, never on the same run as a star, same spacing
    resetEnv();
    const skoolFile = path.join(tmp, 'skool.json');
    const expectLine = (label, printed, expectedLine, renders, prompts, skoolPrompts) => {
      lines.length = 0;
      const got = maybePrompt({ tty: true, stateFile: skoolFile, log });
      if (got !== printed) errs.push(`${label}: printed=${got}, expected ${printed}`);
      if (printed && lines[0] !== expectedLine) errs.push(`${label}: wrong line ${JSON.stringify(lines[0])}`);
      if (!printed && lines.length) errs.push(`${label}: unexpected line`);
      const st = loadState(skoolFile);
      if (st.renders !== renders || st.prompts !== prompts || st.skoolPrompts !== skoolPrompts) {
        errs.push(`${label}: state ${JSON.stringify(st)}, expected renders=${renders} prompts=${prompts} skoolPrompts=${skoolPrompts}`);
      }
    };
    expectLine('both: first render is star', true, LINE, 1, 1, 0);
    expectLine('both: second render is skool', true, SKOOL_LINE, 2, 1, 1);
    for (let i = 3; i <= 5; i++) expectLine(`both: render ${i} is quiet`, false, null, i, 1, 1);
    expectLine('both: sixth render is star again', true, LINE, 6, 2, 1);
    expectLine('both: seventh render is second skool', true, SKOOL_LINE, 7, 2, 2);
    expectLine('both: eighth render is quiet', false, null, 8, 2, 2);

    // Star off: Skool takes the first and sixth renders
    resetEnv();
    process.env.AIGENT_NO_STAR = '1';
    const starOff = path.join(tmp, 'star-off.json');
    const expectSkool = (label, printed, renders, skoolPrompts) => {
      lines.length = 0;
      const got = maybePrompt({ tty: true, stateFile: starOff, log });
      if (got !== printed) errs.push(`${label}: printed=${got}, expected ${printed}`);
      if (printed && lines[0] !== SKOOL_LINE) errs.push(`${label}: wrong line ${JSON.stringify(lines[0])}`);
      if (!printed && lines.length) errs.push(`${label}: unexpected line`);
      const st = loadState(starOff);
      if (st.renders !== renders || st.prompts !== 0 || st.skoolPrompts !== skoolPrompts) {
        errs.push(`${label}: state ${JSON.stringify(st)}`);
      }
    };
    expectSkool('star off: first is skool', true, 1, 1);
    for (let i = 2; i <= 5; i++) expectSkool(`star off: render ${i} is quiet`, false, i, 1);
    expectSkool('star off: sixth is second skool', true, 6, 2);
    expectSkool('star off: seventh is quiet', false, 7, 2);
    delete process.env.AIGENT_NO_STAR;

    // AIGENT_NO_SKOOL alone still allows the star line
    resetEnv();
    process.env.AIGENT_NO_SKOOL = '1';
    const onlyStar = path.join(tmp, 'only-star.json');
    lines.length = 0;
    if (!maybePrompt({ tty: true, stateFile: onlyStar, log }) || lines[0] !== LINE) {
      errs.push(`NO_SKOOL blocked the star line ${JSON.stringify(lines[0])}`);
    }
    delete process.env.AIGENT_NO_SKOOL;

    // a write failure must not throw
    const broken = path.join(tmp, 'missing', 'nope.json');
    const realMkdir = fs.mkdirSync;
    fs.mkdirSync = () => { throw new Error('no dir'); };
    try {
      maybePrompt({ tty: true, stateFile: broken, log });
    } catch (e) {
      errs.push(`write failure threw: ${e.message}`);
    } finally {
      fs.mkdirSync = realMkdir;
    }
  } finally {
    restore();
  }
  return errs;
}

module.exports = { maybePrompt, shouldPrompt, statePath, selfTest, LINE, SKOOL_LINE, SKOOL_URL, REPO, SECOND_AFTER };

if (require.main === module) {
  const errs = selfTest();
  if (errs.length) {
    errs.forEach(e => console.error('  error: ' + e));
    console.error(`${errs.length} error(s).`);
    process.exit(1);
  }
  console.log('STAR PASS');
}
