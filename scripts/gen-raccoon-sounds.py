#!/usr/bin/env python3
"""Synthesises the raccoon's voice.

No recordings: every sound is built from noise and a few oscillators, so
there is nothing to license and everything can be retuned here. Needs
numpy and ffmpeg (with libvorbis).

    scripts/gen-raccoon-sounds.py            # writes raccoon-*.oga
    scripts/gen-raccoon-sounds.py --wav DIR  # also keep the .wav files

The file names are a contract with SOUNDS in the extension's extension.js.
"""
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

RATE = 44100
OUT = (Path(__file__).resolve().parent.parent /
       'config/includes.chroot/usr/share/sounds/sloppinux/stereo')
rng = np.random.default_rng(1977)   # same raccoon every build


def t(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def noise(seconds, low, high):
    """White noise, brick-wall band-passed to low..high Hz."""
    n = int(RATE * seconds)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    spectrum[(freqs < low) | (freqs > high)] = 0
    out = np.fft.irfft(spectrum, n)
    return out / (np.abs(out).max() or 1)


def sweep(seconds, f0, f1, curve=1.0, harmonics=(1.0,)):
    """A tone gliding from f0 to f1, with the given harmonic amplitudes."""
    x = t(seconds)
    p = (x / seconds) ** curve
    freq = f0 + (f1 - f0) * p
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    return sum(a * np.sin(phase * (i + 1)) for i, a in enumerate(harmonics))


def envelope(n, attack, release, hold=1.0):
    """Linear attack, exponential release, both in seconds."""
    env = np.ones(n) * hold
    a = min(n, int(RATE * attack))
    env[:a] = np.linspace(0, hold, a)
    r = min(n, int(RATE * release))
    env[n - r:] *= np.exp(-np.linspace(0, 5, r))
    return env


def place(track, clip, at):
    start = int(RATE * at)
    end = min(len(track), start + len(clip))
    track[start:end] += clip[:end - start]


def chitter():
    """Rapid raspy pulses, rising then falling: the annoyed ch-ch-ch-ch."""
    track = np.zeros(int(RATE * 0.62))
    at, pulses = 0.01, 12
    for i in range(pulses):
        length = 0.022 + rng.uniform(-0.004, 0.004)
        tone = sweep(length, rng.uniform(2600, 3200), rng.uniform(1500, 1900),
                     harmonics=(1.0, 0.5, 0.25))
        rasp = noise(length, 1400, 5200)
        pulse = (0.6 * tone + 0.8 * rasp) * envelope(len(tone), 0.002, length * 0.8)
        loud = np.sin(np.pi * (i + 0.5) / pulses) ** 0.7
        place(track, pulse * loud, at)
        at += 0.047 + rng.uniform(-0.006, 0.006)
    return track


def trill():
    """A short rising churr: pleased, or at least interested."""
    seconds = 0.34
    x = t(seconds)
    tone = sweep(seconds, 1150, 1750, curve=0.7, harmonics=(1.0, 0.35, 0.12))
    flutter = 0.55 + 0.45 * np.sin(2 * np.pi * 31 * x)
    breath = 0.15 * noise(seconds, 2000, 6000)
    return (tone * flutter + breath) * envelope(len(x), 0.02, 0.12)


def purr():
    """Low fluttering rumble for being petted."""
    seconds = 1.25
    x = t(seconds)
    flutter = (0.5 + 0.5 * np.sin(2 * np.pi * 23 * x)) ** 2
    body = sweep(seconds, 96, 88, harmonics=(1.0, 0.6, 0.4, 0.25, 0.15))
    rumble = noise(seconds, 60, 420)
    swell = 0.75 + 0.25 * np.sin(2 * np.pi * 1.6 * x)
    return (0.7 * body + 0.9 * rumble) * flutter * swell * envelope(len(x), 0.12, 0.3)


def chomp():
    """Three crunches and the small wet noises in between."""
    track = np.zeros(int(RATE * 0.62))
    for i, at in enumerate((0.01, 0.2, 0.39)):
        length = 0.085
        crunch = noise(length, 700, 7500) * envelope(int(RATE * length), 0.001, length)
        crackle = (rng.random(len(crunch)) > 0.86) * 1.0     # gritty, not hissy
        thump = sweep(0.05, 190, 90, harmonics=(1.0, 0.3)) * envelope(int(RATE * 0.05), 0.002, 0.045)
        place(track, crunch * (0.45 + 0.75 * crackle) * (1.0 - 0.12 * i), at)
        place(track, 0.7 * thump, at)
        smack = noise(0.03, 1800, 4200) * envelope(int(RATE * 0.03), 0.004, 0.025)
        place(track, 0.25 * smack, at + 0.115)
    return track


def squeal():
    """Up, over and down, with a wobble: airborne and unhappy about it."""
    seconds = 0.5
    x = t(seconds)
    p = x / seconds
    freq = 1900 + 1500 * np.sin(np.pi * p ** 0.8) - 500 * p
    freq *= 1 + 0.035 * np.sin(2 * np.pi * 34 * x)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    tone = np.sin(phase) + 0.45 * np.sin(2 * phase) + 0.2 * np.sin(3 * phase)
    rasp = 0.25 * noise(seconds, 2500, 8000) * (0.5 + 0.5 * np.sin(2 * np.pi * 34 * x))
    return (tone + rasp) * envelope(len(x), 0.015, 0.18)


def growl():
    """Low, rough and getting worse: the tantrum is on its way."""
    seconds = 0.85
    x = t(seconds)
    phase = 2 * np.pi * np.cumsum(np.linspace(92, 70, len(x))) / RATE
    saw = 2 * ((phase / (2 * np.pi)) % 1) - 1
    rough = (0.45 + 0.55 * np.sin(2 * np.pi * 37 * x)) ** 2
    throat = noise(seconds, 250, 1100)
    swell = np.minimum(1, 0.35 + 1.1 * x / seconds)
    return (0.8 * saw + 0.9 * throat) * rough * swell * envelope(len(x), 0.06, 0.2)


def hiss():
    """Sharp spit, then air."""
    seconds = 0.6
    x = t(seconds)
    air = noise(seconds, 2800, 10500)
    flutter = 0.8 + 0.2 * np.sin(2 * np.pi * 48 * x)
    env = np.exp(-x * 5.5)
    env[:int(RATE * 0.006)] *= np.linspace(0, 1, int(RATE * 0.006))
    spit = noise(0.03, 1200, 6000) * envelope(int(RATE * 0.03), 0.001, 0.028)
    out = air * flutter * env
    place(out, 0.9 * spit, 0)
    return out


SOUNDS = {'chitter': chitter, 'trill': trill, 'purr': purr, 'chomp': chomp,
          'squeal': squeal, 'growl': growl, 'hiss': hiss}
# Relative loudness: the purr sits under everything, the squeal does not.
LEVEL = {'chitter': 0.8, 'trill': 0.6, 'purr': 0.5, 'chomp': 0.75,
         'squeal': 0.8, 'growl': 0.85, 'hiss': 0.7}


def write_wav(path, samples, level):
    edge = int(RATE * 0.004)
    samples = samples.copy()
    samples[:edge] *= np.linspace(0, 1, edge)
    samples[-edge:] *= np.linspace(1, 0, edge)
    samples = samples / (np.abs(samples).max() or 1) * level
    pcm = (samples * 32767).astype('<i2')
    stereo = np.column_stack([pcm, pcm]).tobytes()
    with wave.open(str(path), 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(stereo)


def main():
    keep = Path(sys.argv[sys.argv.index('--wav') + 1]) if '--wav' in sys.argv else None
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = keep or Path(tmp)
        workdir.mkdir(parents=True, exist_ok=True)
        for name, make in SOUNDS.items():
            wav = workdir / f'raccoon-{name}.wav'
            write_wav(wav, make(), LEVEL[name])
            oga = OUT / f'raccoon-{name}.oga'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav),
                            '-c:a', 'libvorbis', '-q:a', '4',
                            # No encoder version or date in the file: same
                            # input, same bytes.
                            '-map_metadata', '-1', '-fflags', '+bitexact',
                            '-flags:a', '+bitexact', str(oga)], check=True)
            print(f'{oga.name}: {len(make()) / RATE:.2f}s')


if __name__ == '__main__':
    main()
