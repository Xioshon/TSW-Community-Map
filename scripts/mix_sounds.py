"""Mix each place's ambience into a seamless ~10 s loop for the website.

Recipe (scripts/sound_recipes.json): for every place a "bed" (a long ambience recording, looped
seamlessly by cross-fading its tail into its head) plus one-shot "events" placed at given times
(wrapping round the loop). Output: site/sounds/<id>.m4a (mono AAC, loudness matched).

Usage: /usr/bin/python3 scripts/mix_sounds.py scripts/sound_recipes.json art/sounds site/sounds
Needs numpy and ffmpeg.
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100
RECIPES, SRC, OUT = sys.argv[1:4]
only = set(sys.argv[4:])
os.makedirs(OUT, exist_ok=True)


def read(path, start=0.0, dur=None):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", os.path.join(SRC, path)]
    if dur: cmd += ["-t", str(dur)]
    cmd += ["-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, dtype="<f4").astype(np.float64)


def rms(x): return float(np.sqrt(np.mean(x ** 2)) + 1e-12)


def highpass(x, hz):
    # one-pole high-pass, enough to take rumble / handling noise out of field recordings
    if not hz: return x
    a = np.exp(-2 * np.pi * hz / SR); y = np.empty_like(x); prev_x = prev_y = 0.0
    for i, v in enumerate(x):
        prev_y = a * (prev_y + v - prev_x); prev_x = v; y[i] = prev_y
    return y


def bed(spec, L):
    X = spec.get("xfade", 1.5)
    seg = read(spec["file"], spec.get("start", 0), L + X)
    if seg.size < int(SR * (L + X)):  # short recording: tile it first
        reps = int(np.ceil(SR * (L + X) / seg.size)) + 1
        seg = np.tile(seg, reps)
    seg = seg[: int(SR * (L + X))]
    n, x = int(SR * L), int(SR * X)
    y = seg[:n].copy()
    ramp = np.sin(np.linspace(0, np.pi / 2, x)) ** 2  # equal-power-ish
    y[:x] = seg[:x] * ramp + seg[n:n + x] * (1 - ramp)
    y = highpass(y, spec.get("hp", 0))
    return y / rms(y) * spec.get("gain", 1.0)


def place_events(y, events):
    n = y.size
    for ev in events:
        s = read(ev["file"], ev.get("start", 0), ev.get("dur"))
        s = highpass(s, ev.get("hp", 0))
        fade = min(int(SR * .02), s.size // 4)
        if fade: s[:fade] *= np.linspace(0, 1, fade); s[-fade:] *= np.linspace(1, 0, fade)
        s = s / (np.abs(s).max() + 1e-9) * ev.get("gain", .5)
        for at in ev["at"]:
            i = int(SR * at) % n
            idx = (np.arange(s.size) + i) % n  # wrap round the loop
            np.add.at(y, idx, s)
    return y


recipes = json.load(open(RECIPES))
for pid, r in recipes.items():
    if pid.startswith("_") or (only and pid not in only): continue
    L = r.get("length", 10)
    y = np.zeros(int(SR * L))
    for b in r.get("beds", []):
        y += bed(b, L)
    y = place_events(y, r.get("events", []))
    # loudness match: every place sits at the same RMS, with peaks kept under -1 dBFS
    # a gentle limiter first, so one loud spike (a honk, a bell) doesn't make the whole loop quiet
    target = 10 ** (r.get("level", -20) / 20)
    for _ in range(3):
        y = y / rms(y) * target
        w = int(SR * .01); pad = (-y.size) % w
        env = np.abs(np.pad(y, (0, pad))).reshape(-1, w).max(1)
        g = np.minimum(1, .45 / (env + 1e-9))
        g = np.minimum(g, np.minimum(np.roll(g, 1), np.roll(g, -1)))  # open/close a little early (wraps: it's a loop)
        g = np.convolve(np.concatenate([g[-3:], g, g[:3]]), np.ones(7) / 7, "valid")
        y = y * np.repeat(g, w)[: y.size]
    y = y / rms(y) * target
    peak = np.abs(y).max()
    if peak > .89: y *= .89 / peak
    tmp = os.path.join(OUT, pid + ".f32")
    y.astype("<f4").tofile(tmp)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", tmp,
                    "-c:a", "aac", "-b:a", "80k", "-movflags", "+faststart", os.path.join(OUT, pid + ".m4a")], check=True)
    os.remove(tmp)
    print(f"{pid:18} {L:4.1f}s  {os.path.getsize(os.path.join(OUT, pid + '.m4a')) // 1024} KB")
