# clip.py: turn raw talking-head footage into clean, transcribed clips that drop into cut.json.
#
#   python3 kit/clip.py raw.mp4 [--out clips] [--model small.en] [--vertical] [--cropx 0.5] [--min 3.0]
#   (default small.en: fast on a CPU, ~460 MB once. --model large-v3 is the most accurate and slow, a ~3 GB download once)
#   python3 kit/clip.py take1.mov take2.mov take3.mov --out clips --vertical [--hook take3.mov]   (several takes)
#
# What it does
#   1. Transcribes each file with word timestamps (faster-whisper). --words words.json reuses word times you already
#      have (kit/tx.py format, keyed by file name) and skips Whisper.
#   2. Splits it into sentences, then merges short sentences with a neighbour until every clip is at least --min s
#      (Will 10-12: no clips of about 3 s or less; they read as jumpy).
#   3. Marks retakes inside a file: when a later sentence repeats a 4-word phrase, the earlier one is the flubbed take.
#      Its status is "retake" and the later one is "keep". Nothing is deleted; you choose.
#   3b. Several takes: the same sentence said in more than one file (a shared 4-word phrase, or 60% the same words in
#      order) is one "slot". Every candidate is scored
#      (Whisper word confidence, complete wording, no repeated words or fillers like "um"), the best is "keep" and the
#      rest are "retake (see clip-NNN)". Slots keep script order: a sentence only one take has goes after the last
#      sentence that take shared, so separate takes per beat and full repeat takes both come out in order.
#      --hook <file> picks the first sentence from that take when it has one (film the hook on your most extreme
#      angle and name that file). Each clip records its "take" (source file).
#   4. Sets each clip's ends from the AUDIO, not the word stamps. The head starts in the silence just before the
#      first word (a few frames of lead, never dead air, never mid-sentence). The tail ends when the voice stops
#      plus a short hold, never running into the next line.
#   5. Exports clips/clip-NNN.mp4 (H.264 CRF 16, voice normalised to -16 LUFS; with --vertical, center-cropped to
#      1080x1920 at --cropx), plus clips.json and clips.md (id, take, source in/out, duration, text, status), plus
#      clips-sheet.png (first and last frame of every clip) for the eye check.
#
# Then pick clips into cut.json: {"file":"../clips/clip-004.mp4","in":0,"out":<duration>} and assemble.
import sys, os, json, re, subprocess, argparse

ap = argparse.ArgumentParser()
ap.add_argument("src", nargs="+")
ap.add_argument("--out", default="clips")
ap.add_argument("--model", default=os.environ.get("TX_MODEL", "small.en"))
ap.add_argument("--words", default=None, help="reuse word times (tx.py words.json) instead of running Whisper")
ap.add_argument("--hook", default=None, help="take to use for the first sentence when it has one")
ap.add_argument("--vertical", action="store_true")
ap.add_argument("--cropx", type=float, default=0.5)
ap.add_argument("--min", type=float, default=3.0)
ap.add_argument("--lead", type=float, default=0.12)
ap.add_argument("--hold", type=float, default=0.15)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
MULTI = len(a.src) > 1

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

# 1. words, per take
model = None
given = json.load(open(a.words, encoding="utf-8")) if a.words else None
# one clear line before a model download (faster-whisper caches models under the Hugging Face hub folder)
SIZES = {"tiny": "75 MB", "base": "145 MB", "small": "460 MB", "medium": "1.5 GB", "large": "3 GB", "distil": "1.5 GB", "turbo": "1.6 GB"}
def notice_download(name):
    if os.path.isdir(name):
        return
    hub = os.environ.get("HF_HUB_CACHE") or os.path.join(os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface"), "hub")
    try:
        cached = any(name.replace(".", "") in d.lower().replace(".", "") and "whisper" in d.lower() for d in os.listdir(hub))
    except OSError:
        cached = False
    if cached:
        return
    size = next((v for k, v in SIZES.items() if name.startswith(k)), "a few hundred MB")
    tip = " For a fast first run use --model small.en." if name.startswith(("large", "medium", "distil", "turbo")) else ""
    print(f"Downloading the Whisper model {name} (about {size}) once; later runs reuse it.{tip}", flush=True)

def words_of(src):
    global model
    if given is not None:
        ws = given.get(os.path.basename(src)) or given.get(src) or []
        return [{"s": w[0], "e": w[1], "w": str(w[2]).strip(), "p": (w[3] if len(w) > 3 else 0.9)} for w in ws if str(w[2]).strip()]
    if model is None:
        from faster_whisper import WhisperModel
        notice_download(a.model)
        model = WhisperModel(a.model, device="cpu", compute_type="int8")
    segs, _ = model.transcribe(src, language="en", word_timestamps=True, vad_filter=False, condition_on_previous_text=False, initial_prompt=os.environ.get("TX_PROMPT") or None)
    return [{"s": w.start, "e": w.end, "w": w.word.strip(), "p": float(getattr(w, "probability", 0.9) or 0.9)} for g in segs for w in g.words if w.word.strip()]

norm = lambda s: [re.sub(r"[^a-z0-9']", "", x["w"].lower()) for x in s]
grams = lambda ws: {" ".join(ws[k:k + 4]) for k in range(max(0, len(ws) - 3))}
FILLERS = {"um", "uh", "erm", "er", "uhm", "hmm", "like"}

takes = []
for ti, src in enumerate(a.src):
    dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).stdout.strip())
    words = words_of(src)
    if not words:
        print(f"{src}: no speech found, skipped"); continue
    # silence map of the whole file (the audio decides clip ends)
    r = run(["ffmpeg", "-v", "info", "-i", src, "-vn", "-af", "silencedetect=n=-35dB:d=0.15", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", r.stderr)]
    sil = list(zip(starts, ends + [dur] * (len(starts) - len(ends))))
    # 2. sentences
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.?!]$", w["w"]):
            sents.append(cur); cur = []
    if cur: sents.append(cur)
    # 3. retakes inside this file: a later sentence (within 150 s) that repeats any 4-word phrase means the earlier
    #    one was the flub. Restarts often reword the opener ("All right, welcome back" vs "What's up? Welcome back") but
    #    keep the body ("hopefully you just finished the awakening"), so phrase overlap catches what an opener match misses.
    status, retake_of = ["keep"] * len(sents), [None] * len(sents)
    G = [grams(norm(s)) for s in sents]
    for i in range(len(sents)):
        if len(sents[i]) < 4:
            continue
        for j in range(i + 1, len(sents)):
            if sents[j][0]["s"] - sents[i][0]["s"] > 150:
                break
            if G[i] & G[j]:
                status[i], retake_of[i] = "retake", (ti, j); break
    # a short lead-in ("All right, welcome back.") that runs straight into a flubbed sentence is part of that take
    for i in range(len(sents) - 2, -1, -1):
        if status[i] == "keep" and len(sents[i]) <= 5 and status[i + 1] == "retake" and sents[i + 1][0]["s"] - sents[i][-1]["e"] < 1.0:
            status[i], retake_of[i] = "retake", retake_of[i + 1]
    takes.append({"src": src, "dur": dur, "sil": sil, "sents": sents, "status": status, "retake_of": retake_of, "G": G})
if not takes:
    sys.exit("no speech found")

# 3b. across takes: one slot per sentence, the best candidate keeps it
def score(sent):
    ws = norm(sent)
    conf = sum(w["p"] for w in sent) / len(sent)
    rep = sum(1 for i in range(1, len(ws)) if ws[i] and ws[i] == ws[i - 1])
    fill = sum(1 for x in ws if x in FILLERS)
    return conf - 0.15 * rep - 0.1 * fill + 0.02 * min(len(ws), 30)
from difflib import SequenceMatcher
def similar(x, y):
    # same sentence, reworded or stumbled: 4-gram overlap catches most, word-sequence similarity the rest
    return x == y or (min(len(x), len(y)) >= 3 and SequenceMatcher(None, x, y).ratio() >= 0.6)
order = []  # (take, sent) in output order
if MULTI:
    slots, ptr = [], {}
    for ti, T in enumerate(takes):
        p = -1
        for si, sent in enumerate(T["sents"]):
            if T["status"][si] != "keep":
                continue
            g = T["G"][si]
            same = lambda c: (len(sent) >= 4 and g & takes[c[0]]["G"][c[1]]) or similar(norm(sent), norm(takes[c[0]]["sents"][c[1]]))
            hit = next((k for k, sl in enumerate(slots) if any(same(c) and c[0] != ti for c in sl)), None)
            if hit is None:
                slots.insert(p + 1, [(ti, si)]); p += 1
            else:
                slots[hit].append((ti, si)); p = hit
    for k, sl in enumerate(slots):
        best = max(sl, key=lambda c: score(takes[c[0]]["sents"][c[1]]))
        if k == 0 and a.hook:
            hk = [c for c in sl if os.path.basename(takes[c[0]]["src"]) == os.path.basename(a.hook)]
            if hk: best = hk[0]
        for c in sl:
            if c != best:
                takes[c[0]]["status"][c[1]], takes[c[0]]["retake_of"][c[1]] = "retake", best
        order.append(best)
    # flubs inside a file and losing candidates are listed right before the take that replaced them
    rest = [(ti, si) for ti, T in enumerate(takes) for si in range(len(T["sents"])) if T["status"][si] != "keep"]
else:
    order = [(0, si) for si in range(len(takes[0]["sents"]))]
    rest = []

# merge short kept sentences forward (same take, back to back, gap < 1.2 s) until >= --min
groups, i = [], 0
seq = order
if MULTI:
    def target(c):
        seen = set()
        while c is not None and takes[c[0]]["status"][c[1]] != "keep" and c not in seen:
            seen.add(c); c = takes[c[0]]["retake_of"][c[1]]
        return c
    pos = {c: k for k, c in enumerate(order)}
    seq = []
    for c in order:
        seq += sorted([r for r in rest if target(r) == c], key=lambda r: (r[0], r[1])) + [c]
    seq += [r for r in rest if target(r) not in pos]
while i < len(seq):
    ti, si = seq[i]; T = takes[ti]; st = T["status"][si]
    group = [si]
    while st == "keep" and i + 1 < len(seq):
        nt, ns = seq[i + 1]
        if nt != ti or ns != group[-1] + 1 or T["status"][ns] != "keep":
            break
        if (T["sents"][group[-1]][-1]["e"] - T["sents"][group[0]][0]["s"]) >= a.min or T["sents"][ns][0]["s"] - T["sents"][group[-1]][-1]["e"] >= 1.2:
            break
        i += 1; group.append(ns)
    groups.append({"take": ti, "sents": group, "status": st, "sent": (ti, group[-1])})
    i += 1
sent2clip = {}
for k, g in enumerate(groups):
    for si in g["sents"]:
        sent2clip[(g["take"], si)] = k
def clip_of(c):
    if c is None: return None
    ti, si = c
    while (ti, si) not in sent2clip and si < len(takes[ti]["sents"]):
        si += 1
    return sent2clip.get((ti, si))

def head(T, t, prev_end):
    # start inside the silence that ends nearest before t, a few frames before speech resumes
    cands = [e for s, e in T["sil"] if e <= t + 0.25 and e >= prev_end]
    speech = max(cands) if cands else t
    return max(prev_end + 0.05, min(t, speech) - a.lead, 0)

def tail(T, t, next_start):
    # end when the voice stops after the last word, plus a short hold, never into the next line
    cands = [s for s, e in T["sil"] if s >= t - 0.3]
    stop = min(cands) if cands else t
    return min(max(t, stop) + a.hold, next_start - 0.05, T["dur"])

# 4 + 5. ends from audio, export
out, md = [], ["| id | take | src in-out | dur | status | text |", "|---|---|---|---|---|---|"]
for k, g in enumerate(groups):
    T = takes[g["take"]]; S = T["sents"]; first, last = g["sents"][0], g["sents"][-1]
    ws = [w for si in g["sents"] for w in S[si]]
    prev_end = S[first - 1][-1]["e"] if first else 0
    next_start = S[last + 1][0]["s"] if last + 1 < len(S) else T["dur"]
    s = head(T, ws[0]["s"], prev_end)
    e = tail(T, ws[-1]["e"], next_start)
    d = round(e - s, 3)
    text = " ".join(w["w"] for w in ws)
    flag = g["status"] if d >= a.min else (g["status"] + ",short")
    if g["status"] == "retake":
        ro = clip_of(T["retake_of"][last])
        if ro is not None:
            flag += f"(see clip-{ro + 1:03d})"
    cid = f"clip-{k + 1:03d}"
    vf = "fps=24,format=yuv420p"
    if a.vertical:
        vf = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*{a.cropx}:(ih-1920)*0.5,setsar=1," + vf
    p = run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s:.3f}", "-t", f"{d:.3f}", "-i", T["src"], "-vf", vf,
             "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-c:v", "libx264", "-crf", "16", "-preset", "medium",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", os.path.join(a.out, cid + ".mp4")])
    if p.returncode:
        sys.exit(p.stderr)
    rel = [[round(w["s"] - s, 2), round(w["e"] - s, 2), w["w"]] for w in ws]
    take = os.path.basename(T["src"])
    out.append({"id": cid, "file": f"{a.out}/{cid}.mp4", "take": take, "src_in": round(s, 3), "src_out": round(e, 3), "dur": d,
                "status": flag, "score": round(sum(score(S[si]) for si in g["sents"]) / len(g["sents"]), 3), "text": text, "words": rel})
    md.append(f"| {cid} | {take} | {s:.2f}-{e:.2f} | {d:.2f} | {flag} | {text} |")
    print(cid, f"{d:5.2f}s", (take[:18] + " ") if MULTI else "", flag.ljust(12), text[:90])

json.dump({"src": a.src[0] if not MULTI else a.src, "takes": [os.path.basename(t["src"]) for t in takes], "clips": out},
          open(os.path.join(a.out, "clips.json"), "w"), indent=1)
open(os.path.join(a.out, "clips.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")

# eye-check sheet: first and last frame of each clip, side by side, one row per clip
tiles = []
for c in out:
    f = c["file"]
    # last frame: decode the final quarter second and keep overwriting (-update 1), so the file ends on the true last
    # frame; a seek to dur-0.05 can land past it and write nothing (pheme 11-18)
    for tag, ss, keep in (("a", ["-ss", "0"], ["-frames:v", "1"]), ("b", ["-sseof", "-0.25"], ["-update", "1"])):
        t = os.path.join(a.out, f"_{c['id']}{tag}.png")
        if os.path.exists(t):
            os.remove(t)
        run(["ffmpeg", "-v", "error", "-y", *ss, "-i", f, *keep, "-vf", "scale=-2:240", t])
        if not (os.path.exists(t) and os.path.getsize(t)):   # e.g. audio outlasts video past the seek window: decode it all
            run(["ffmpeg", "-v", "error", "-y", "-i", f, "-update", "1", "-vf", "scale=-2:240", t])
        if not (os.path.exists(t) and os.path.getsize(t)):
            print(f"warning: no {'first' if tag == 'a' else 'last'} frame from {f}; the sheet shows a black tile")
            run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=426x240", "-frames:v", "1", t])
        tiles.append(t)
if tiles:
    ins = sum([["-i", t] for t in tiles], [])
    n = len(out)
    lay = "|".join([f"0_{'+'.join(['h0'] * r) if r else '0'}|w0_{'+'.join(['h0'] * r) if r else '0'}" for r in range(n)])
    sheet = os.path.join(a.out, "clips-sheet.png")
    r = run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", f"xstack=inputs={len(tiles)}:layout={lay}:fill=black", sheet])
    if r.returncode or not os.path.exists(sheet):
        print("warning: clips-sheet.png was not written: " + (r.stderr or "").strip()[-300:])
    for t in tiles:
        os.remove(t)
print(f"\n{len(out)} clips -> {a.out}/  (clips.json, clips.md, clips-sheet.png). Retakes are marked, not removed."
      + (f" {len(takes)} takes; best take kept per sentence." if MULTI else ""))
