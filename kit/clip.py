# clip.py: turn raw talking-head footage into clean, transcribed clips that drop into cut.json.
#
#   python3 kit/clip.py raw.mp4 [--out clips] [--model large-v3] [--vertical] [--cropx 0.5] [--min 3.0]
#
# What it does
#   1. Transcribes the raw file with word timestamps (faster-whisper).
#   2. Splits it into sentences, then merges short sentences with a neighbour until every clip is at least --min s
#      (Will 10-12: no clips of about 3 s or less; they read as jumpy).
#   3. Marks retakes: when two sentences start with the same three words, the earlier one is the flubbed take.
#      Its status is "retake" and the later one is "keep". Nothing is deleted; you choose.
#   4. Sets each clip's ends from the AUDIO, not the word stamps. The head starts in the silence just before the
#      first word (a few frames of lead, never dead air, never mid-sentence). The tail ends when the voice stops
#      plus a short hold, never running into the next line.
#   5. Exports clips/clip-NNN.mp4 (H.264 CRF 16, voice normalised to -16 LUFS; with --vertical, center-cropped to
#      1080x1920 at --cropx), plus clips.json and clips.md (id, source in/out, duration, text, status), plus
#      clips-sheet.png (first and last frame of every clip) for the eye check.
#
# Then pick clips into cut.json: {"file":"../clips/clip-004.mp4","in":0,"out":<duration>} and assemble.
import sys, os, json, re, subprocess, argparse

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("--out", default="clips")
ap.add_argument("--model", default=os.environ.get("TX_MODEL", "large-v3"))
ap.add_argument("--vertical", action="store_true")
ap.add_argument("--cropx", type=float, default=0.5)
ap.add_argument("--min", type=float, default=3.0)
ap.add_argument("--lead", type=float, default=0.12)
ap.add_argument("--hold", type=float, default=0.15)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.src]).stdout.strip())

# 1. words
from faster_whisper import WhisperModel
m = WhisperModel(a.model, device="cpu", compute_type="int8")
segs, _ = m.transcribe(a.src, language="en", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
words = [{"s": w.start, "e": w.end, "w": w.word.strip()} for g in segs for w in g.words if w.word.strip()]
if not words:
    sys.exit("no speech found")

# silence map of the whole file (the audio decides clip ends)
r = run(["ffmpeg", "-v", "info", "-i", a.src, "-vn", "-af", "silencedetect=n=-35dB:d=0.15", "-f", "null", "-"])
starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", r.stderr)]
ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", r.stderr)]
sil = list(zip(starts, ends + [dur] * (len(starts) - len(ends))))

def head(t, prev_end):
    # start inside the silence that ends nearest before t, a few frames before speech resumes
    cands = [e for s, e in sil if e <= t + 0.25 and e >= prev_end]
    speech = max(cands) if cands else t
    return max(prev_end + 0.05, min(t, speech) - a.lead, 0)

def tail(t, next_start):
    # end when the voice stops after the last word, plus a short hold, never into the next line
    cands = [s for s, e in sil if s >= t - 0.3]
    stop = min(cands) if cands else t
    return min(max(t, stop) + a.hold, next_start - 0.05, dur)

# 2. sentences
sents, cur = [], []
for w in words:
    cur.append(w)
    if re.search(r"[.?!]$", w["w"]):
        sents.append(cur); cur = []
if cur: sents.append(cur)
norm = lambda s: [re.sub(r"[^a-z0-9']", "", x["w"].lower()) for x in s]
grams = lambda ws: {" ".join(ws[k:k + 4]) for k in range(max(0, len(ws) - 3))}

# 3. retakes: a later sentence (within 150 s) that repeats any 4-word phrase means the earlier one was the
#    flub. Restarts often reword the opener ("All right, welcome back" vs "What's up? Welcome back") but keep
#    the body ("hopefully you just finished the awakening"), so phrase overlap catches what an opener match misses.
status, retake_of = ["keep"] * len(sents), [None] * len(sents)
G = [grams(norm(s)) for s in sents]
for i in range(len(sents)):
    if len(sents[i]) < 4:
        continue
    for j in range(i + 1, len(sents)):
        if sents[j][0]["s"] - sents[i][0]["s"] > 150:
            break
        if G[i] & G[j]:
            status[i], retake_of[i] = "retake", j; break
# a short lead-in ("All right, welcome back.") that runs straight into a flubbed sentence is part of that take
for i in range(len(sents) - 2, -1, -1):
    if status[i] == "keep" and len(sents[i]) <= 5 and status[i + 1] == "retake" and sents[i + 1][0]["s"] - sents[i][-1]["e"] < 1.0:
        status[i], retake_of[i] = "retake", retake_of[i + 1]

# merge short kept sentences forward (contiguous, gap < 1.2 s) until >= --min
clips, i = [], 0
while i < len(sents):
    group, st = [sents[i]], status[i]
    while st == "keep" and (group[-1][-1]["e"] - group[0][0]["s"]) < a.min and i + 1 < len(sents) \
            and status[i + 1] == "keep" and sents[i + 1][0]["s"] - group[-1][-1]["e"] < 1.2:
        i += 1; group.append(sents[i])
    clips.append({"words": [w for g in group for w in g], "status": st, "sent": i})
    i += 1
# point each retake at the clip holding the take that replaces it
sent2clip = {}
for k, c in enumerate(clips):
    sent2clip[c["sent"]] = k
def clip_of(sidx):
    while sidx not in sent2clip and sidx < len(sents):
        sidx += 1
    return sent2clip.get(sidx)

# 4 + 5. ends from audio, export
out, md = [], ["| id | src in-out | dur | status | text |", "|---|---|---|---|---|"]
for k, c in enumerate(clips):
    prev_end = clips[k - 1]["words"][-1]["e"] if k else 0
    next_start = clips[k + 1]["words"][0]["s"] if k + 1 < len(clips) else dur
    s = head(c["words"][0]["s"], prev_end)
    e = tail(c["words"][-1]["e"], next_start)
    d = round(e - s, 3)
    text = " ".join(w["w"] for w in c["words"])
    flag = c["status"] if d >= a.min else (c["status"] + ",short")
    if c["status"] == "retake":
        ro = clip_of(retake_of[c["sent"]])
        if ro is not None:
            flag += f"(see clip-{ro + 1:03d})"
    cid = f"clip-{k + 1:03d}"
    vf = "fps=24,format=yuv420p"
    if a.vertical:
        vf = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*{a.cropx}:(ih-1920)*0.5,setsar=1," + vf
    p = run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s:.3f}", "-t", f"{d:.3f}", "-i", a.src, "-vf", vf,
             "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", "-c:v", "libx264", "-crf", "16", "-preset", "medium",
             "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", os.path.join(a.out, cid + ".mp4")])
    if p.returncode:
        sys.exit(p.stderr)
    rel = [[round(w["s"] - s, 2), round(w["e"] - s, 2), w["w"]] for w in c["words"]]
    out.append({"id": cid, "file": f"{a.out}/{cid}.mp4", "src_in": round(s, 3), "src_out": round(e, 3), "dur": d,
                "status": flag, "text": text, "words": rel})
    md.append(f"| {cid} | {s:.2f}-{e:.2f} | {d:.2f} | {flag} | {text} |")
    print(cid, f"{d:5.2f}s", flag.ljust(12), text[:90])

json.dump({"src": a.src, "clips": out}, open(os.path.join(a.out, "clips.json"), "w"), indent=1)
open(os.path.join(a.out, "clips.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")

# eye-check sheet: first and last frame of each clip, side by side, one row per clip
tiles = []
for c in out:
    f = c["file"]
    for tag, ss in (("a", "0"), ("b", f"{max(0, c['dur'] - 0.05):.2f}")):
        t = os.path.join(a.out, f"_{c['id']}{tag}.png")
        run(["ffmpeg", "-v", "error", "-y", "-ss", ss, "-i", f, "-frames:v", "1", "-vf", "scale=-2:240", t])
        tiles.append(t)
if tiles:
    ins = sum([["-i", t] for t in tiles], [])
    n = len(out)
    lay = "|".join([f"0_{'+'.join(['h0'] * r) if r else '0'}|w0_{'+'.join(['h0'] * r) if r else '0'}" for r in range(n)])
    run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", f"xstack=inputs={len(tiles)}:layout={lay}:fill=black", os.path.join(a.out, "clips-sheet.png")])
    for t in tiles:
        os.remove(t)
print(f"\n{len(out)} clips -> {a.out}/  (clips.json, clips.md, clips-sheet.png). Retakes are marked, not removed.")
