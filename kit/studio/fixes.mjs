// Fixes: one way to sort out anything Studio needs that is missing, without ever showing a terminal command.
// Each fix says in plain words what is missing and why, and offers buttons on the page (web/src/Fix.jsx):
//   Install            Studio runs it itself (kit/setup.mjs --only <step>) when it safely can, with progress and result
//   Send to my agent   the instruction goes to a connected terminal agent through the Studio chat channel
//   Copy for my agent  the same instruction on the clipboard, for any agent
// The command lives only inside that instruction (prompt), never in the page's text. Things only the person can do
// (Chrome, ffmpeg, Node, Python on a computer without it) get a link as well. Errors carry a fix id so the page can
// show these buttons instead of a command.
import { ROOT } from './core.mjs';
import { sysFix } from '../setup.mjs';

const WIN = process.platform === 'win32';
// id: { label, why, step (kit/setup.mjs --only step, so Studio can install it), link, linkLabel, user (only the person
// or their agent can install it), how (what an agent runs) }
const DEFS = {
  npm: { label: 'Node packages', why: 'Studio, rendering and the agent tools need them.', step: 'npm', how: () => 'npm install' },
  python: { label: 'Python tools', why: 'Studio needs them to transcribe your footage, find beats and read references.', step: 'python', link: 'https://www.python.org/downloads/', linkLabel: 'Get Python', how: () => 'npm run setup:all -- --only python (if Python 3.10 or newer is not installed, install it first)' },
  ffmpeg: { label: 'ffmpeg', why: 'Studio needs it to draft, render and trim video.', user: true, link: 'https://ffmpeg.org/download.html', linkLabel: 'Get ffmpeg', how: () => `${sysFix('ffmpeg')} (it may ask for my password), so ffmpeg and ffprobe are on the PATH, then restart Studio` },
  chrome: { label: 'Chrome', why: 'Studio draws titles, graphics and B-roll cards with it.', user: true, link: 'https://www.google.com/chrome/', linkLabel: 'Get Chrome', how: () => `${sysFix('chrome')} (it may ask for my password), then restart Studio` },
  node: { label: 'Node.js 18 or newer', why: 'Everything in Studio runs on it.', user: true, link: 'https://nodejs.org', linkLabel: 'Get Node.js', how: () => (WIN ? 'winget install OpenJS.NodeJS.LTS' : 'the installer from https://nodejs.org') + ', then restart Studio' },
  model: { label: 'Whisper model', why: 'Studio downloads it once (about 470 MB) to transcribe your footage.', step: 'model', how: () => 'npm run setup:all -- --only model' },
  ytdlp: { label: 'yt-dlp', why: 'Studio uses it to download YouTube, TikTok, X and Vimeo links. It is free and optional.', step: 'ytdlp', how: () => 'npm run setup:all -- --only ytdlp' },
  instaloader: { label: 'instaloader', why: 'Studio uses it to download Instagram links, anonymously. It is free and optional.', step: 'ytdlp', how: () => 'npm run setup:all -- --only ytdlp' },
  effects: { label: 'Effects pass', why: 'Film effects and the person mask need it.', step: 'effects', how: () => 'npm run setup:all -- --only effects' },
  mask: { label: 'Person mask', why: 'Titles and captions go behind your head with it. It downloads once, about 928 MB.', step: 'mask', how: () => 'npm run setup:all -- --only mask' },
  rea: { label: 'rea-video', why: 'It reads a reference in full detail: shots, titles, captions and grade. Without it Studio uses a rougher built-in reader.', step: 'rea', how: () => 'npm run setup:all -- --only rea (it needs Git)' },
  humanizer: { label: 'Humanizer skill', why: 'Your agent uses it when it writes scripts. It ships with the kit.', how: () => 'git checkout skills/humanizer' },
  studio: { label: 'Studio page', why: 'The page itself needs building once.', step: 'studio', how: () => 'npm run studio:build' },
};
export const IDS = Object.keys(DEFS);
// the steps POST /api/fix/install may run: only kit/setup.mjs --only <one of these>, nothing else
export const stepOf = id => (DEFS[id] && DEFS[id].step) || null;
// the plain-words instruction for an agent; the command is in here and nowhere else
export function prompt(id, root = ROOT) {
  const d = DEFS[id]; if (!d) return null;
  return `In my aigent-talking-head folder (${root}), install ${d.label} for Studio by running ${d.how()}. ${d.why} Then tell me when it is done.`;
}
// what the page gets: no command except inside prompt
export function describe(id, root = ROOT) {
  const d = DEFS[id]; if (!d) return null;
  return { id, label: d.label, why: d.why, install: !!d.step, user: !!d.user, link: d.link || null, linkLabel: d.linkLabel || null, prompt: prompt(id, root) };
}
export const all = (root = ROOT) => Object.fromEntries(IDS.map(id => [id, describe(id, root)]));
// Studio stopped while the page was open: the page keeps this from its last state and copies it for the agent
export const restartPrompt = (root = ROOT) => `AIgent Studio stopped. In my aigent-talking-head folder (${root}), start it again by running npm run studio:agent, then tell me when the page is back. If it stopped by itself, send me the last 40 lines of jobs/.studio/server.log so we can see why.`;
// one sentence for an error: "<a and b> missing, so <what> cannot <do> yet."
export function missingLine(ids, what) {
  const names = ids.map(id => (DEFS[id] || { label: id }).label);
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  return `${list} ${names.length > 1 ? 'are' : 'is'} missing, so ${what}.`;
}
// a user-facing error with its fix ids attached (the page shows buttons from them)
export const fixError = (message, fix, code = 400) => Object.assign(new Error(message), { fix: [].concat(fix), code });
