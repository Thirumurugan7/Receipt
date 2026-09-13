#!/usr/bin/env python3
"""
Reads the narration script onto the film.

    python3 demo/narrate.py

The film is silent by design: every screen is built to be understood without
a voice over it. ETHGlobal requires a narrated video, so this speaks the
script in DEMO.md over the rendered film.

It is deliberately not a hand-made recording. The narration table in DEMO.md
is the single source of the words, and demo/schedule.json, written by the
renderer from the film itself, is the single source of the timings. Each line
is spoken into its own scene and its rate is solved so it fits the scene it
belongs to. Change a scene length and re-run: the read re-times itself rather
than drifting out of sync.
"""
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = HERE / '.narration'
VOICE = 'Rishi'          # en_IN, macOS built in
FILM = HERE / 'receipt-demo.mp4'
OUT = HERE / 'receipt-demo-narrated.mp4'
# A line is given 93% of its scene, so the next scene never opens mid-sentence.
HEADROOM = 0.93


def duration(path: pathlib.Path) -> float:
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def narration_lines() -> dict[str, str]:
    """The `| 0:00 | scene | what to say |` table in DEMO.md, keyed by scene."""
    rows = {}
    for line in (ROOT / 'DEMO.md').read_text().split('\n'):
        m = re.match(r'^\|\s*\d+:\d\d\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|$', line)
        if m:
            rows[m.group(1).strip()] = m.group(2).strip()
    return rows


def main() -> int:
    WORK.mkdir(exist_ok=True)
    scenes = json.loads((HERE / 'schedule.json').read_text())
    if isinstance(scenes, dict):
        scenes = scenes.get('scenes') or scenes.get('cues')
    lines = narration_lines()

    missing = [s['n'] for s in scenes if s['n'] not in lines]
    if missing:
        print(f'DEMO.md has no line for: {missing}', file=sys.stderr)
        return 1

    clips = []
    for s in scenes:
        text, budget = lines[s['n']], s['dur'] / 1000 * HEADROOM
        rate = max(150, min(260, round(len(text.split()) / budget * 60)))
        clip = WORK / f"{s['start']:06d}.aiff"
        subprocess.run(['say', '-v', VOICE, '-r', str(rate), '-o', str(clip), text], check=True)
        spoken = duration(clip)
        # Solving for the rate is approximate, so close the gap by measuring.
        for _ in range(6):
            if spoken <= budget:
                break
            rate = min(300, round(rate * (spoken / budget) * 1.02))
            subprocess.run(['say', '-v', VOICE, '-r', str(rate), '-o', str(clip), text], check=True)
            spoken = duration(clip)
        clips.append((s, clip, rate, spoken))
        print(f"{s['start']/1000:7.1f}s  {s['n']:22} rate {rate:3}  {spoken:5.1f}s / {s['dur']/1000:5.1f}s")

    # Lay every clip onto one track at its own scene start. normalize=0 because
    # the clips do not overlap, so mixing must not scale them down.
    inputs, filters, labels = [], [], []
    for i, (s, clip, _, _) in enumerate(clips):
        inputs += ['-i', str(clip)]
        filters.append(f"[{i}:a]aformat=sample_rates=44100:channel_layouts=stereo,"
                       f"adelay={s['start']}|{s['start']}[a{i}]")
        labels.append(f'[a{i}]')
    track = WORK / 'narration.m4a'
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex',
         ';'.join(filters) + ';' + ''.join(labels) +
         f'amix=inputs={len(clips)}:normalize=0:dropout_transition=0,dynaudnorm=p=0.9:m=10[out]',
         '-map', '[out]', str(track)], check=True)

    # Mono at 64k: it is speech, and the file has to stay small enough to upload.
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', str(FILM), '-i', str(track),
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '64k', '-ac', '1',
         '-map', '0:v:0', '-map', '1:a:0', '-shortest', str(OUT)], check=True)

    print(f'\n{OUT.relative_to(ROOT)}  {duration(OUT):.0f}s  '
          f'{OUT.stat().st_size / 1e6:.1f} MB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
