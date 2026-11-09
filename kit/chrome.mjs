// Find a Chrome/Chromium binary for Playwright. Order: CHROME_PATH env, the usual install paths for this OS,
// then chrome/chromium on PATH. Usage: import { findChrome } from './chrome.mjs'  |  node kit/chrome.mjs (prints it)
import { existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';

export function chromeCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const roots = [env['PROGRAMFILES'] || 'C:/Program Files', env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(r => [join(r, 'Google/Chrome/Application/chrome.exe'), join(r, 'Chromium/Application/chrome.exe'), join(r, 'Microsoft/Edge/Application/msedge.exe')]);
  }
  if (platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium', 'Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
    return [...apps.map(a => '/Applications/' + a), ...(env.HOME ? apps.map(a => join(env.HOME, 'Applications', a)) : [])];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/opt/google/chrome/chrome', '/usr/bin/microsoft-edge'];
}

export function findChrome() {
  const env = process.env.CHROME_PATH;
  if (env) { if (existsSync(env)) return env; throw new Error(`CHROME_PATH is set but nothing is at ${env}`); }
  for (const c of chromeCandidates()) if (existsSync(c)) return c;
  if (process.platform !== 'win32') {
    for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try { const p = execFileSync('which', [n], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); if (p) return p; } catch {}
    }
  }
  throw new Error('Chrome not found. Install Google Chrome or Chromium, or set CHROME_PATH to its binary.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { console.log(findChrome()); } catch (e) { console.error(e.message); process.exit(1); }
}
