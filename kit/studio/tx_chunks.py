# Word timings for one long take, a chunk at a time, for Studio's footage player and Cut step.
#   python3 kit/studio/tx_chunks.py <video> <out.json> [--chunk 120]
# Prints "progress <done> <total>" after each chunk and saves after each one, so a stopped run picks up where it left
# off. Words are [start, end, word] in seconds of the whole take. TX_MODEL picks the Whisper model (default small.en;
# base.en or tiny.en when free memory is tight and TX_MODEL is unset).
# Voice activity detection is on (VAD), so a long pause never becomes one 12 s word and sentence breaks are found;
# a transcript made before VAD (no "vad" field) is redone once. clip.py reads the same words (one transcript per take).
import json, os, subprocess, sys, tempfile

def avail_gb():
    """Memory the OS can hand out now, in GB, or None. Kept local so this file does not import OpenCV."""
    try:
        if sys.platform.startswith("linux"):
            for line in open("/proc/meminfo", encoding="utf-8"):
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) / 1048576
        if sys.platform == "win32":
            import ctypes
            class MS(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                            ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong), ("ullTotalVirtual", ctypes.c_ulonglong),
                            ("ullAvailVirtual", ctypes.c_ulonglong), ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MS(); m.dwLength = ctypes.sizeof(MS); ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullAvailPhys / 1073741824
        if sys.platform == "darwin":
            import re
            out = subprocess.run(["vm_stat"], capture_output=True, text=True).stdout
            ps = int(re.search(r"page size of (\d+)", out).group(1))
            pages = sum(int(re.search(k + r":\s+(\d+)", out).group(1)) for k in ("Pages free", "Pages inactive", "Pages speculative"))
            return pages * ps / 1073741824
    except Exception:
        return None
    return None

def pick_tx_model():
    """TX_MODEL when set; otherwise small.en, or a smaller model when free memory is tight."""
    named = os.environ.get("TX_MODEL")
    if named:
        return named
    free = avail_gb()
    if free is not None and free < 1.5:
        print(f"note: only {free:.1f} GB is free, so this transcript uses the tiny Whisper model (less accurate). Close other apps to use the usual model.", flush=True)
        return "tiny.en"
    if free is not None and free < 2.5:
        print(f"note: only {free:.1f} GB is free, so this transcript uses the base Whisper model. Close other apps to use the usual model.", flush=True)
        return "base.en"
    return "small.en"

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
    model_name = pick_tx_model()
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
        json.dump(st, open(out + ".tmp", "w", encoding="utf-8"))
        os.replace(out + ".tmp", out)
        print(f"progress {len(st['done'])} {n}", flush=True)
    del m

if __name__ == "__main__":
    main()
