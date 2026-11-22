#!/usr/bin/env python3
"""Cut accuracy on real speech, measured on the audio alone (independent of kit/cutpoints.cjs, numpy and scipy only).

  python3 tests/cut-accuracy/measure.py <audio or video> <words.json> <cuts.json> [<report.json>]

words.json: [[start, end, word], ...] (or a Studio transcript with "words") on the same clock as the cuts.
cuts.json:  [{ "path", "label", "a", "b" }] in seconds. For each edge:
  mid-word   the edge sits inside a Whisper word (30 ms in from either end) AND the audio is sounding within 12 ms
  onset pad  cut-in to the first sounding frame after it (negative: speech was already running)
  tail pad   last sounding frame before the cut-out to the cut (negative: speech still running)
  end->next  a cut-out to the next sound after it (reported only: that sound is not in the piece)
  pause>0.6  quiet runs over 0.6 s left inside a range (reported only; for the tighten path a pause it should have cut)
Sounding: the whole band or 3.5 to 12 kHz (so s, f and th tails count) 12 dB over its own floor, the 10th percentile
over 4 s. Acceptance: 0 mid-word edges, every onset pad >= 60 ms, every tail pad >= 120 ms. Exit 1 when it fails."""
import json, subprocess, sys
from collections import defaultdict
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.ndimage import percentile_filter

LEAD, TAIL = 0.06, 0.12

def load_audio(path, sr=32000):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64), sr

def main():
    src, words_f, cuts_f = sys.argv[1:4]
    out_f = sys.argv[4] if len(sys.argv) > 4 else None
    x, sr = load_audio(src)
    hop, win = int(sr * 0.005), int(sr * 0.02)
    def env(sig):
        n = (len(sig) - win) // hop
        idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
        return 10 * np.log10((sig[idx] ** 2).mean(1) + 1e-12)
    hb = sosfilt(butter(4, [3500, min(12000, sr / 2 - 100)], "bandpass", fs=sr, output="sos"), x)
    E, H = env(x), env(hb)
    fE = percentile_filter(E, 10, size=801); fH = percentile_filter(H, 10, size=801)
    act = (E > fE + 12) | (H > fH + 12)
    t_of = lambda i: i * hop / sr + win / sr / 2
    i_of = lambda t: int(max(0, min(len(act) - 1, round((t - win / sr / 2) * sr / hop))))
    W = json.load(open(words_f, encoding="utf-8"))
    W = W["words"] if isinstance(W, dict) else W
    def in_word(t):
        for w in W:
            if w[0] + 0.03 < t < w[1] - 0.03:
                return w
        return None
    def active(t, r=0.012):
        return bool(act[i_of(t - r):i_of(t + r) + 1].any())
    def onset_pad(a):
        i = i_of(a)
        if act[i]:
            j = i
            while j > 0 and act[j - 1]: j -= 1
            return -(a - t_of(j))
        j = i
        while j < len(act) - 1 and not act[j]: j += 1
        return t_of(j) - a
    def tail_pad(b):
        i = i_of(b)
        if act[i]:
            j = i
            while j < len(act) - 1 and act[j + 1]: j += 1
            return -(t_of(j) - b)
        j = i
        while j > 0 and not act[j]: j -= 1
        return b - t_of(j)
    def next_pad(b):  # an end cut to the next sound after it (the next word or a breath; not in the piece)
        i = i_of(b)
        j = i
        while j < len(act) - 1 and not act[j]: j += 1
        return t_of(j) - b if not act[i] else 0.0
    def long_quiet(a, b, over=0.6):  # quiet runs over `over` s strictly between the first and last sound in [a, b]
        i0, i1 = i_of(a), i_of(b); seg = act[i0:i1 + 1]; on = np.flatnonzero(seg)
        if len(on) < 2: return []
        out, run = [], 0
        for v in seg[on[0]:on[-1] + 1]:
            if v:
                if run * hop / sr > over: out.append(round(run * hop / sr, 2))
                run = 0
            else: run += 1
        return out
    C = json.load(open(cuts_f, encoding="utf-8")); rows = []
    for c in C:
        a, b = c["a"], c["b"]
        wa, wb = in_word(a), in_word(b)
        rows.append({**c, "in_mid_word": bool(wa and active(a)), "out_mid_word": bool(wb and active(b)), "in_word": wa[2] if wa else None,
                     "out_word": wb[2] if wb else None, "onset_pad": round(onset_pad(a), 3), "tail_pad": round(tail_pad(b), 3), "next_pad": round(next_pad(b), 3), "long_pauses": long_quiet(a, b)})
    g = defaultdict(list)
    for r in rows: g[r["path"]].append(r)
    summary, ok = [], True
    print(f"{'path':34s} {'ranges':>6s} {'mid-word':>8s} {'lead<60ms':>9s} {'tail<120ms':>10s} {'min lead':>8s} {'med lead':>8s} {'min tail':>8s} {'med tail':>8s} {'end->next<60':>12s} {'pause>0.6s':>10s}")
    for p, rs in g.items():
        on = np.array([r["onset_pad"] for r in rs]); tl = np.array([r["tail_pad"] for r in rs])
        mid = sum(r["in_mid_word"] + r["out_mid_word"] for r in rs)
        s = {"path": p, "ranges": len(rs), "edges": 2 * len(rs), "mid_word": int(mid), "lead_short": int((on < LEAD).sum()), "tail_short": int((tl < TAIL).sum()),
             "min_lead_ms": int(round(on.min() * 1000)), "median_lead_ms": int(round(np.median(on) * 1000)), "min_tail_ms": int(round(tl.min() * 1000)), "median_tail_ms": int(round(np.median(tl) * 1000)),
             "end_near_next": int(sum(1 for r in rs if r["next_pad"] < LEAD)),
             "pauses_over_600ms": int(sum(len(r["long_pauses"]) for r in rs)), "pause_seconds_over_600ms": round(float(sum(sum(r["long_pauses"]) for r in rs)), 2)}
        summary.append(s); ok = ok and not (s["mid_word"] or s["lead_short"] or s["tail_short"])
        print(f"{p:34s} {s['ranges']:6d} {s['mid_word']:8d} {s['lead_short']:9d} {s['tail_short']:10d} {s['min_lead_ms']:8d} {s['median_lead_ms']:8d} {s['min_tail_ms']:8d} {s['median_tail_ms']:8d} {s['end_near_next']:12d} {s['pauses_over_600ms']:10d}")
    tot = {k: sum(s[k] for s in summary) for k in ("ranges", "edges", "mid_word", "lead_short", "tail_short")}
    print(f"{'all paths':34s} {tot['ranges']:6d} {tot['mid_word']:8d} {tot['lead_short']:9d} {tot['tail_short']:10d}   ({tot['mid_word']} of {tot['edges']} edges mid-word)")
    print("PASS" if ok else "FAIL", f"(0 mid-word edges, every lead-in >= {int(LEAD * 1000)} ms, every tail >= {int(TAIL * 1000)} ms)")
    if out_f:
        json.dump({"pass": ok, "total": tot, "paths": summary, "edges": rows}, open(out_f, "w"), indent=1)
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
