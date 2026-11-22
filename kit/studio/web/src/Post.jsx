// The Post step: send the rendered reel to Buffer. Three small parts, one on screen at a time:
//   1. Connect: your Buffer key and where the video is hosted (Cloudinary, Cloudflare R2, or your own link)
//   2. Channels: the reel, the channels and one caption; per-channel options folded
//   3. Send: drafts by default; queue, a time, or post now (post now needs a tick first)
// The page only talks to Studio's own /api/post routes. Keys never come back to the page and Buffer, R2 and Cloudinary
// are called by the local server (kit/studio/post.mjs).
import { useEffect, useRef, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Badge } from '@astryxdesign/core/Badge';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { api, toast, file, Icon } from './lib.jsx';
import { KeyRow } from './Keys.jsx';
import { Fold, Hint, Toggle } from './ui.jsx';

const PARTS = [['connect', 'Connect'], ['channels', 'Channels'], ['send', 'Send']];
const SERVICE = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube', linkedin: 'LinkedIn', twitter: 'X', threads: 'Threads', bluesky: 'Bluesky', pinterest: 'Pinterest', mastodon: 'Mastodon', googlebusiness: 'Google Business' };
const HOSTS = [['cloudinary', 'Cloudinary'], ['r2', 'Cloudflare R2'], ['url', 'My own link']];
const MODE_LABEL = { draft: 'Send to Buffer as drafts', queue: 'Add to the Buffer queue', schedule: 'Schedule in Buffer', now: 'Post now' };
const PHASE = { start: 'Starting', channels: 'Reading your channels', encode: 'Checking the video (H.264 MP4)', upload: 'Uploading the video', check: 'Checking the public link', buffer: 'Creating the posts in Buffer' };
const len = s => String(s || '').length;
const secs = s => s == null ? '' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min${Math.round(s % 60) ? ` ${Math.round(s % 60)} s` : ''}`;

export function Post({ V, s, go }) {
  const [st, setSt] = useState(null), [keys, setKeys] = useState(null), [part, setPart] = useState(null);
  const load = async () => { const [a, k] = await Promise.all([api('/api/post'), api('/api/keys')]); setSt(a); setKeys(k); return a; };
  useEffect(() => { load().catch(() => {}); }, [s.job, (V.outputs || []).join()]);
  const hostReady = st && st.host.pick && st.host[st.host.pick].ready;
  const connected = !!(st && st.buffer.set && hostReady);
  useEffect(() => { if (st && !part) setPart(connected ? 'channels' : 'connect'); }, [st]);
  if (!st || !keys) return <section className="step" id="s-post" data-step="post" aria-labelledby="h-post"><header className="sh"><h2 id="h-post">Post</h2></header><p className="fine" role="status">Loading</p></section>;
  const reels = st.reels;
  return <section className="step" id="s-post" data-step="post" aria-labelledby="h-post">
    <header className="sh"><h2 id="h-post">Post</h2><p className="sub">Send the reel to Buffer. Drafts by default, so nothing goes out until you say so.</p></header>
    {!reels.length ? <div className="empty-art glass-card" id="post-empty"><Icon n="film" /><p>{s.job ? 'Render the reel first, then post it here.' : 'Name the reel at the top to start.'}</p>{s.job && <Button id="post-go-render" variant="secondary" label="Go to Render" onClick={() => go('render', true)} />}</div> : <>
      <ol className="post-parts" aria-label="Post steps">{PARTS.map(([id, label], k) => <li key={id}>
        <button type="button" id={'post-part-' + id} aria-current={part === id ? 'step' : 'false'} disabled={id !== 'connect' && !connected} onClick={() => setPart(id)}>
          <span className="sn">{id === 'connect' && connected && part !== 'connect' ? <Icon n="check" /> : k + 1}</span>{label}</button></li>)}</ol>
      {part === 'connect' && <Connect st={st} keys={keys} reload={load} setKeys={j => { setKeys(x => ({ ...x, ...j })); load().catch(() => {}); }} next={() => setPart('channels')} connected={connected} />}
      <Compose hidden={part !== 'channels' && part !== 'send'} part={part} setPart={setPart} st={st} s={s} reload={load} V={V} />
    </>}
  </section>;
}

function Connect({ st, keys, setKeys, reload, next, connected }) {
  const k = id => keys.keys.find(x => x.id === id);
  const [host, setHost] = useState(st.host.pick || 'cloudinary'), [f, setF] = useState(() => ({ r2: { account: st.host.r2.account || '', bucket: st.host.r2.bucket || '', publicBase: st.host.r2.publicBase || '', prefix: st.host.r2.prefix || '' }, cloudinary: { cloud: st.host.cloudinary.cloud || '', preset: st.host.cloudinary.preset || '', folder: st.host.cloudinary.folder || '' } }));
  const [busy, setBusy] = useState(''), [res, setRes] = useState(null);
  const set = (h, key, v) => setF(x => ({ ...x, [h]: { ...x[h], [key]: v } }));
  const save = async () => { setBusy('save'); setRes(null); try { await api('/api/post/host', { host, ...(host === 'url' ? {} : { [host]: f[host] }) }); await reload(); toast('Video host saved', true); } catch {} setBusy(''); };
  const check = async () => { setBusy('check'); try { setRes(await api('/api/post/host/test', { host })); } catch {} setBusy(''); };
  const hs = st.host[host] || { ready: true, missing: [] };
  const In = ({ h, id, label, ph, note }) => <label className="col"><span className="lbl">{label}</span><input id={`post-${h}-${id}`} spellCheck="false" autoComplete="off" placeholder={ph} value={f[h][id]} onChange={e => set(h, id, e.target.value)} />{note && <small className="fine">{note}</small>}</label>;
  return <div className="post-connect">
    <div className="glass-card post-card" id="post-buffer">
      <h3 className="lbl">1. Your Buffer key <Hint id="post-buffer-hint" label="About the Buffer key">Make a personal key in Buffer, Settings, API, with posting allowed. It works on every Buffer plan, including Free. It stays on this computer and only Studio's local server uses it.</Hint></h3>
      <ul className="key-list"><KeyRow k={k('buffer')} setKeys={setKeys} /></ul>
    </div>
    <div className="glass-card post-card" id="post-host">
      <h3 className="lbl">2. Where the video lives <Hint id="post-host-hint" label="Why a host">Buffer has no upload. It fetches the video from a public link when the post goes out, which can be days later. Dropbox and Google Drive links do not work, so Studio uploads the reel to your Cloudinary or R2, or you paste a link you host.</Hint></h3>
      <SegmentedControl label="Video host" value={host} onChange={v => { setHost(v); setRes(null); }} size="sm">{HOSTS.map(([v, l]) => <SegmentedControlItem key={v} value={v} label={l} />)}</SegmentedControl>
      {host === 'cloudinary' && <div className="post-fields" id="post-fields-cloudinary">
        {In({ h: "cloudinary", id: "cloud", label: "Cloud name", ph: "my-cloud" })}
        {In({ h: "cloudinary", id: "preset", label: "Unsigned upload preset", ph: "reels_unsigned", note: "Cloudinary, Settings, Upload, Upload presets: add one set to Unsigned. Or leave it empty and use your API key below." })}
        <Fold id="post-cloudinary-adv" title="Use an API key instead, folder">
          <ul className="key-list"><KeyRow k={k('cloudinary')} setKeys={setKeys} /></ul>
          {In({ h: "cloudinary", id: "folder", label: "Folder", ph: "reels" })}
        </Fold>
      </div>}
      {host === 'r2' && <div className="post-fields" id="post-fields-r2">
        {In({ h: "r2", id: "bucket", label: "Bucket", ph: "my-reels" })}
        {In({ h: "r2", id: "publicBase", label: "Public bucket URL", ph: "https://pub-xxxx.r2.dev", note: "Turn on public access for the bucket (its r2.dev address or your own domain). Signed links expire, so Studio does not use them." })}
        {In({ h: "r2", id: "account", label: "Account ID", ph: "32 characters, from the R2 overview" })}
        <ul className="key-list"><KeyRow k={k('r2')} setKeys={setKeys} /></ul>
        <Fold id="post-r2-adv" title="Folder in the bucket">{In({ h: "r2", id: "prefix", label: "Folder", ph: "reels" })}</Fold>
      </div>}
      {host === 'url' && <p className="fine" id="post-fields-url">You paste a public https link to the MP4 when you send. It has to stay up until every post has gone out.</p>}
      <div className="row">
        <Button id="post-host-save" size="sm" variant="secondary" label="Save host" isLoading={busy === 'save'} onClick={save} />
        {host !== 'url' && st.host.pick === host && <Button id="post-host-check" size="sm" variant="ghost" label="Check host" isLoading={busy === 'check'} onClick={check} />}
        <span className="fine" id="post-host-state">{st.host.pick === host ? (hs.ready ? 'Ready' : 'Still needs: ' + hs.missing.join(', ')) : 'Not saved yet'}</span>
      </div>
      {res && <p className="fine kr-res" role="status" id="post-host-res">{res.ok === false ? res.error : res.note}</p>}
    </div>
    <div className="row post-nav"><Button id="post-next-channels" variant="primary" label="Next: channels" isDisabled={!connected} endContent={<Icon n="right" />} onClick={next} />{!connected && <span className="fine">Add the Buffer key and save a host first.</span>}</div>
  </div>;
}

function Compose({ hidden, part, setPart, st, s, reload, V }) {
  const [chs, setChs] = useState(null), [err, setErr] = useState(''), [pick, setPick] = useState(st.channels || []);
  const [reel, setReel] = useState(st.reels[0]), [caption, setCaption] = useState(''), [own, setOwn] = useState({}), [ytTitle, setYtTitle] = useState(''), [ytCat, setYtCat] = useState(st.youtubeCategory || '22'), [feed, setFeed] = useState(true), [place, setPlace] = useState({}), [feedUrl, setFeedUrl] = useState(''), [making, setMaking] = useState(false);
  const [checks, setChecks] = useState({}), [info, setInfo] = useState(null), [feedFile, setFeedFile] = useState(null);
  const [mode, setMode] = useState('draft'), [due, setDue] = useState(''), [confirm, setConfirm] = useState(false), [url, setUrl] = useState('');
  const [job, setJob] = useState(null), [result, setResult] = useState(null);
  const loaded = useRef(false);
  const loadChs = fresh => api('/api/post/channels' + (fresh ? '?fresh=1' : '')).then(j => { setChs(j.channels); setErr(''); }).catch(e => setErr(String(e.message || e)));
  useEffect(() => { if (!hidden && !loaded.current) { loaded.current = true; loadChs(); } }, [hidden]);
  useEffect(() => { if (!st.reels.includes(reel)) setReel(st.reels[0]); }, [st.reels.join()]);
  // per-channel warnings: length, shape, caption limits (the server measures the reel)
  useEffect(() => { if (hidden || !chs) return; const t = setTimeout(() => api('/api/post/check', { reel, channels: pick, caption, captions: own, youtubeTitle: ytTitle, placements: place }).then(j => { setInfo(j.info); setFeedFile(j.feed || null); setChecks(Object.fromEntries(j.channels.map(c => [c.id, c]))); }).catch(() => {}), 250); return () => clearTimeout(t); }, [hidden, chs, reel, pick.join(), caption, JSON.stringify(own), ytTitle, JSON.stringify(place), st.reels.join(), making]);
  useEffect(() => { if (!job || job.status !== 'running') return; const t = setInterval(() => api('/api/post/send?id=' + job.id).then(j => { setJob(j); if (j.status === 'done') { setResult(j.result); reload().catch(() => {}); } if (j.status === 'failed') toast(j.error); }).catch(() => {}), 700); return () => clearInterval(t); }, [job && job.id, job && job.status]);
  const picked = (chs || []).filter(c => pick.includes(c.id)), services = new Set(picked.map(c => c.service));
  const limit = picked.reduce((m, c) => c.rules && c.rules.caption ? Math.min(m, c.rules.caption) : m, Infinity);
  const blocked = picked.filter(c => checks[c.id] && !checks[c.id].ok);
  const host = st.host.pick;
  // the Instagram Feed takes 4:5 to 1.91:1, so a channel set to Feed gets the 4:5 of the same version
  const toFeed = picked.filter(c => c.service === 'instagram' && place[c.id] === 'feed'), feedMissing = toFeed.length > 0 && (!feedFile || feedFile.missing);
  const task = V && V.task, taskRunning = !!(task && task.status === 'running');
  useEffect(() => { if (making && !taskRunning) { setMaking(false); reload().catch(() => {}); } }, [taskRunning]);
  // an export that ended before the page ever saw it running: Make it stops spinning and the file is looked for again
  useEffect(() => { if (!making || taskRunning) return; const id = setTimeout(() => { setMaking(false); reload().catch(() => {}); }, 4000); return () => clearTimeout(id); }, [making, taskRunning]);
  const makeFeed = () => api('/api/sizes/make', { size: 'feed45', file: reel }).then(() => setMaking(true)).catch(() => {});
  const name = f => String(f || '').split('/').pop();
  // a reel by its version, not its file name (the file name stays in the tooltip and on Download)
  const verName = f => { const m = name(f).match(/^reel-v(\d+)/); return m ? `Version ${m[1]}` : name(f); };
  // a channel set to the Feed while the 4:5 is not made yet: the one fixable reason, said once on its row with the fix
  const needsFeed = c => feedMissing && c.service === 'instagram' && place[c.id] === 'feed';
  const toggle = id => setPick(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const canSend = picked.length > blocked.length && (mode !== 'schedule' || due) && (mode !== 'now' || confirm) && (host !== 'url' || /^https:\/\//.test(url.trim())) && !(job && job.status === 'running') && !making;
  const send = async () => {
    setResult(null);
    try { const j = await api('/api/post/send', { reel, channels: pick, caption, captions: Object.fromEntries(Object.entries(own).filter(([id, v]) => pick.includes(id) && v != null)), mode, dueAt: mode === 'schedule' ? new Date(due).toISOString() : undefined, confirmNow: mode === 'now' ? confirm : undefined, youtubeTitle: ytTitle || undefined, youtubeCategory: ytCat, shareToFeed: feed, placements: Object.fromEntries(toFeed.map(c => [c.id, 'feed'])), ...(host === 'url' ? { url: url.trim(), ...(feedUrl.trim() ? { feedUrl: feedUrl.trim() } : {}) } : {}) }); setJob({ id: j.id, status: 'running', phase: 'start' }); } catch {}
  };
  if (hidden) return null;
  return <div className="post-compose">
    {part === 'channels' && <>
      <div className="glass-card post-card" id="post-reel">
        <label className="col"><span className="lbl">Reel</span><select id="post-reel-pick" value={reel} onChange={e => setReel(e.target.value)}>{st.reels.map(r => <option key={r} value={r}>{verName(r)}{st.files && st.files[r] ? ` (${st.files[r].use})` : ''}</option>)}</select></label>
        <div className="post-reel-row"><video src={file(reel) + '#t=1.2'} preload="metadata" muted aria-label={'Preview of ' + reel.split('/').pop()} /><p className="fine" id="post-reel-info" title={info ? [name(reel), info.width && `${info.width}x${info.height}`, info.size && `${Math.round(info.size / 1e6 * 10) / 10} MB`].filter(Boolean).join(', ') : undefined}>{info ? secs(info.seconds) : ''}</p></div>
        <div className="post-where" id="post-where"><Icon n="info" /><p className="fine">{st.where || 'Reels and Stories get the 9:16 file. The Instagram Feed gets the 4:5 file.'}</p></div>
      </div>
      <div className="glass-card post-card" id="post-channels">
        <div className="row"><h3 className="lbl">Channels</h3><Button id="post-reload-channels" size="sm" variant="ghost" label="Reload" onClick={() => loadChs(true)} /></div>
        {err && <p className="fine kr-res" role="alert" id="post-ch-err">{err}</p>}
        {!chs && !err && <p className="fine" role="status">Reading your Buffer channels</p>}
        {chs && !chs.length && <p className="fine">No channels in your Buffer account yet. Connect Instagram, TikTok, YouTube and others in Buffer, then Reload.</p>}
        {chs && <ul className="post-ch-list">{chs.map(c => { const on = pick.includes(c.id), ck = checks[c.id]; return <li key={c.id} data-id={c.id} data-service={c.service} className={on ? 'on' : ''}>
          <label><input type="checkbox" checked={on} onChange={() => toggle(c.id)} /><span className="pc-n"><b>{c.name}</b><small className="fine">{SERVICE[c.service] || c.service}{c.rules && c.rules.max ? `, up to ${secs(c.rules.max)}` : ''}</small></span>
            {on && ck && !ck.ok && <Badge label={needsFeed(c) ? "Can't post yet" : "Can't post this one"} variant={needsFeed(c) ? 'warning' : 'error'} />}{on && ck && ck.ok && ck.warn.length > 0 && <Badge label="Check" variant="warning" />}</label>
          {on && c.service === 'instagram' && <div className="pc-place"><span className="fine" id={'post-place-l-' + c.id}>Post to</span><div className="seg" role="radiogroup" aria-labelledby={'post-place-l-' + c.id} id={'post-place-' + c.id}>
            {[['reel', 'Reels'], ['feed', 'Feed']].map(([v, l]) => <button key={v} type="button" role="radio" data-place={v} aria-checked={(place[c.id] || 'reel') === v} onClick={() => setPlace(p => ({ ...p, [c.id]: v }))}>{l}</button>)}</div>
            <span className="fine pc-file" title={place[c.id] === 'feed' ? (feedFile && !feedFile.missing ? name(feedFile.file) : undefined) : name(reel)}>{place[c.id] === 'feed' ? (feedFile && !feedFile.missing ? 'Gets the 4:5 version' : 'Needs the 4:5 version.') : 'Gets the 9:16 version'}</span>
            {needsFeed(c) && <Button id={c.id === (toFeed[0] || {}).id ? 'post-make-feed' : undefined} size="sm" variant="primary" label="Make it" aria-label={st.makeFeed || 'Make the 4:5 version for the Feed'} isLoading={making || taskRunning} isDisabled={taskRunning} onClick={makeFeed} />}</div>}
          {on && ck && !needsFeed(c) && (ck.block.length > 0 || ck.warn.length > 0) && <p className="fine pc-why">{[...ck.block, ...ck.warn].join(' ')}</p>}
        </li>; })}</ul>}
      </div>
      <div className="glass-card post-card" id="post-caption">
        <label className="col"><span className="lbl">Caption</span><textarea id="post-caption-in" rows={4} value={caption} placeholder="What the post says. One caption for every channel; change one channel's below." onChange={e => setCaption(e.target.value)} /></label>
        <p className={'fine' + (len(caption) > limit ? ' over' : '')} id="post-caption-count">{len(caption)}{limit < Infinity ? ` / ${limit} (the shortest limit you picked)` : ''}</p>
        {picked.length > 0 && <Fold id="post-per-channel" title="Per-channel options">
          {services.has('youtube') && <div className="post-fields"><label className="col"><span className="lbl">YouTube title</span><input id="post-yt-title" maxLength={100} value={ytTitle} placeholder="Empty uses the caption's first line" onChange={e => setYtTitle(e.target.value)} /></label>
            <label className="col"><span className="lbl">YouTube category</span><select id="post-yt-cat" value={ytCat} onChange={e => setYtCat(e.target.value)}>{Object.entries(st.categories).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label></div>}
          {services.has('instagram') && <Toggle id="post-ig-feed" label="Instagram: also show the Reel in the feed" checked={feed} onChange={setFeed} />}
          {picked.map(c => <label key={c.id} className="col"><span className="lbl">Caption for {c.name} ({SERVICE[c.service] || c.service})</span>
            <textarea rows={2} id={'post-own-' + c.id} value={own[c.id] != null ? own[c.id] : ''} placeholder="Empty uses the caption above" onChange={e => setOwn(o => ({ ...o, [c.id]: e.target.value || null }))} /></label>)}
        </Fold>}
      </div>
      <div className="row post-nav"><Button id="post-back-connect" variant="ghost" label="Connect" icon={<Icon n="left" />} onClick={() => setPart('connect')} /><Button id="post-next-send" variant="primary" label="Next: send" isDisabled={!picked.length} endContent={<Icon n="right" />} onClick={() => setPart('send')} /></div>
    </>}
    {part === 'send' && <>
      <div className="glass-card post-card" id="post-send">
        <h3 className="lbl">How it goes to Buffer</h3>
        <SegmentedControl label="Send as" value={mode} onChange={v => { setMode(v); setConfirm(false); }} size="sm">
          <SegmentedControlItem value="draft" label="Drafts" /><SegmentedControlItem value="queue" label="Queue" /><SegmentedControlItem value="schedule" label="Schedule" /><SegmentedControlItem value="now" label="Post now" />
        </SegmentedControl>
        <p className="fine" id="post-mode-note">{mode === 'draft' ? 'Saved as drafts in Buffer. Nothing is published until you schedule them there.' : mode === 'queue' ? 'Added to each channel\'s next open slot in your Buffer schedule.' : mode === 'schedule' ? 'Published at the time you pick, on every channel.' : 'Published on every channel as soon as Buffer gets it.'}</p>
        {mode === 'schedule' && <label className="col"><span className="lbl">Date and time (your time zone)</span><input type="datetime-local" id="post-due" value={due} onChange={e => setDue(e.target.value)} /></label>}
        {mode === 'now' && <label className="post-confirm"><input type="checkbox" id="post-confirm-now" checked={confirm} onChange={e => setConfirm(e.target.checked)} /> Yes, publish this now on {picked.length} channel{picked.length === 1 ? '' : 's'}</label>}
        {host === 'url' && <label className="col"><span className="lbl">Public link to the MP4</span><input id="post-url" type="url" spellCheck="false" placeholder="https://..." value={url} onChange={e => setUrl(e.target.value)} /><small className="fine">Not Dropbox or Google Drive. It has to stay up until every post has gone out.</small></label>}
        {host === 'url' && toFeed.length > 0 && <label className="col"><span className="lbl">Public link to the 4:5 MP4, for the Feed</span><input id="post-feed-url" type="url" spellCheck="false" placeholder="https://..." value={feedUrl} onChange={e => setFeedUrl(e.target.value)} /></label>}
        <p className="fine" id="post-summary">{toFeed.length > 0 && !feedMissing ? `${name(feedFile.file)} to the Instagram Feed, ${name(reel)} everywhere else: ` : `${name(reel)} to `}{picked.length - blocked.length} channel{picked.length - blocked.length === 1 ? '' : 's'}{blocked.length ? ` (${blocked.length} skipped: too long or over a limit)` : ''}, hosted on {HOSTS.find(h => h[0] === host)[1]}.</p>
        <div className="row"><Button id="post-send-go" size="lg" variant="primary" label={MODE_LABEL[mode]} isDisabled={!canSend} isLoading={job && job.status === 'running'} onClick={send} />{job && job.status === 'running' && <span className="fine" role="status" id="post-phase">{PHASE[job.phase] || job.phase}</span>}</div>
        {job && job.status === 'failed' && <p className="fine kr-res" role="alert" id="post-error">{job.error}</p>}
      </div>
      {result && <div className="glass-card post-card" id="post-result" role="status">
        <h3 className="lbl">{result.sent ? `Sent to ${result.sent} channel${result.sent === 1 ? '' : 's'}${result.mode === 'draft' ? ' as drafts' : ''}` : 'Nothing was sent'}</h3>
        <ul className="post-res-list">{result.results.map(r => <li key={r.channelId} data-id={r.channelId} className={r.ok ? 'ok' : 'bad'}><Icon n={r.ok ? 'check' : 'x'} /><b>{r.name}</b><span className="fine">{r.ok ? `${r.placement === 'feed' ? 'Feed, ' + name(r.file) + ', ' : ''}${r.status || 'created'}${r.dueAt ? ', ' + new Date(r.dueAt).toLocaleString() : ''}` : r.error}</span></li>)}</ul>
        <p className="fine">{result.keepLink} <a href={result.review} target="_blank" rel="noreferrer">Review in Buffer</a></p>
      </div>}
      <div className="row post-nav"><Button id="post-back-channels" variant="ghost" label="Channels" icon={<Icon n="left" />} onClick={() => setPart('channels')} /></div>
    </>}
  </div>;
}
