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
]


def load():
    src = open(VENDOR, encoding='utf-8').read()
    for old, new in PATCHES:
        if old not in src:
            print(f'warning: runner patch no longer matches upstream, skipped: {old[:60]}', file=sys.stderr)
            continue
        src = src.replace(old, new)
    g = {'__name__': 'fx_vendored', '__file__': VENDOR}
    exec(compile(src, VENDOR, 'exec'), g)
    return g


if __name__ == '__main__':
    try:
        load()['main'](); code = 0
    except SystemExit as e:
        code = e.code if isinstance(e.code, int) else (print(e.code, file=sys.stderr) or 1)
    # MediaPipe's segmenter can raise a harmless error in __del__ at interpreter shutdown; skip it.
    sys.stdout.flush(); sys.stderr.flush(); os._exit(code or 0)
