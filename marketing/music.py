"""Petite musique de fond (36 s, libre de droits car générée) pour la vidéo de démo."""
import sys, wave
import numpy as np

SR, DUR, BPM = 44100, 36.0, 100
beat = 60 / BPM
t = np.arange(int(SR * DUR)) / SR
out = np.zeros_like(t)

def note(f):  # fréquence d'une note MIDI
    return 440 * 2 ** ((f - 69) / 12)

# Accords (MIDI) : la mineur, fa, do, sol — 2 mesures chacun.
CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
bar = 4 * beat
chord_len = 2 * bar

# Nappe douce
for i in range(int(DUR / chord_len) + 1):
    start = i * chord_len
    seg = (t >= start) & (t < start + chord_len)
    tt = t[seg] - start
    env = np.minimum(1, tt / 0.6) * np.minimum(1, (chord_len - tt) / 0.6)
    for m in CHORDS[i % 4]:
        for det in (-0.08, 0.08):
            f = note(m) * (1 + det / 100)
            out[seg] += 0.05 * env * (np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt))

# Arpège en croches (à partir de 4 s)
step = beat / 2
k = 0
while k * step < DUR:
    start = k * step
    if start >= 4.2:
        chord = CHORDS[int(start // chord_len) % 4]
        m = chord[[0, 1, 2, 1][k % 4]] + 12
        n = int(SR * 0.45)
        i0 = int(start * SR)
        tt = np.arange(min(n, len(t) - i0)) / SR
        f = note(m)
        out[i0:i0 + len(tt)] += 0.07 * np.exp(-tt * 7) * (np.sin(2 * np.pi * f * tt) + 0.2 * np.sin(6 * np.pi * f * tt))
    k += 1

# Battement léger (à partir de la démo, 12,2 s)
k = 0
while k * beat < DUR:
    start = k * beat
    if 12.2 <= start < 34:
        i0 = int(start * SR)
        tt = np.arange(int(SR * 0.25)) / SR
        f = 110 * np.exp(-tt * 18) + 45
        kick = 0.22 * np.exp(-tt * 14) * np.sin(2 * np.pi * np.cumsum(f) / SR)
        out[i0:i0 + len(tt)] += kick[: len(out) - i0]
    k += 1

# Fondus d'entrée / sortie et normalisation
out *= np.minimum(1, t / 1.5) * np.minimum(1, (DUR - t) / 2.5)
out = out / np.max(np.abs(out)) * 0.6
pcm = (out * 32767).astype(np.int16)
stereo = np.repeat(pcm[:, None], 2, axis=1)
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(stereo.tobytes())
