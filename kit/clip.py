# clip.py: turn raw talking-head footage into clean, transcribed clips that drop into cut.json.
#
#   python3 kit/clip.py raw.mp4 [--out clips] [--model small.en] [--vertical] [--cropx 0.5] [--min 3.0]
#   (default small.en: fast on a CPU, ~460 MB once. --model large-v3 is the most accurate and slow, a ~3 GB download once)
#   python3 kit/clip.py take1.mov take2.mov take3.mov --out clips --vertical [--hook take3.mov]   (several takes)
#   python3 kit/clip.py a.mp4 b.mp4 --whole      (clips that are already cut: one clip per file, in the order given)
#   --order auto|files|script (several files: "script" = takes of one script, best take per sentence; "files" = different
#   clips, kept in the order given; auto picks from how many sentences the files share)
#   --encoder auto|x264|nvenc|qsv|amf|videotoolbox  --jobs N (clips encoded at once; 0 = about half the CPU cores)
#
# What it does
#   1. Transcribes each file with word timestamps (faster-whisper). --words words.json reuses word times you already
#      have (kit/tx.py format, keyed by file name) and skips Whisper.
#   2. Splits it into sentences, then merges short sentences with a neighbour until every clip is at least --min s
#      (Will 10-12: no clips of about 3 s or less; they read as jumpy).
#   3. Marks retakes inside a file: when a later sentence (within 150 s) says most of the same thing, the earlier one is
#      the flubbed take. "Most" means at least half of the earlier sentence's 4-word phrases come back (phrases made
#      of common words such as "we know how to" do not count), or 60% the same words in order; a long line is never a
#      retake of a much shorter one. Its status is "retake" and the later one is "keep". Nothing is deleted; you choose.
#      A line under 1 s on its own, or one that ends on a cut-off word ("thi-"), is marked "fragment".
#   3b. Several takes: the same sentence said in more than one file (a shared 4-word phrase, or 60% the same words in
#      order) is one "slot". Every candidate is scored
#      (Whisper word confidence, complete wording, no repeated words or fillers like "um"), the best is "keep" and the
#      rest are "retake (see clip-NNN)". Slots keep script order: a sentence only one take has goes after the last
#      sentence that take shared, so separate takes per beat and full repeat takes both come out in order.
#      --hook <file> picks the first sentence from that take when it has one (film the hook on your most extreme
#      angle and name that file). Each clip records its "take" (source file).
#   4. Sets each clip's ends from the AUDIO through kit/cutpoints.cjs, the one cut-point module every Studio path
#      uses. A word counts as sounding when its level OR the 3.5 to 12 kHz band is 12 dB over the room, so a soft
#      "s" is not read as silence. The head starts at least 70 ms (target 110 ms) before the first word sounds (--lead),
#      the tail at least 130 ms (target 180 ms) after the last sound (--hold), never running into the next line. With
#      no pause to cut in, the piece runs on to the next pause (up to 2 s) instead of cutting a word (needs node on PATH).
#      A piece under 0.5 s (often the end of a word Whisper wrote twice, "more.") is joined to the line before it.
#      Several files that are already cut (each starts and ends on speech and runs under a minute) are used whole.
#   5. Writes clips.json and clips.md (id, take, source in/out, duration, text, status) as soon as the lines are known,
#      with "pending": true until the clips exist, so picking can start while they encode. Then exports
#      clips/clip-NNN.mp4 (H.264 CRF 16, voice normalised to -16 LUFS; with --vertical, center-cropped to 1080x1920 at
#      --cropx), several at once and on a hardware encoder when one works, printing "progress clips N/M" lines. Last,
#      clips-sheet.png (first and last frame of every clip, 20 clips a page: clips-sheet-2.png and on for more).
#
# Then pick clips into cut.json: {"file":"../clips/clip-004.mp4","in":0,"out":<duration>} and assemble.
import sys, os, json, re, subprocess, argparse
try:
    sys.stdout.reconfigure(line_buffering=True)   # progress lines reach Studio as they happen
except Exception:
    pass

ap = argparse.ArgumentParser()
ap.add_argument("src", nargs="+")
ap.add_argument("--out", default="clips")
ap.add_argument("--model", default=os.environ.get("TX_MODEL", "small.en"))
ap.add_argument("--words", default=None, help="reuse word times (tx.py words.json) instead of running Whisper")
ap.add_argument("--hook", default=None, help="take to use for the first sentence when it has one")
ap.add_argument("--vertical", action="store_true")
ap.add_argument("--cropx", type=float, default=0.5)
ap.add_argument("--min", type=float, default=3.0)
ap.add_argument("--lead", type=float, default=None, help="seconds of quiet before the first sound (default 0.11, at least 0.07)")
ap.add_argument("--hold", type=float, default=None, help="seconds kept after the last sound (default 0.18, at least 0.13)")
ap.add_argument("--plan-only", action="store_true", help="write clips.json and clips.md, encode nothing (the cut bench)")
ap.add_argument("--whole", action="store_true", help="each file is already one clip: no splitting, no retakes, order kept")
ap.add_argument("--order", choices=["auto", "files", "script"], default="auto")
ap.add_argument("--encoder", default=os.environ.get("CLIP_ENCODER", "auto"))
ap.add_argument("--jobs", type=int, default=0)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
MULTI = len(a.src) > 1

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")

# cut points come from the kit's one cut-point module (kit/cutpoints.cjs), the same one Studio's Cut step, Lines,
# bites and tighten use: Whisper words plus the audio (whole band and the s, f, th band), never mid-word
CUTPOINTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cutpoints.cjs")
def snap(src, words, ranges):
    import tempfile
    opts = {}
    if a.lead is not None: opts["leadTarget"] = max(0.07, a.lead)
    if a.hold is not None: opts["tailTarget"] = max(0.13, a.hold)
    fd, tmp = tempfile.mkstemp(suffix=".json"); os.close(fd)
    try:
        json.dump({"words": [[w["s"], w["e"], w["w"]] for w in words], "ranges": ranges, "opts": opts}, open(tmp, "w", encoding="utf-8"))
        r = run([os.environ.get("NODE", "node"), CUTPOINTS, "snap", src, tmp])
    finally:
        os.remove(tmp)
    if r.returncode:
        sys.exit("cut points (kit/cutpoints.cjs): " + (r.stderr or r.stdout or "failed").strip()[-300:])
    return json.loads(r.stdout)

# 1. words, per take
model = None
given = json.load(open(a.words, encoding="utf-8")) if a.words else None
# the same Whisper settings as Studio's transcript (kit/studio/tx_chunks.py): voice activity detection on, so a long
# pause never becomes one 12 s word that hides a sentence break
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "studio"))
from tx_chunks import VAD
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
    segs, _ = model.transcribe(src, language="en", word_timestamps=True, vad_filter=True, vad_parameters=VAD, condition_on_previous_text=False, initial_prompt=os.environ.get("TX_PROMPT") or None)
    return [{"s": w.start, "e": w.end, "w": w.word.strip(), "p": float(getattr(w, "probability", 0.9) or 0.9)} for g in segs for w in g.words if w.word.strip()]

norm = lambda s: [re.sub(r"[^a-z0-9']", "", x["w"].lower()) for x in s]
grams = lambda ws: {" ".join(ws[k:k + 4]) for k in range(max(0, len(ws) - 3))}
FILLERS = {"um", "uh", "erm", "er", "uhm", "hmm", "like"}
# common words: a 4-word phrase with three or more of these ("we know how to", "and then you can") says nothing about
# whether two lines are the same line, so it never makes a retake
COMMON = set("""a an the and or but so if then than that this these those it its it's is are was were be been am do does did
done have has had i i'm i've we we're you you're your they he she my our me us to of in on at for with from by as
just know how what when where who why can could will would should not don't no yes all get got go going like um uh
yeah okay ok right well really very there here about out up one thing things way""".split())
def strong(ws):
    return {g for g in grams(ws) if sum(1 for x in g.split() if x in COMMON) < 3}
from difflib import SequenceMatcher
def same_line(x, y):
    # does line y say most of line x? Half of x's 4-word phrases (not the common-word ones) come back in y, or 60% the
    # same words in order with most of x's own words ("execute", "systems") in y too
    gx = strong(x)
    if gx and len(gx & strong(y)) / len(gx) >= 0.5:
        return True
    own = [w for w in x if w and w not in COMMON]
    return (min(len(x), len(y)) >= 4 and bool(own) and sum(1 for w in own if w in y) / len(own) >= 0.6
            and SequenceMatcher(None, x, y).ratio() >= 0.6)
def retake_pair(x, y):
    # is earlier line x a flubbed try of later line y? Most of x has to come back in y, and x is not much longer than y.
    if len(x) < 4 or len(x) > 1.5 * len(y) + 3:
        return False
    return same_line(x, y)
def precut(words, dur):
    # looks already cut: starts and ends on speech and runs under a minute (used whole when several different clips
    # are loaded, see MODE below)
    return dur <= 60 and words[0]["s"] <= 0.6 and dur - words[-1]["e"] <= 1.0

takes = []
for ti, src in enumerate(a.src):
    dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).stdout.strip())
    words = words_of(src)
    if not words:
        print(f"{src}: no speech found, skipped"); continue
    words = [w for w in words if w["e"] >= w["s"]]
    # 2. sentences
    sents, cur = [], []
    for wi, w in enumerate(words):
        cur.append(w)
        # a sentence ends on . ? ! or on a cut-off word ("thi-", "so...") with a pause after it
        nxt = words[wi + 1]["s"] if wi + 1 < len(words) else dur
        if re.search(r"[.?!]$", w["w"]) or (re.search(r"(-|\u2014|\u2013|\u2026)$", w["w"]) and nxt - w["e"] > 0.5):
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
            if retake_pair(norm(sents[i]), norm(sents[j])):
                status[i], retake_of[i] = "retake", (ti, j); break
    # a short lead-in ("All right, welcome back.") that runs straight into a flubbed sentence is part of that take
    for i in range(len(sents) - 2, -1, -1):
        if status[i] == "keep" and len(sents[i]) <= 5 and status[i + 1] == "retake" and sents[i + 1][0]["s"] - sents[i][-1]["e"] < 1.0:
            status[i], retake_of[i] = "retake", retake_of[i + 1]
    takes.append({"src": src, "dur": dur, "words": words, "sents": sents, "status": status, "retake_of": retake_of, "G": G,
                  "precut": precut(words, dur), "whole": a.whole})
if not takes:
    sys.exit("no speech found")

# 3b. across takes: one slot per sentence, the best candidate keeps it
def score(sent):
    ws = norm(sent)
    conf = sum(w["p"] for w in sent) / len(sent)
    rep = sum(1 for i in range(1, len(ws)) if ws[i] and ws[i] == ws[i - 1])
    fill = sum(1 for x in ws if x in FILLERS)
    return conf - 0.15 * rep - 0.1 * fill + 0.02 * min(len(ws), 30)
def similar(x, y):
    # same sentence, reworded or stumbled: 4-gram overlap catches most, word-sequence similarity the rest
    return x == y or (min(len(x), len(y)) >= 3 and SequenceMatcher(None, x, y).ratio() >= 0.6)
order = []  # (take, sent) in output order
def shared_rate():
    # how many sentences of the later files are also said in an earlier file: takes of one script share most
    hits = tot = 0
    for ti in range(1, len(takes)):
        for sent in takes[ti]["sents"]:
            if len(sent) < 3:
                continue
            tot += 1
            x = norm(sent)
            if any(same_line(x, norm(o)) for tj in range(ti) for o in takes[tj]["sents"]):
                hits += 1
    return hits / tot if tot else 0.0
MODE = "script" if MULTI and a.order == "script" else "files" if (not MULTI or a.order == "files" or a.whole) else ("script" if shared_rate() >= 0.5 else "files")
if MULTI and MODE == "files":
    for T in takes:
        T["whole"] = T["whole"] or T["precut"]
if MULTI:
    print(f"{len(takes)} files: " + ("takes of one script, best take per sentence" if MODE == "script" else "different clips, kept in the order given"), flush=True)
if MODE == "files":
    # different clips (or one file): every file in the order given, its lines in spoken order; flubs inside a file stay
    # right before the line that replaced them
    order = [(ti, si) for ti, T in enumerate(takes) for si in range(len(T["sents"]))]
    rest = []
elif MULTI:
    slots, ptr = [], {}
    for ti, T in enumerate(takes):
        p = -1
        for si, sent in enumerate(T["sents"]):
            if T["status"][si] != "keep":
                continue
            g = strong(norm(sent))
            same = lambda c: (len(sent) >= 4 and g and len(g & strong(norm(takes[c[0]]["sents"][c[1]]))) / len(g) >= 0.5) or similar(norm(sent), norm(takes[c[0]]["sents"][c[1]]))
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

# merge short kept sentences forward (same take, back to back, gap < 1.2 s) until >= --min
groups, i = [], 0
seq = order
if MULTI and MODE == "script":
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
    if T["whole"]:
        # a clip that is already cut: all of it, as it is
        n = len(T["sents"])
        groups.append({"take": ti, "sents": list(range(n)), "status": "keep", "sent": (ti, n - 1), "whole": True})
        i += 1
        while i < len(seq) and seq[i][0] == ti:
            i += 1
        continue
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
# a piece under 0.5 s of speech is never a clip of its own: it joins the line just before it in the same file (a soft
# word end read as silence, or Whisper writing the end of a word twice, "anymore." then "more.")
speech = lambda g: takes[g["take"]]["sents"][g["sents"][-1]][-1]["e"] - takes[g["take"]]["sents"][g["sents"][0]][0]["s"]
k = 1
while k < len(groups):
    g, p = groups[k], groups[k - 1]
    T = takes[g["take"]]
    if (not g.get("whole") and not p.get("whole") and speech(g) < 0.5 and g["take"] == p["take"] and g["sents"][0] == p["sents"][-1] + 1
            and T["sents"][g["sents"][0]][0]["s"] - T["sents"][p["sents"][-1]][-1]["e"] < 1.2):
        p["sents"] += g["sents"]; p["sent"] = g["sent"]; groups.pop(k)
    else:
        k += 1
def clip_of(c):
    if c is None: return None
    ti, si = c
    while (ti, si) not in sent2clip and si < len(takes[ti]["sents"]):
        si += 1
    return sent2clip.get((ti, si))

# 4. clip ends from the audio (kit/cutpoints.cjs), every clip of a take in one call. Two clips back to back in one
#    take with no pause between them to cut in (the end had to move past the next clip's first word) are one clip.
def ends():
    while True:
        cut = {}
        for ti, T in enumerate(takes):
            ks = [k for k, g in enumerate(groups) if g["take"] == ti and not g.get("whole")]
            if not ks:
                continue
            rs = [[T["sents"][groups[k]["sents"][0]][0]["s"], T["sents"][groups[k]["sents"][-1]][-1]["e"]] for k in ks]
            for k, r in zip(ks, snap(T["src"], T["words"], rs)):
                cut[k] = tuple(r["range"])
        merged = False
        for k in range(len(groups) - 1):
            g, h = groups[k], groups[k + 1]
            if (k in cut and k + 1 in cut and g["take"] == h["take"] and h["sents"][0] == g["sents"][-1] + 1 and g["status"] == h["status"]
                    and cut[k][1] > cut[k + 1][0]):
                g["sents"] += h["sents"]; g["sent"] = h["sent"]; groups.pop(k + 1); merged = True
                break
        if not merged:
            return cut
CUTS = ends()
sent2clip = {}
for k, g in enumerate(groups):
    for si in g["sents"]:
        sent2clip[(g["take"], si)] = k

# 4 + 5. ends from audio, then clips.json and clips.md right away (picking can start while the clips encode), then export
CUTOFF = re.compile(r"(-|\u2014|\u2013|\.\.\.|\u2026)$")
out, md, jobs = [], ["| id | take | src in-out | dur | status | text |", "|---|---|---|---|---|---|"], []
for k, g in enumerate(groups):
    T = takes[g["take"]]; S = T["sents"]; first, last = g["sents"][0], g["sents"][-1]
    ws = [w for si in g["sents"] for w in S[si]]
    s, e = (0.0, T["dur"]) if g.get("whole") else (max(0.0, CUTS[k][0]), min(T["dur"], CUTS[k][1]))
    d = round(e - s, 3)
    text = " ".join(w["w"] for w in ws)
    st = g["status"]
    # a fragment: under 1 s of speech on its own, or a line that ends on a cut-off word ("thi-", "so...")
    if st == "keep" and not g.get("whole") and (ws[-1]["e"] - ws[0]["s"] < 1.0 or CUTOFF.search(ws[-1]["w"])):
        st = "fragment"
    flag = st if d >= a.min else (st + ",short")
    if st == "retake":
        ro = clip_of(T["retake_of"][last])
        if ro is not None:
            flag += f"(see clip-{ro + 1:03d})"
    cid = f"clip-{k + 1:03d}"
    rel = [[round(w["s"] - s, 2), round(w["e"] - s, 2), w["w"]] for w in ws]
    take = os.path.basename(T["src"])
    out.append({"id": cid, "file": f"{a.out}/{cid}.mp4", "take": take, "src_in": round(s, 3), "src_out": round(e, 3), "dur": d,
                "status": flag, "score": round(sum(score(S[si]) for si in g["sents"]) / len(g["sents"]), 3), "text": text, "words": rel})
    md.append(f"| {cid} | {take} | {s:.2f}-{e:.2f} | {d:.2f} | {flag} | {text} |")
    jobs.append((cid, T["src"], s, d))
    print(cid, f"{d:5.2f}s", (take[:18] + " ") if MULTI else "", flag.ljust(12), text[:90])

def write_list(pending):
    meta = {"src": a.src[0] if not MULTI else a.src, "takes": [os.path.basename(t["src"]) for t in takes], "order": MODE}
    if pending:
        meta["pending"] = True
    json.dump({**meta, "clips": out}, open(os.path.join(a.out, "clips.json"), "w", encoding="utf-8"), indent=1)
    open(os.path.join(a.out, "clips.md"), "w", encoding="utf-8").write("\n".join(md) + "\n")
write_list(True)
if a.plan_only:
    write_list(False)
    print(f"clips.json and clips.md written ({len(out)} lines); --plan-only, nothing encoded", flush=True)
    sys.exit(0)
print(f"clips.json and clips.md written ({len(out)} lines); encoding the clips now", flush=True)

# export: several clips at once, on a hardware encoder when one works here (it falls back to x264 per clip)
ENC = {"x264": ["-c:v", "libx264", "-crf", "16", "-preset", "medium"],
       "nvenc": ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0"],
       "qsv": ["-c:v", "h264_qsv", "-global_quality", "20"],
       "amf": ["-c:v", "h264_amf", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"],
       "videotoolbox": ["-c:v", "h264_videotoolbox", "-q:v", "65"]}
def pick_encoder(want):
    if want in ("x264", "libx264", "cpu"):
        return "x264"
    tries = [want] if want in ENC else (["videotoolbox"] if sys.platform == "darwin" else ["nvenc", "qsv", "amf"])
    for name in tries:
        r = run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=black:s=320x240:d=0.2", "-frames:v", "3", *ENC[name], "-f", "null", "-"])
        if r.returncode == 0:
            return name
    if want in ENC and want != "x264":
        print(f"note: the {want} encoder does not work here, using x264")
    return "x264"
ENCODER = pick_encoder(a.encoder)
vf = "fps=24,format=yuv420p"
if a.vertical:
    vf = f"scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)*{a.cropx}:(ih-1920)*0.5,setsar=1," + vf
def encode(job):
    cid, src, s, d = job
    def go(enc):
        return run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s:.3f}", "-t", f"{d:.3f}", "-i", src, "-vf", vf,
                    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000", *ENC[enc],
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", os.path.join(a.out, cid + ".mp4")])
    p = go(ENCODER)
    if p.returncode and ENCODER != "x264":
        p = go("x264")
    return cid, p
from concurrent.futures import ThreadPoolExecutor
workers = a.jobs if a.jobs > 0 else max(1, min(4, (os.cpu_count() or 2) // 2))
print(f"encoding {len(jobs)} clips, {workers} at a time ({ENCODER})", flush=True)
done = 0
with ThreadPoolExecutor(max_workers=workers) as ex:
    for cid, p in ex.map(encode, jobs):
        if p.returncode:
            sys.exit(f"{cid}: " + (p.stderr or "ffmpeg failed"))
        done += 1
        print(f"progress clips {done}/{len(jobs)}", flush=True)
write_list(False)

# eye-check sheet: first and last frame of each clip, side by side, one row per clip, 20 clips a page (one ffmpeg call
# with every clip as an input passes the Windows command-line limit on a long recording)
PAGE = 20
def frames(c):
    f = c["file"]; got = []
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
        got.append(t)
    return got
for old in os.listdir(a.out):
    if re.match(r"clips-sheet(-\d+)?\.png$", old):
        os.remove(os.path.join(a.out, old))
sheets = []
for pg in range(0, len(out), PAGE):
    page = out[pg:pg + PAGE]
    tiles = [t for c in page for t in frames(c)]
    ins = sum([["-i", t] for t in tiles], [])
    lay = "|".join([f"0_{'+'.join(['h0'] * r) if r else '0'}|w0_{'+'.join(['h0'] * r) if r else '0'}" for r in range(len(page))])
    name = "clips-sheet.png" if pg == 0 else f"clips-sheet-{pg // PAGE + 1}.png"
    sheet = os.path.join(a.out, name)
    r = run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", f"xstack=inputs={len(tiles)}:layout={lay}:fill=black", sheet])
    if r.returncode or not os.path.exists(sheet):
        print(f"warning: {name} was not written: " + (r.stderr or "").strip()[-300:])
    else:
        sheets.append(name)
    for t in tiles:
        os.remove(t)
print(f"\n{len(out)} clips -> {a.out}/  (clips.json, clips.md, {', '.join(sheets) or 'no sheet'}). Retakes and fragments are marked, not removed."
      + (f" {len(takes)} takes; best take kept per sentence." if MULTI and MODE == "script" else f" {len(takes)} files in the order given." if MULTI else ""))
