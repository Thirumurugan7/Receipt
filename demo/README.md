# demo

`receipt-demo.mp4` — 3m44s, 1920×1080, no audio. Every number in it is real,
captured from a live run against Hedera testnet.

## How it was made

No screen recording. Each slide is rendered offscreen with headless Chrome and
the frames are assembled with ffmpeg, so the output is deterministic and
contains nothing but the film.

```bash
# 1. capture real output from a full run (needs facilitator + seller running)
pnpm scenes > /tmp/scenes.txt

# 2. extract the transcripts into demo-data.js, then serve this directory
python3 -m http.server 8899

# 3. render each slide offscreen
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for i in $(seq 0 11); do
  "$CHROME" --headless --disable-gpu --hide-scrollbars --virtual-time-budget=2500 \
    --screenshot="frames/s$(printf %02d $i).png" --window-size=1920,1080 \
    "http://localhost:8899/film.html#slide=$i"
done

# 4. assemble (concat.txt pairs each frame with its slide duration)
ffmpeg -f concat -safe 0 -i concat.txt -t 224 \
  -vf "fps=30,format=yuv420p,fade=t=in:st=0:d=0.8,fade=t=out:st=222.4:d=1.6" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart receipt-demo.mp4
```

## Files

| | |
|---|---|
| `film.html` | the deck. `#slide=N` renders one slide statically; no hash autoplays it in a browser |
| `demo-data.js` | real terminal transcripts captured from a live run |
| `dashboard.png` | the live ledger, screenshotted with three real deals on it |
| `receipt-demo.mp4` | the rendered film |

Open `film.html` in a browser to watch it play with the transcripts typing out,
which is the better version to screen-record if you want narration over it.
DEMO.md at the repo root is the script for that.
