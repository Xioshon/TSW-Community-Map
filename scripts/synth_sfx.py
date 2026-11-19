"""Synthesised one-shot sounds for places where no good CC0 recording exists.
Writes 48 kHz mono WAVs into the given folder: woodfish, temple_bell, wind_chime, bow_shot.
Usage: python3 scripts/synth_sfx.py art/sounds/synth
"""
import sys, wave, os
import numpy as np
SR = 48000
rng = np.random.default_rng(7)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)

def save(name, x):
    x = x / (np.abs(x).max() + 1e-9) * .89
    with wave.open(os.path.join(out, name + ".wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())

def t(d): return np.arange(int(SR * d)) / SR

# 木魚: a hollow wooden knock (a few damped resonances plus a short click)
tt = t(.5)
wood = sum(a * np.sin(2 * np.pi * f * tt) * np.exp(-tt * k) for f, a, k in [(560, 1, 38), (1180, .45, 60), (1930, .2, 90), (3100, .08, 140)])
wood[:240] += rng.normal(0, .5, 240) * np.linspace(1, 0, 240)
save("woodfish", wood)

# 廟鐘: inharmonic bell partials with long, slow decay and a little beating
tt = t(7)
bell = sum(a * np.sin(2 * np.pi * f * tt + p) * np.exp(-tt / d) for f, a, d, p in
           [(196, 1, 3.2, 0), (197.3, .6, 3.0, 1), (410, .5, 2.2, 0), (539, .35, 1.6, 2), (803, .25, 1.0, 0), (1069, .12, .6, 1)])
bell *= np.minimum(1, tt / .004)
save("temple_bell", bell)

# 風鈴: a few bright, short metallic tings, scattered
tt = t(.9)
def ting(f): return sum(a * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt * k) for r, a, k in [(1, 1, 6), (2.76, .4, 11), (5.4, .15, 20)])
save("wind_chime", ting(2093))

# 射箭: bowstring twang, arrow whoosh, then the thunk into the target
tw = np.sin(2 * np.pi * 140 * t(.25)) * np.exp(-t(.25) * 26) * .7
n = rng.normal(0, 1, int(SR * .45)); env = np.sin(np.linspace(0, np.pi, n.size)) ** 2
# band-pass-ish whoosh: smooth the noise, then differentiate
wh = np.convolve(n, np.ones(9) / 9, "same"); wh = np.diff(wh, prepend=0) * env * 3
tk = t(.3); thunk = (np.sin(2 * np.pi * 90 * tk) * .9 + np.sin(2 * np.pi * 230 * tk) * .4) * np.exp(-tk * 30)
thunk[:200] += rng.normal(0, .6, 200) * np.linspace(1, 0, 200)
x = np.zeros(int(SR * 1.3)); x[:tw.size] += tw; s = int(SR * .08); x[s:s + wh.size] += wh * .5; s = int(SR * .55); x[s:s + thunk.size] += thunk
save("bow_shot", x)

# 單車飛輪: a freewheel ticking, slowing down as the rider coasts
d = 3.0; x = np.zeros(int(SR * d)); pos = 0.0; rate = 22.0
click = np.sin(2 * np.pi * 3800 * t(.006)) * np.exp(-t(.006) * 900)
while pos < d - .01 and rate > 4:
    i = int(pos * SR); x[i:i + click.size] += click[: x.size - i] * (.6 + .4 * rng.random())
    pos += 1 / rate; rate *= .985
save("freewheel", x)

# 點心車: small trolley wheels rolling over tiles — a low rumble with a bump at each tile joint
d = 3.2; n = rng.normal(0, 1, int(SR * d))
rumble = np.convolve(n, np.ones(60) / 60, "same") * 4
env = np.minimum(1, t(d) / .4) * np.minimum(1, (d - t(d)) / .6)
x = rumble * env
for j in np.arange(.2, d - .3, .33):
    i = int(j * SR); b = np.sin(2 * np.pi * 120 * t(.08)) * np.exp(-t(.08) * 60); x[i:i + b.size] += b * .5
    r = np.sin(2 * np.pi * 2400 * t(.03)) * np.exp(-t(.03) * 160); x[i + 300:i + 300 + r.size] += r * .12  # cups rattle
save("trolley", x)
print("ok")
