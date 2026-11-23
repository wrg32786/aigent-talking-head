// A cover still, post copy and a ZIP beside the finished reel, on Render. Buffer posting stays on Post, drafts only.
import { useEffect, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { NeedFix } from './Fix.jsx';
import { copyText } from './Connect.jsx';
import { api, file, toast } from './lib.jsx';

export function PublishKit({ V, s, apply, hidden }) {
  const pub = V.publish || {}, reels = pub.reels || [];
  const first = reels[0] || null;
  const [reel, setReel] = useState(first && first.reel);
  const kit = reels.find(r => r.reel === reel) || first;
  const copy = (kit && kit.copy) || {};
  const platforms = Object.keys(copy.platforms || { instagram: 1, tiktok: 1, youtube: 1 });
  const [plat, setPlat] = useState('instagram');
  const p = (copy.platforms && copy.platforms[plat]) || copy;
  const [title, setTitle] = useState(copy.title || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (first && !reel) setReel(first.reel); }, [first && first.reel]);
  useEffect(() => { if (copy.title && !title) setTitle(copy.title); }, [copy.title]);
  const running = !!(V.task && V.task.status === 'running');
  const make = () => {
    setBusy(true);
    api('/api/publish', { reel: kit && kit.reel, title }).then(j => { apply(j); toast('Publish kit ready. The ZIP is beside the reel.', true); }).catch(() => {}).finally(() => setBusy(false));
  };
  const saveCopy = () => {
    setBusy(true);
    api('/api/publish/copy', { reel: kit && kit.reel, copy: { title, description: (p && p.description) || copy.description, hashtags: copy.hashtags } }).then(j => { apply(j); toast('Copy saved in the ZIP.', true); }).catch(() => {}).finally(() => setBusy(false));
  };
  if (hidden || !pub.offer) return null;
  return <section className="pub-kit glass-card" id="pub-kit" aria-labelledby="h-pub-kit">
    <header className="sh"><h3 id="h-pub-kit">Publish kit</h3><p className="sub">A cover with the title off your face, post copy for each platform, and a ZIP with the reel and the .srt. Nothing is posted for you.</p></header>
    <NeedFix V={V} ids={['python', 'ffmpeg']} what="Making the cover" apply={apply} />
    <div className="pub-row">
      {kit && kit.cover ? <figure className="pub-cover"><img src={file(kit.cover) + '?v=' + s.rev} alt="Cover still" /><figcaption className="fine">Cover</figcaption></figure> : <div className="pub-cover empty-art"><p className="fine">The cover shows up here.</p></div>}
      <div className="pub-form">
        <label className="fine" htmlFor="pub-title">Title on the cover</label>
        <input id="pub-title" type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={100} disabled={busy || running} />
        <div className="row">
          <Button id="pub-make" variant={kit && kit.ready ? 'secondary' : 'primary'} label={busy ? 'Making' : kit && kit.ready ? 'Make again' : 'Make the kit'} isDisabled={busy || running || !s.job} isLoading={busy} onClick={make} />
          {kit && kit.zip && <a className="btn primary sm" id="pub-zip" href={file(kit.zip) + '?download'} download={kit.zip.split('/').pop()}>Download ZIP</a>}
        </div>
      </div>
    </div>
    {copy.title && <div className="pub-copy" id="pub-copy">
      <div className="seg" role="tablist" aria-label="Platform copy">
        {platforms.map(id => <button type="button" key={id} role="tab" aria-selected={plat === id} data-plat={id} onClick={() => setPlat(id)}>{(copy.platforms[id] && copy.platforms[id].name) || id}</button>)}
      </div>
      {p && <>
        <p className="fine"><b>{p.title || copy.title}</b></p>
        <p className="pub-caption">{p.caption || copy.description}</p>
        <div className="row">
          <Button id="pub-copy-btn" variant="secondary" size="sm" label="Copy caption" onClick={() => copyText(p.caption || '', 'Caption copied')} />
          <Button id="pub-save" variant="ghost" size="sm" label="Save copy" isDisabled={busy} onClick={saveCopy} />
        </div>
      </>}
    </div>}
  </section>;
}
