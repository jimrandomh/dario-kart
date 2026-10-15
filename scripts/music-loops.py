"""Suggest beat-aligned loop points for the background music (THEMES in src/core/music.ts).

    uv run --no-project --with librosa python scripts/music-loops.py public/music/kart-*.mp3
    XFADE=5 uv run ...   # crossfade length in seconds (default 2.5)

A loop [start, end] crossfades from `end` into `start`. The script beat-tracks the track, then scores
each beat pair a whole number of 4-bar phrases apart by how well the music in the beats following
`start` matches the music following `end` (chroma for harmony, MFCCs for timbre, loudness), keeping
`start` after the intro and `end + XFADE` before the fade-out. Harmony matters most for long loops:
timbre often differs between an early and a late section, which just sounds like a section change.
Beat tracking is unreliable on beatless ambient tracks; give those a longer crossfade instead.
"""

import os
import sys

import librosa
import numpy as np

XFADE = float(os.environ.get("XFADE", "2.5"))


def show(c):
    score, chroma, mfcc, start, end, beats = c
    return f"loop: [{start:.2f}, {end:.2f}]  {end - start:.1f}s / {beats} beats  score {score:.3f} (chroma {chroma:.3f}, mfcc {mfcc:.3f})"


def analyze(path: str) -> None:
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = 512
    db = 20 * np.log10(librosa.feature.rms(y=y, hop_length=hop)[0] + 1e-9)
    rt = librosa.frames_to_time(np.arange(len(db)), sr=sr, hop_length=hop)
    ref = np.percentile(db, 90)
    # Intro / outro: where the smoothed level is within 6 dB of the loud parts.
    k = int(sr / hop)
    loud = np.convolve((db > ref - 6).astype(float), np.ones(k) / k, mode="same") > 0.5
    first_loud = rt[np.argmax(loud)]
    last_loud = rt[len(loud) - 1 - np.argmax(loud[::-1])]

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop)
    bt = librosa.frames_to_time(beats, sr=sr, hop_length=hop)
    tempo = float(np.atleast_1d(tempo)[0])
    print(f"{len(y) / sr:.1f}s, ~{tempo:.0f} bpm, loud from {first_loud:.1f}s to {last_loud:.1f}s")

    def unit(f):
        return f / (np.linalg.norm(f, axis=0, keepdims=True) + 1e-9)

    chroma = unit(librosa.util.sync(librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop), beats, aggregate=np.median))
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=hop, n_mfcc=20)[1:]
    mfcc = librosa.util.sync(mfcc, beats, aggregate=np.mean)
    mfcc = unit((mfcc - mfcc.mean(axis=1, keepdims=True)) / (mfcc.std(axis=1, keepdims=True) + 1e-9))
    level = librosa.util.sync(db[None, :], beats, aggregate=np.mean)[0]

    n = chroma.shape[1]
    w = max(8, int(np.ceil((XFADE + 1) * tempo / 60)))
    cands = []
    for i in range(n - w):
        if bt[i] < max(first_loud, 0.5):
            continue
        for j in range(i + 16, n - w, 16):
            if bt[j] + XFADE > last_loud - 0.5:
                break
            sc = np.mean(np.sum(chroma[:, i : i + w] * chroma[:, j : j + w], axis=0))
            sm = np.mean(np.sum(mfcc[:, i : i + w] * mfcc[:, j : j + w], axis=0))
            sl = -np.mean(np.abs(level[i : i + w] - level[j : j + w])) / 6
            cands.append((0.5 * sc + 0.5 * sm + 0.2 * sl, sc, sm, bt[i], bt[j], j - i))
    if not cands:
        print("  no candidates")
        return
    cands.sort(reverse=True)
    span = last_loud - first_loud
    print(f"  best loops covering >= 70% of the track:")
    for c in [c for c in cands if c[4] - c[3] >= 0.7 * span][:5]:
        print("   ", show(c))
    print(f"  best overall:")
    for c in cands[:3]:
        print("   ", show(c))


for p in sys.argv[1:]:
    print(f"== {p}")
    analyze(p)
