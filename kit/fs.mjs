// Freesound search, CC0 only. Key from env FREESOUND_API_KEY (or a .env file named by FREESOUND_ENV_FILE).
// Usage: node kit/fs.mjs "cinematic whoosh" "quick woosh"
import { readFileSync, existsSync } from 'fs';
let key = process.env.FREESOUND_API_KEY;
if (!key && process.env.FREESOUND_ENV_FILE && existsSync(process.env.FREESOUND_ENV_FILE)) {
  const env = readFileSync(process.env.FREESOUND_ENV_FILE, 'utf8');
  key = (env.match(/^FREESOUND_API_KEY=(.+)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
}
if (!key) { console.error('Set FREESOUND_API_KEY (get one at freesound.org/apiv2/apply)'); process.exit(1); }
for (const q of process.argv.slice(2)) {
  const filter = encodeURIComponent('license:"Creative Commons 0" duration:[0.25 TO 2.2]');
  const u = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&filter=${filter}&sort=downloads_desc&fields=id,name,duration,license,avg_rating,num_ratings,num_downloads,previews,username&page_size=5`;
  const j = await (await fetch(u, { headers: { Authorization: 'Token ' + key } })).json();
  console.log('##', q, j.count);
  for (const s of j.results || []) console.log(s.id, '|', s.name, '|', s.duration.toFixed(2) + 's', '|', s.avg_rating?.toFixed(1), 'x', s.num_ratings, '| dl', s.num_downloads, '|', s.username, '|', s.previews['preview-hq-mp3']);
}
