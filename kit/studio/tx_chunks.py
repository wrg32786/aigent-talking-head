# Word timings for one long take, a chunk at a time, for Studio's footage player and Cut step.
#   python3 kit/studio/tx_chunks.py <video> <out.json> [--chunk 120]
# Prints "progress <done> <total>" after each chunk and saves after each one, so a stopped run picks up where it left
# off. Words are [start, end, word] in seconds of the whole take. TX_MODEL picks the Whisper model (default small.en).
# Voice activity detection is on (VAD), so a long pause never becomes one 12 s word and sentence breaks are found;
# a transcript made before VAD (no "vad" field) is redone once. clip.py reads the same words (one transcript per take).
import json, os, subprocess, sys, tempfile

# the VAD settings every transcript in the kit uses (kit/clip.py imports the same numbers): pauses over 0.7 s are
# skipped, with 0.3 s of padding kept around speech so no soft first or last sound is lost
VAD = {"min_silence_duration_ms": 700, "speech_pad_ms": 300}
VAD_VERSION = 1

def probe(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", f], capture_output=True, text=True)
    return float(json.loads(r.stdout or "{}").get("format", {}).get("duration") or 0)

def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print("usage: tx_chunks.py <video> <out.json> [--chunk 120]"); sys.exit(2)
    src, out = a[0], a[1]
    chunk = float(a[a.index("--chunk") + 1]) if "--chunk" in a else 120.0
    dur = probe(src)
    if dur <= 0:
        print("error: could not read the length of " + src); sys.exit(1)
    n = max(1, int((dur + chunk - 0.001) // chunk))
    model_name = os.environ.get("TX_MODEL", "small.en")
    st = {"file": src, "duration": round(dur, 2), "chunk": chunk, "total": n, "done": [], "words": [], "model": model_name, "vad": VAD_VERSION}
    if os.path.exists(out):
        try:
            old = json.load(open(out, encoding="utf-8"))
            if old.get("chunk") == chunk and old.get("total") == n and old.get("model") == model_name and old.get("vad") == VAD_VERSION: st = old
        except Exception:
            pass
    todo = [k for k in range(n) if k not in st["done"]]
    print(f"progress {len(st['done'])} {n}", flush=True)
    if not todo:
        return
    from faster_whisper import WhisperModel
    m = WhisperModel(model_name, device="cpu", compute_type="int8")
    tmp = tempfile.mkdtemp(prefix="studio-tx-")
    for k in todo:
        t0 = k * chunk
        wav = os.path.join(tmp, f"c{k}.wav")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(t0), "-t", str(chunk), "-i", src, "-vn", "-ac", "1", "-ar", "16000", wav], check=True)
        segs, _ = m.transcribe(wav, language="en", word_timestamps=True, vad_filter=True, vad_parameters=VAD, condition_on_previous_text=False)
        ws = [[round(w.start + t0, 2), round(w.end + t0, 2), w.word.strip()] for g in segs for w in (g.words or []) if w.word.strip()]
        st["words"] = sorted(st["words"] + ws, key=lambda w: w[0])
        st["done"].append(k)
        os.remove(wav)
        json.dump(st, open(out + ".tmp", "w"))
        os.replace(out + ".tmp", out)
        print(f"progress {len(st['done'])} {n}", flush=True)

if __name__ == "__main__":
    main()
