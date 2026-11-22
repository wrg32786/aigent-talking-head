#!/usr/bin/env python3
# Beat grid for a music bed. Analyses the bed from --start for --duration (the reel
# length) and writes beat-grid.json with times on the output clock (0 = start of the reel).
#
#   python3 kit/beats.py bed.mp3 --start 0 --duration 18.4 --out build/beat-grid.json
#
# Adapted from Will Gwyn's music-video pipeline (pipeline/audio_analysis.py and the
# drop-intensity filter in pipeline/effects_planner.py), relicensed Apache-2.0 by the
# author. Uses librosa (ISC) locally; no API. Speech cuts are not this script's job.
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

_SAMPLE_RATE = 22050
_HOP_LENGTH = 512
_ENERGY_HOP_SECONDS = 0.1
_DROP_WINDOW_SECONDS = 0.5
_BPM_CEILING = 130
_DROP_ENERGY_THRESHOLD = 0.40
# effects_planner._filter_drops_by_intensity: raw RMS spikes are noisy; keep intense ones.
_DROP_INTENSITY_MIN = 0.85


def analyse(
    wav_path: Path,
    start: float = 0.0,
    duration: float | None = None,
    bpm_ceiling: int = _BPM_CEILING,
    drop_energy_threshold: float = _DROP_ENERGY_THRESHOLD,
    drop_intensity_min: float = _DROP_INTENSITY_MIN,
) -> dict[str, Any]:
    try:
        import librosa  # type: ignore[import]
        import numpy as np
    except ImportError as exc:
        raise SystemExit(
            "librosa is not installed. pip install -r requirements.txt (needs librosa)"
        ) from exc

    offset = max(0.0, float(start or 0.0))
    dur = None if duration is None or float(duration) <= 0 else float(duration)
    y, sr = librosa.load(str(wav_path), sr=_SAMPLE_RATE, offset=offset, duration=dur)
    if y.size == 0:
        raise ValueError(f"no audio after start={offset} duration={dur} in {wav_path}")

    length = float(librosa.get_duration(y=y, sr=sr))

    tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    tempo_bpm = float(np.atleast_1d(tempo_raw)[0])
    if tempo_bpm > bpm_ceiling:
        tempo_bpm = tempo_bpm / 2.0

    beat_times: list[float] = librosa.frames_to_time(
        beat_frames, sr=sr, hop_length=_HOP_LENGTH
    ).tolist()
    onset_times: list[float] = librosa.onset.onset_detect(
        y=y, sr=sr, hop_length=_HOP_LENGTH, units="time"
    ).tolist()

    rms_frames = librosa.feature.rms(y=y, hop_length=_HOP_LENGTH)[0]
    energy_curve = _downsample_energy(rms_frames, sr, _HOP_LENGTH, _ENERGY_HOP_SECONDS, np)
    drops = _detect_drops(
        rms_frames, sr, _HOP_LENGTH, drop_energy_threshold, _DROP_WINDOW_SECONDS, np
    )
    drops = [d for d in drops if d.get("intensity", 0) >= drop_intensity_min]
    downbeats = _try_get_downbeats(y, sr, librosa, np)

    return {
        "tempo_bpm": round(tempo_bpm, 2),
        "duration_seconds": round(length, 3),
        "sample_rate": int(sr),
        "bed_start": round(offset, 3),
        "beats": [round(t, 4) for t in beat_times],
        "onsets": [round(t, 4) for t in onset_times],
        "energy_curve": {"hop_seconds": _ENERGY_HOP_SECONDS, "values": energy_curve},
        "drops": drops,
        "downbeats": downbeats,
        "drop_intensity_min": drop_intensity_min,
    }


def _downsample_energy(rms_frames, sr: int, hop_length: int, hop_seconds: float, np) -> list[float]:
    frame_hop = hop_length / float(sr)
    if frame_hop <= 0:
        return [round(float(x), 6) for x in rms_frames]
    group = max(1, int(round(hop_seconds / frame_hop)))
    out = []
    for i in range(0, len(rms_frames), group):
        chunk = rms_frames[i : i + group]
        out.append(round(float(np.mean(chunk)), 6))
    return out


def _detect_drops(rms_frames, sr: int, hop_length: int, rise_threshold: float, window_seconds: float, np):
    frame_hop = hop_length / float(sr)
    win = max(1, int(round(window_seconds / frame_hop)))
    peak = float(np.max(rms_frames)) or 1.0
    drops: list[dict] = []
    i = 0
    n = len(rms_frames)
    while i < n:
        ahead = min(n, i + win)
        now = float(rms_frames[i])
        later = float(np.max(rms_frames[i:ahead]))
        if peak and (later - now) / peak >= rise_threshold:
            peak_i = int(i + int(np.argmax(rms_frames[i:ahead])))
            t = peak_i * frame_hop
            intensity = round(later / peak, 4)
            drops.append({"time": round(t, 4), "intensity": intensity, "type": "energy_spike"})
            i = peak_i + win
            continue
        i += 1
    return drops


def _try_get_downbeats(y, sr: int, librosa, np) -> list[float] | None:
    try:
        _, frames = librosa.beat.beat_track(y=y, sr=sr, tightness=100)
        times = librosa.frames_to_time(frames, sr=sr, hop_length=_HOP_LENGTH).tolist()
        return [round(t, 4) for t in times]
    except Exception:
        return None


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Analyse a music bed and write beat-grid.json (reel-clock times).")
    p.add_argument("audio", help="bed file (mp3, wav, ...)")
    p.add_argument("--start", type=float, default=0.0, help="bedStart: seconds into the track where the reel begins")
    p.add_argument("--duration", type=float, default=0.0, help="reel length in seconds (0 = rest of the file)")
    p.add_argument("--out", default="beat-grid.json", help="output JSON path")
    p.add_argument("--bpm-ceiling", type=int, default=_BPM_CEILING)
    p.add_argument("--drop-energy", type=float, default=_DROP_ENERGY_THRESHOLD)
    p.add_argument("--drop-min", type=float, default=_DROP_INTENSITY_MIN)
    args = p.parse_args(argv)

    path = Path(args.audio)
    if not path.is_file():
        print(f"beats.py: no such file: {path}", file=sys.stderr)
        return 1
    grid = analyse(
        path,
        start=args.start,
        duration=args.duration or None,
        bpm_ceiling=args.bpm_ceiling,
        drop_energy_threshold=args.drop_energy,
        drop_intensity_min=args.drop_min,
    )
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(grid, indent=2) + "\n", encoding="utf-8")
    print(
        f"beat-grid: {grid['tempo_bpm']} BPM, {len(grid['beats'])} beats, "
        f"{len(grid['onsets'])} onsets, {len(grid['drops'])} drops, "
        f"{grid['duration_seconds']}s from {args.start}s -> {out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
