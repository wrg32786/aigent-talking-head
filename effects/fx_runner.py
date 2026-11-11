#!/usr/bin/env python3
"""Run the vendored claude-video-effects fx.py with a few small, named patches applied in memory.

Same CLI as upstream fx.py (python fx_runner.py --plan plan.json in.mp4 out.mp4 [--still 1.2,3.4] / --list).
The vendored file stays byte-for-byte upstream, so `npm run effects:update` stays a clean copy. Patches only
stop upstream demo identity from leaking into a teammate's reel; each one has to match upstream exactly, and
`npm run effects:check` fails loudly if an update breaks one. Fonts and models still load from the vendor folder.
"""
import os, sys

VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor', 'claude-video-effects', 'scripts', 'fx.py')

PATCHES = [
    # headline-wall: the per-card handle was hard-coded to the upstream author's; use the plan's "handle" (blank if none)
    ("""('@vibha.in.progress  ·  ' + meta) if meta else '@vibha.in.progress'""",
     """('  ·  '.join(x for x in (e.o.get('handle', ''), meta) if x))"""),
    # glass-widgets: the "Edited by Claude" pill text was fixed; read "pill" (text|bold part)
    ("""pre, hi = 'Edited by ', 'Claude'""",
     """pre, hi = (e.o.get('pill', 'Edited by |Claude').split('|') + [''])[:2]"""),
    # glass-widgets: skip the pill entirely when "pill" is empty (kit/fx.cjs sends "" unless the plan opts in)
    ("""    show(shadowed(q, 14, 6, 70), W / 2, py, 7, front=True)""",
     """    if pre or hi: show(shadowed(q, 14, 6, 70), W / 2, py, 7, front=True)"""),
    ("""    place(c, shadowed(q, 14, 6, 70), W / 2, py, 0.7 + 0.3 * pop(c, 0.4), 0, al * clamp((c.lt - 0.4) / 0.1), guard=True)""",
     """    if pre or hi: place(c, shadowed(q, 14, 6, 70), W / 2, py, 0.7 + 0.3 * pop(c, 0.4), 0, al * clamp((c.lt - 0.4) / 0.1), guard=True)"""),
    # glass-widgets: the views artifact ("Top reels", "197K" and fixed bars) comes from "chart": "label::value::v1|v2|..."
    ("""def glass_widgets_v2(c, e):""",
     """def _chart(e):
    parts = (str(e.o.get('chart') or 'Stats::::7|6|5|4|3|2|1').split('::') + ['', '', ''])[:3]
    try: vals = [float(x) for x in parts[2].split('|') if x.strip()][:7]
    except ValueError: vals = []
    vals = (vals or [7, 6, 5, 4, 3, 2, 1]) + [0] * (7 - len(vals or [1] * 7))
    return parts[0], parts[1], vals


def glass_widgets_v2(c, e):"""),
    ("""di.text((16 * u, 40 * u), 'Top reels', """, """di.text((16 * u, 40 * u), _chart(e)[0], """),
    ("""di.text((16 * u, 72 * u), '197K', """, """di.text((16 * u, 72 * u), _chart(e)[1], """),
    ("""vals = [197, 140, 124, 83, 50, 40, 38]; """, """vals = _chart(e)[2]; """),
    ("""hh = (ih * 0.42) * v / 197 * q""", """hh = (ih * 0.42) * v / (max(vals) or 1) * q"""),
    ("""'artifact · views.html'""", """e.o.get('chart_tag', 'artifact · stats.html')"""),
    ("""'sfx · 25.7s'""", """e.o.get('song_sub', 'edit')"""),
    # any effect: "face": 0.7 lays it out as if the tracked face were 70% as wide. The effects size and place
    # themselves from the face width, so a tight shot pushes fans, rings and lines off the frame; under 1 pulls them in.
    # any effect: "drop": 0.4 moves everything it draws behind the person down by 0.4 face widths. Upstream sets
    # behind-head words above the head; the point of them is that the head covers part of the word (Will, 2026-11-10),
    # so drop them until it does and read a check frame.
    ("""c.lt = t - f.start; EFFECTS[f.name][0](c, f)""",
     """c.lt = t - f.start; _k = float(f.o.get('face', 1)); c.drop = float(f.o.get('drop', 0)) * c.fw; c.fw *= _k; EFFECTS[f.name][0](c, f); c.fw /= _k; c.drop = 0"""),
    ("""h, w = L.shape[:2]; x, y = int(round(x)), int(round(y))""",
     """h, w = L.shape[:2]; x, y = int(round(x)), int(round(y + (getattr(c, 'drop', 0) if behind else 0)))"""),
    # pastel-word: the profile card sat at a fixed 86.5% of the height, under Instagram's own caption; "card_y" moves it
    ("""cy = H * 0.865 + (1 - ease_out((c.lt - 0.15) / 0.35)) * H * 0.2""",
     """cy = H * float(e.o.get('card_y', 0.865)) + (1 - ease_out((c.lt - 0.15) / 0.35)) * H * 0.2"""),
    # pastel-word: the face guard erased half the card (and its Follow button) when the speaker leans in; "card_guard": "off" keeps it whole
    ("""place(c, shadowed(card_, 18, 8, 90), W / 2, cy, sq, 0, al * clamp((c.lt - 0.15) / 0.12), guard=True)""",
     """place(c, shadowed(card_, 18, 8, 90), W / 2, cy, sq, 0, al * clamp((c.lt - 0.15) / 0.12), guard=str(e.o.get('card_guard', 'on')) != 'off')"""),
    # rabbit-hole: the person mask faded with the tunnel, so for the first 0.4 s and last 0.3 s the tunnelled copies
    # ghosted across the speaker's face. Keep the speaker fully in front; the tunnel still fades in and out behind.
    ("""m = c.m[..., None] * k  # you stay in front while the room tunnels behind you""",
     """m = c.m[..., None]  # you stay in front while the room tunnels behind you"""),
    # the person is tracked and cut out at 540 px wide; FX_TRACK_W raises it so a sharper matte (FX_MATTE) keeps its edge
    ("""aw = 540 if sw <= sh else int(round(540 * sw / sh / 2)) * 2;""",
     """_tw = int(os.environ.get('FX_TRACK_W', 540)); aw = _tw if sw <= sh else int(round(_tw * sw / sh / 2)) * 2;"""),
]


def matte_tracker(g):
    """FX_MATTE=<birefnet | birefnet-portrait>: cut the person out with rembg instead of MediaPipe's selfie segmenter.

    Same matte as the titles get in kit/mask.py: the model, the GPU session and the cleanup (hole fill, speck removal,
    guided edge, flow-guided temporal smoothing, light erode + feather) all come from kit/mask_refine.py.
    Why: the selfie segmenter leaves a ragged fringe round a cap (birefnet-portrait won a five-way side-by-side,
    2026-11-10), and its unsigned DLL is blocked by Windows Smart App Control, while ONNX Runtime loads.
    The raw matte is the slow part (about 1 to 2 s a frame on an Arc GPU), so each one is cached in FX_MATTE_CACHE
    under a hash of the frame's pixels: a re-render only infers frames that changed. Cleanup always runs fresh.
    """
    import hashlib
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'kit'))
    import mask_refine as MR
    from PIL import Image
    cv2, np = g['cv2'], g['np']
    model = os.environ['FX_MATTE']
    if model not in MR.MATTE_MODELS: sys.exit(f"unknown matte model {model!r}; use one of {', '.join(MR.MATTE_MODELS)}")
    cache = os.environ.get('FX_MATTE_CACHE') and os.path.join(os.environ['FX_MATTE_CACHE'], 'matte-' + MR.MATTE_MODELS[model])
    if cache: os.makedirs(cache, exist_ok=True)

    class Tracker:
        def __init__(self, aw, ah):
            self.sess = MR.matte_session(model)
            # the face detector stays at upstream's 540 px: at full size it misses a close face and the layout drifts
            self.k = aw / 540; self.fs = (540, int(round(ah / self.k / 2)) * 2)
            self.fd = cv2.FaceDetectorYN.create(os.path.join(g['ROOT'], 'models', 'yunet.onnx'), '', self.fs, 0.6, 0.3, 20)
            self.state = {'prev_a': None, 'prev_g': None, 'grid': None}; self._prev = None; self.made = self.hit = 0
            print(f'matte: {MR.MATTE_MODELS[model]} on {self.sess.inner_session.get_providers()[0]}, {aw}x{ah}', flush=True)

        @property
        def prev(self): return self._prev

        @prev.setter
        def prev(self, v):   # upstream sets prev = None between effect windows: start the temporal smoothing afresh
            self._prev = v
            if v is None: self.state['prev_a'] = self.state['prev_g'] = None

        def raw(self, rgb):
            f = cache and os.path.join(cache, hashlib.sha1(rgb.tobytes()).hexdigest() + '.png')
            if f and os.path.exists(f): self.hit += 1; return np.asarray(Image.open(f), np.float32) / 255
            a = MR.matte_raw(self.sess, rgb)
            if f: Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)).save(f)
            self.made += 1
            if self.made % 50 == 0: print(f'matte: {self.made} masks made, {self.hit} from cache', flush=True)
            return a

        def __call__(self, rgb, ms):   # same contract as upstream: (uint8 mask, (face x, face y, face width) or None)
            a, _ = MR.refine_frame(self.raw(rgb), rgb, self.state)
            m = np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8); self._prev = m
            _, f = self.fd.detect(cv2.cvtColor(cv2.resize(rgb, self.fs, interpolation=cv2.INTER_AREA), cv2.COLOR_RGB2BGR))
            face = None
            if f is not None and len(f):
                r = max(f, key=lambda r: r[2] * r[3] * r[-1]); face = ((r[0] + r[2] / 2) * self.k, (r[1] + r[3] / 2) * self.k, r[2] * self.k)
            else:   # no face found: estimate it from the top of the matte, as upstream does
                rows = np.where((m > 127).sum(1) > m.shape[1] * 0.01)[0]
                if len(rows):
                    top = rows[0]; band = m[top:top + max(4, int(m.shape[0] * 0.06))] > 127; xs = np.where(band.any(0))[0]
                    fw = max(8.0, (xs.max() - xs.min()) * 0.8); face = (float(xs.mean()), top + fw * 0.7, fw)
            return m, face
    return Tracker


def load():
    src = open(VENDOR, encoding='utf-8').read()
    for old, new in PATCHES:
        if old not in src:
            print(f'warning: runner patch no longer matches upstream, skipped: {old[:60]}', file=sys.stderr)
            continue
        src = src.replace(old, new)
    g = {'__name__': 'fx_vendored', '__file__': VENDOR}
    exec(compile(src, VENDOR, 'exec'), g)
    if os.environ.get('FX_MATTE'): g['Tracker'] = matte_tracker(g)
    else:
        up = g['Tracker']

        def tracker(aw, ah):
            try: return up(aw, ah)
            except OSError as e:
                # Windows Smart App Control blocks MediaPipe's unsigned DLL (WinError 4551); ONNX Runtime still loads,
                # so use the rembg matte, the same fallback kit/mask.py takes for the titles
                print(f'note: MediaPipe could not load ({e}); using birefnet instead', flush=True)
                os.environ['FX_MATTE'] = 'birefnet'
                try: return matte_tracker(g)(aw, ah)
                except ImportError: sys.exit('The birefnet cut-out is not installed. Run: npm run effects:setup -- --birefnet')
        g['Tracker'] = tracker
    return g


if __name__ == '__main__':
    try:
        load()['main'](); code = 0
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (print(e.code, file=sys.stderr) or 1)
    # MediaPipe's segmenter can raise a harmless error in __del__ at interpreter shutdown; skip it.
    sys.stdout.flush(); sys.stderr.flush(); os._exit(code or 0)
