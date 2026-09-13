#!/usr/bin/env python3
"""
Reads the narration script onto the film.

    python3 demo/narrate.py

The film is silent by design: every screen is built to be understood without a
voice over it. A narrated cut is required for submission, so this speaks the
script in DEMO.md over the rendered film.

The narration table in DEMO.md is the only source of the words, and
demo/schedule.json, which the renderer writes from the film itself, is the only
source of the timings. Change a scene length and re-run: the read re-times
itself rather than drifting out of sync.

WHY IT IS BUILT THIS WAY
------------------------
The first version of this script solved a speaking rate per scene so each line
would fit its slot. That worked and sounded terrible, because it meant the
voice ran at 150 words a minute in one scene and 264 in the next. Nobody speaks
like that, and the lurching is what made it sound synthetic, more than the
voice itself did.

So the rate is now fixed. Every scene is read at the same pace a person would
use. When a line does not fit, the time comes out of the pauses between
sentences, not out of the speaking rate, because a slightly clipped pause is
almost impossible to hear and a 60% rate jump is impossible to miss. Only if a
line still will not fit after the pauses are at their floor does the rate move
at all, and then by at most ten percent.

ENGINES
-------
Two, picked in this order:

  edge-tts   free, open source (GPL-3.0), no API key and no account. Neural
             voices, including three for en_IN. This is the default because
             macOS ships only *compact* voices for Indian English, which are
             formant synthesis and sound it. Install with
             `pip install edge-tts`, or point RECEIPT_EDGE_TTS at the binary.
             It calls Microsoft's read-aloud endpoint, so rebuilding the
             narration needs a network connection.

  say        macOS built in, fully offline, no install. Used automatically
             when edge-tts is not on PATH. Noticeably more synthetic, so the
             pause and pitch shaping below exists mainly to help this engine.

Piper was the other candidate worth trying, being fully offline and MIT, but
it ships 38 English voices and none of them are en_IN.

A recorded human voice over the same silent film still beats both, and the
ffmpeg mux at the end of this file will take one without any other change.
"""
import json
import pathlib
import re
import os
import shutil
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = HERE / '.narration'
FILM = HERE / 'receipt-demo.mp4'
OUT = HERE / 'receipt-demo-narrated.mp4'

SAY_VOICE = 'Rishi'              # en_IN, macOS built in
EDGE_VOICE = 'en-IN-PrabhatNeural'   # en_IN, neural, free, no key
RATE = 168               # words a minute, the same in every scene
RATE_CEILING = 185       # only reached when pauses are already at the floor
PITCH_MOD = 130          # more melody than the flat default, less monotone
SENTENCE_PAUSE = 340     # ms of breath after a full stop
CLAUSE_PAUSE = 150       # ms after a comma
PAUSE_FLOOR = 0.35       # pauses may shrink to this fraction before rate moves
LEAD_IN = 250            # ms after the cut before the voice starts
EDGE_BASE_PCT = 26       # edge-tts reads slow by default; this is its 168 wpm


def duration(path: pathlib.Path) -> float:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def narration_lines() -> dict:
    """The `| 0:00 | scene | what to say |` table in DEMO.md, keyed by scene."""
    rows = {}
    for line in (ROOT / 'DEMO.md').read_text().split('\n'):
        m = re.match(r'^\|\s*\d+:\d\d\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$', line)
        if m:
            rows[m.group(1).strip()] = m.group(2).strip()
    return rows


def with_breath(text: str, scale: float) -> str:
    """Apple's embedded speech commands, so the read breathes between thoughts."""
    sentence = max(1, int(SENTENCE_PAUSE * scale))
    clause = max(1, int(CLAUSE_PAUSE * scale))
    out = re.sub(r'([.!?]) +', rf'\1 [[slnc {sentence}]] ', text)
    out = re.sub(r'(,) +', rf'\1 [[slnc {clause}]] ', out)
    return f'[[pmod {PITCH_MOD}]] {out}'


def edge_binary() -> str | None:
    return os.environ.get('RECEIPT_EDGE_TTS') or shutil.which('edge-tts')


EDGE = edge_binary()


def speak(text: str, rate: int, scale: float, dest: pathlib.Path) -> float:
    """Render one line. `rate` is words a minute; `scale` shrinks the pauses."""
    if EDGE:
        # A neural voice paces and breathes on its own, so the pause and pitch
        # shaping is not applied to it: doing so fights the model. Fitting is
        # expressed as a percentage off its natural pace instead.
        pct = round((rate - RATE) / RATE * 100) + EDGE_BASE_PCT
        subprocess.run([EDGE, '--voice', EDGE_VOICE,
                        f'--rate={pct:+d}%', '--text', text,
                        '--write-media', str(dest)],
                       check=True, capture_output=True)
    else:
        subprocess.run(['say', '-v', SAY_VOICE, '-r', str(rate), '-o', str(dest),
                        with_breath(text, scale)], check=True)
    return duration(dest)


def main() -> int:
    WORK.mkdir(exist_ok=True)
    print(f"engine: {'edge-tts ' + EDGE_VOICE if EDGE else 'say ' + SAY_VOICE}\n")
    scenes = json.loads((HERE / 'schedule.json').read_text())
    if isinstance(scenes, dict):
        scenes = scenes.get('scenes') or scenes.get('cues')
    lines = narration_lines()

    missing = [s['n'] for s in scenes if s['n'] not in lines]
    if missing:
        print(f'DEMO.md has no line for: {missing}', file=sys.stderr)
        return 1

    clips, moved = [], 0
    for s in scenes:
        text = lines[s['n']]
        clip = WORK / (f"{s['start']:06d}." + ('mp3' if EDGE else 'aiff'))
        lead = LEAD_IN
        budget = s['dur'] / 1000 - lead / 1000

        scale, rate = 1.0, RATE
        spoken = speak(text, rate, scale, clip)
        # First give back pause time, which nobody can hear.
        while spoken > budget and scale > PAUSE_FLOOR:
            scale = max(PAUSE_FLOOR, scale - 0.15)
            spoken = speak(text, rate, scale, clip)
        # Then drop the lead-in, so the voice starts on the cut instead.
        if spoken > budget:
            lead = 0
            budget = s['dur'] / 1000
        # Only then touch the rate, and never by much.
        while spoken > budget and rate < RATE_CEILING:
            rate = min(RATE_CEILING, rate + 5)
            spoken = speak(text, rate, scale, clip)

        if rate != RATE:
            moved += 1
        clips.append((s, clip, lead))
        flag = '' if rate == RATE else f'  rate {rate}'
        over = '' if spoken <= s['dur'] / 1000 else '  OVERRUN'
        print(f"{s['start']/1000:7.1f}s  {s['n']:22} {spoken:5.1f}s / "
              f"{s['dur']/1000:5.1f}s  pauses {scale:.2f}{flag}{over}")

    print(f'\nscenes read at the base rate: {len(clips) - moved}/{len(clips)}')

    inputs, filters, labels = [], [], []
    for i, (s, clip, lead) in enumerate(clips):
        inputs += ['-i', str(clip)]
        at = s['start'] + lead
        filters.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                       f"adelay={at}|{at}[a{i}]")
        labels.append(f'[a{i}]')

    # Gentle compression and a small presence lift for intelligibility, then
    # loudnorm rather than dynaudnorm: dynaudnorm chases every syllable to the
    # same level, which flattens the read and is its own kind of robotic.
    chain = ('amix=inputs=%d:normalize=0:dropout_transition=0,'
             'highpass=f=85,'
             'acompressor=threshold=-20dB:ratio=2.5:attack=15:release=250,'
             'treble=g=2:f=5500,'
             'loudnorm=I=-18:TP=-2:LRA=11' % len(clips))
    track = WORK / 'narration.m4a'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex',
                    ';'.join(filters) + ';' + ''.join(labels) + chain + '[out]',
                    '-map', '[out]', str(track)], check=True)

    # Mono at 80k: it is speech, and the file has to stay small enough to upload.
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', str(FILM), '-i', str(track),
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
         '-map', '0:v:0', '-map', '1:a:0', '-shortest', str(OUT)], check=True)

    print(f'\n{OUT.relative_to(ROOT)}  {duration(OUT):.0f}s  '
          f'{OUT.stat().st_size / 1e6:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
