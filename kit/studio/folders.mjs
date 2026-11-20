// Folder picking for Settings (Reference downloads, Copy finished reels to, the b-roll library). A browser cannot
// hand the page a full folder path, so the local server does it two ways:
//   pick()   opens this computer's own folder dialog and returns the full path the user chose
//            (Windows: PowerShell FolderBrowserDialog in an STA thread; macOS: osascript "choose folder";
//            Linux: zenity or kdialog when one is installed and there is a display)
//   list()   backs the in-page folder browser: folder names only, never files or their contents, and only under
//            the home folder, the kit folder, drives (Windows) and mounted volumes (/Volumes, /media, /mnt).
//            Hidden folders and the places apps keep secrets (dot folders, AppData, Library, the Windows folder)
//            are not listed and cannot be opened.
// The routes (mount below) answer only on localhost like the rest of Studio, and only to the page itself:
// every call needs the x-studio-page: 1 header (a cross-site page cannot send it without a preflight Studio refuses)
// and a cross-site Sec-Fetch-Site is refused.
import { execFile, spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, accessSync, constants } from 'fs';
import { homedir, platform as osPlatform } from 'os';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'path';

const IS_WIN = () => (process.env.STUDIO_FOLDERS_PLATFORM || osPlatform()) === 'win32';
const IS_MAC = () => (process.env.STUDIO_FOLDERS_PLATFORM || osPlatform()) === 'darwin';
const home = () => resolve(process.env.STUDIO_HOME || homedir());
const norm = p => (IS_WIN() ? p.toLowerCase() : p);
const inside = (p, root) => { const a = norm(p), b = norm(root).replace(/[\\/]+$/, ''); return a === b || a.startsWith(b + sep) || (IS_WIN() && a.startsWith(b + '\\')); };

// folder names never listed or entered: dot folders and where apps keep keys, tokens and system files
const DENY = new Set(['appdata', 'application data', 'local settings', '$recycle.bin', 'system volume information', 'keychains', 'node_modules']);
const DENY_TOP = new Set(['windows', 'programdata', 'recovery', 'config.msi', 'boot']); // right under a drive root
export const blocked = (name, top = false) => !name || name.startsWith('.') || name.startsWith('$') || DENY.has(name.toLowerCase())
  || (IS_MAC() && name === 'Library') || (top && DENY_TOP.has(name.toLowerCase()));

export function roots(ROOT) {
  const r = [home(), resolve(ROOT)];
  if (IS_WIN()) { for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const p = d + ':\\'; try { if (existsSync(p)) r.push(p); } catch {} } }
  else if (IS_MAC()) r.push('/Volumes');
  else for (const p of ['/media', '/mnt', '/run/media']) if (existsSync(p)) r.push(p);
  return r;
}

// is this folder one the browser may show: under a root, and no blocked name between the root and it
export function allowed(p, ROOT) {
  if (!p || !isAbsolute(p)) return false;
  let real; try { real = realpathSync(p); } catch { return false; }
  for (const root of roots(ROOT)) {
    let rr; try { rr = realpathSync(root); } catch { continue; }
    if (!inside(real, rr)) continue;
    const rest = real.slice(rr.replace(/[\\/]+$/, '').length).split(/[\\/]+/).filter(Boolean);
    if (rest.some((n, i) => blocked(n, i === 0 && /^[A-Za-z]:[\\/]?$/.test(rr)))) continue;
    return true;
  }
  return false;
}

export function places(ROOT) {
  const h = home(), out = [{ id: 'home', label: 'Home', path: h }];
  for (const [id, label, names] of [['desktop', 'Desktop', ['Desktop']], ['downloads', 'Downloads', ['Downloads']], ['videos', 'Videos', IS_MAC() ? ['Movies'] : ['Videos', 'Movies']], ['documents', 'Documents', ['Documents']]]) {
    const n = names.find(x => existsSync(join(h, x))); if (n) out.push({ id, label: IS_MAC() && id === 'videos' ? 'Movies' : label, path: join(h, n) });
  }
  out.push({ id: 'kit', label: 'Kit folder', path: resolve(ROOT) });
  if (IS_WIN()) for (const d of roots(ROOT).filter(x => /^[A-Z]:\\$/.test(x))) out.push({ id: 'drive-' + d[0].toLowerCase(), label: d.slice(0, 2), path: d });
  else for (const m of roots(ROOT).slice(2)) out.push({ id: 'vol-' + basename(m), label: m, path: m });
  return out.filter(x => allowed(x.path, ROOT));
}

const isDir = p => { try { return statSync(p).isDirectory(); } catch { return false; } };
const writable = p => { try { accessSync(p, constants.W_OK); return true; } catch { return false; } };

// one folder: its subfolders (names only, sorted), the way up and the breadcrumb, all inside the roots
export function list(p, ROOT) {
  const want = p ? resolve(String(p)) : home();
  if (!isDir(want)) throw Object.assign(new Error('no such folder'), { status: 404 });
  if (!allowed(want, ROOT)) throw Object.assign(new Error('that folder is outside what Studio shows (your home folder, the kit, drives and mounted volumes)'), { status: 403 });
  let ents = []; try { ents = readdirSync(want, { withFileTypes: true }); } catch (e) { throw Object.assign(new Error(`cannot read ${want}: ${e.code || e.message}`), { status: 403 }); }
  const top = /^[A-Za-z]:[\\/]?$/.test(want), folders = ents.filter(d => !blocked(d.name, top) && (d.isDirectory() || (d.isSymbolicLink() && isDir(join(want, d.name)) && allowed(join(want, d.name), ROOT))))
    .map(d => ({ name: d.name, path: join(want, d.name) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })).slice(0, 2000);
  const crumbs = []; let c = want;
  for (;;) { if (!allowed(c, ROOT)) break; crumbs.unshift({ name: parse(c).base || c, path: c }); const up = dirname(c); if (up === c) break; c = up; }
  const up = dirname(want);
  return { path: want, parent: up !== want && allowed(up, ROOT) ? up : null, crumbs, folders, writable: writable(want), sep, places: places(ROOT) };
}

const BAD_NAME = /[<>:"/\\|?*\x00-\x1f]/;
export function makeFolder(parent, name, ROOT) {
  const n = String(name || '').trim();
  if (!n || n.length > 120 || BAD_NAME.test(n) || blocked(n) || n === '..' || /[. ]$/.test(n)) throw Object.assign(new Error('pick a plain folder name (no slashes, no dot at the start or end)'), { status: 400 });
  const base = resolve(String(parent || ''));
  if (!isDir(base) || !allowed(base, ROOT)) throw Object.assign(new Error('cannot make a folder there'), { status: 403 });
  const p = join(base, n); if (existsSync(p)) throw Object.assign(new Error(`${n} already exists`), { status: 409 });
  mkdirSync(p); return p;
}

// open a folder in Explorer, Finder or the Linux file manager (STUDIO_FOLDERS_NO_OPEN=1 only reports it, for tests)
export function openFolder(p, ROOT, extra = []) {
  const want = resolve(String(p || ''));
  if (!isDir(want)) throw Object.assign(new Error('no such folder yet; save Settings first and it is made'), { status: 404 });
  const ok = allowed(want, ROOT) || extra.some(x => x && norm(resolve(x)) === norm(want));
  if (!ok) throw Object.assign(new Error('Studio only opens your folders'), { status: 403 });
  if (process.env.STUDIO_FOLDERS_NO_OPEN === '1') return { opened: want, dry: true };
  const [cmd, args] = IS_WIN() ? ['explorer.exe', [want]] : IS_MAC() ? ['open', [want]] : ['xdg-open', [want]];
  try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch {}
  return { opened: want };
}

// the native dialog. Returns { path } or { cancelled: true } or { unavailable: reason } (the page then shows its own
// browser). The start folder goes in through an environment variable, never into the script text.
const which = cmd => { const dirs = String(process.env.PATH || '').split(IS_WIN() ? ';' : ':'); return dirs.some(d => d && existsSync(join(d, cmd))); };
const PS = `Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Width = 0; Height = 0; StartPosition = 'CenterScreen' }
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:STUDIO_PICK_TITLE; $d.ShowNewFolderButton = $true
try { $d.UseDescriptionForTitle = $true } catch {}
if ($env:STUDIO_PICK_START -and (Test-Path -LiteralPath $env:STUDIO_PICK_START)) { $d.SelectedPath = $env:STUDIO_PICK_START }
$owner.Show(); $owner.Activate()
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; [Console]::Out.Write($d.SelectedPath) }
$owner.Close()`;
const OSA = `set t to system attribute "STUDIO_PICK_TITLE"
set s to system attribute "STUDIO_PICK_START"
try
  if s is not "" then
    set f to choose folder with prompt t default location (POSIX file s)
  else
    set f to choose folder with prompt t
  end if
  return POSIX path of f
on error number -128
  return ""
end try`;
export function dialogCommand() {
  if (process.env.STUDIO_FOLDER_DIALOG) return [process.env.STUDIO_FOLDER_DIALOG, []]; // tests: a command that prints a path
  if (IS_WIN()) return ['powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', PS]];
  if (IS_MAC()) return ['osascript', ['-e', OSA]];
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return null;
  if (which('zenity')) return ['zenity', ['--file-selection', '--directory', '--title', '%TITLE%', '--filename', '%START%']];
  if (which('kdialog')) return ['kdialog', ['--title', '%TITLE%', '--getexistingdirectory', '%STARTDIR%']];
  return null;
}
let picking = null;
export function pick({ start, title } = {}) {
  if (picking) return picking;
  const c = dialogCommand();
  if (!c) return Promise.resolve({ unavailable: IS_WIN() || IS_MAC() ? 'no folder dialog here' : 'no folder dialog on this system (install zenity or kdialog, or use the folder list)' });
  const st = start && isDir(resolve(String(start))) ? resolve(String(start)) : home(), t = String(title || 'Choose a folder').slice(0, 120);
  const args = c[1].map(a => a === '%TITLE%' ? t : a === '%START%' ? st.replace(/[\\/]*$/, sep) : a === '%STARTDIR%' ? st : a);
  picking = new Promise(done => {
    execFile(c[0], args, { timeout: 10 * 60e3, windowsHide: false, encoding: 'utf8', env: { ...process.env, STUDIO_PICK_START: st, STUDIO_PICK_TITLE: t } }, (err, out) => {
      picking = null;
      const p = String(out || '').trim().replace(/[\r\n]+[\s\S]*$/, '');
      if (p && isAbsolute(p)) return done({ path: p.length > 1 ? p.replace(/[\\/]+$/, '') || p : p });
      if (err && err.code === 'ENOENT') return done({ unavailable: `${c[0]} not found` });
      if (err && err.killed) return done({ unavailable: 'the folder dialog timed out' });
      // zenity and kdialog exit 1 on cancel; osascript returns "" on cancel; PowerShell prints nothing
      return done({ cancelled: true });
    });
  });
  return picking;
}

// the HTTP routes; returns true when it answered
export function mount({ ROOT, json, readBody, extraFolders = () => [], ensure = [] }) {
  const guard = (req, res) => {
    if (req.headers['x-studio-page'] !== '1') { json(res, 403, { error: 'folder access is for the Studio page only' }); return false; }
    if (req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: 'cross-site request refused' }); return false; }
    return true;
  };
  const fail = (res, e) => json(res, e.status || 500, { error: e.message });
  return async function route(p, M, u, req, res) {
    if (!p.startsWith('/api/folders')) return false;
    if (!guard(req, res)) return true;
    try {
      if (p === '/api/folders' && M === 'GET') { json(res, 200, list(u.searchParams.get('path') || null, ROOT)); return true; }
      if (p === '/api/folders/new' && M === 'POST') { const b = await readBody(req); const made = makeFolder(b.path, b.name, ROOT); json(res, 200, { made, ...list(made, ROOT) }); return true; }
      if (p === '/api/folders/open' && M === 'POST') { const b = await readBody(req); const w = b.path && resolve(String(b.path)); if (w && ensure.some(x => norm(resolve(x)) === norm(w)) && !existsSync(w)) mkdirSync(w, { recursive: true }); json(res, 200, openFolder(b.path, ROOT, extraFolders())); return true; }
      if (p === '/api/folders/pick' && M === 'POST') { const b = await readBody(req); json(res, 200, await pick({ start: b.start, title: b.title })); return true; }
      json(res, 404, { error: 'unknown folder route' }); return true;
    } catch (e) { fail(res, e); return true; }
  };
}
