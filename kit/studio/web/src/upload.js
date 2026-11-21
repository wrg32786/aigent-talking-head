import { toast } from './lib.jsx';
// Sends dropped or chosen files to the local server, one at a time.
export async function upload(kind, files, s, apply) {
  if (!s.job) { toast('Name the reel first (top left)'); document.getElementById('job')?.focus(); return; }
  for (const f of files) {
    const r = await fetch(`/api/upload?kind=${kind}&name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'upload failed'); break; }
    apply(j);
    if (j.reset && j.note) toast(j.note, true);
  }
}
