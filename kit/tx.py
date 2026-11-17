# Word timings for each take or clip. Writes words.json keyed by file name.
#   python3 kit/tx.py take1.mp4 take2.mp4 ...   (default: every seg*.mp4 / clip-*.mp4 in the current folder)
#   (Windows: py -3 kit/<script>.py ...)
#   env TX_MODEL=large-v3 for the repeat-word check (catches "build, build"); default small.en is faster.
import sys, json, glob, os
from faster_whisper import WhisperModel
files = sys.argv[1:] or sorted(glob.glob("seg*.mp4") + glob.glob("clip-*.mp4"))
m = WhisperModel(os.environ.get("TX_MODEL", "small.en"), device="cpu", compute_type="int8")
out = {}
for f in files:
    segs, _ = m.transcribe(f, language="en", word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
    out[os.path.basename(f)] = [[round(w.start, 2), round(w.end, 2), w.word.strip()] for g in segs for w in g.words]
    words = [w[2] for w in out[os.path.basename(f)]]
    rep = [words[i] for i in range(1, len(words)) if words[i].lower().strip(",.?!") == words[i-1].lower().strip(",.?!")]
    print(os.path.basename(f), " ".join(words), ("  <<REPEATED: " + ", ".join(rep) + ">>") if rep else "")
json.dump(out, open("words.json", "w"), indent=0)
