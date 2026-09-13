# demo

`receipt-demo.mp4` is 1920×1080 and silent. Every number in it is real, captured
from a live run against Hedera testnet, buying live token data from The Graph.
`DEMO.md` at the repo root is the narration to read over it.

## How it is made

Nothing here records a screen. Two steps, both reproducible:

```bash
node demo/capture.mjs     # runs every scene for real -> demo-data.js
node demo/shot.mjs        # captures the explorer pages the film shows -> shots/
node demo/interact.mjs    # records a real session on the live page -> shots/run/
node demo/render.mjs      # renders the film -> receipt-demo.mp4, schedule.json
```

**`capture.mjs`** runs the scenes end to end, real settlement, real escrow,
real release and refund, and writes the transcripts to `demo-data.js`. The
per-check results behind the animated checklist are read back from the
facilitator's own deal record, so the ticks and crosses on screen are the ones
the adjudicator produced, including the checks that failed *after* the first
failure. It refuses to write a capture that came back empty, because a blank
slide in the finished film is worse than a failed build.

**`shot.mjs`** captures the HashScan pages and the live ledger that the
*evidence* scene shows. The film claims those transactions exist; screenshotting
the real explorer is how that claim is made checkable on screen rather than
asserted. It declines cookies rather than accepting them, which is both the
privacy-preserving answer and the one that does not leave a banner across the
middle of the shot.

**`interact.mjs`** records the ledger page actually being used. A still proves
the page exists; this presses the run button, lets a real deal go through, and
captures the screen while the transcript streams and each transaction link
lands, then follows one of those links to HashScan. The film plays the frames
back, so what a viewer sees is a real session rather than a mock-up of one. The
frames are shrunk before they are committed, and a test keeps the film's frame
count honest against the directory.

**`render.mjs`** drives headless Chrome over the DevTools Protocol and
assembles the frames with ffmpeg. It has no dependencies: the WebSocket client
is the one built into Node, and the page is served by `node:http`.

## Two kinds of screen

Slides explain, and look like slides: paper, a margin rail, typography doing
the work. Recordings show, and look like recordings: the terminal, the live
app and the block explorer fill the frame edge to edge, with a title bar or an
address bar and nothing else. A judge should never be in doubt about which one
they are looking at, or have to squint at a window floating on a slide.

The app and explorer frames are captured at 1920x1010 for exactly this reason:
they are displayed at their own size, so nothing is upscaled.

## How each screen is built

One idea per screen, and nothing on it that does not serve that idea. Every
real value gets a plain-English label beside it, so a viewer never has to know
what `requiredPaths` means to follow what happened. Terminals look like
terminals, with a window and a prompt, and show six readable lines rather than
twenty-five unreadable ones: the transcripts behind them are still real, and
`realLine()` pulls the exact line out of the capture rather than retyping it.

Three screens use well-known meme templates, downloaded blank and captioned by
the film itself rather than baked into the image. They are third-party artwork,
included here for a hackathon demo and nothing else. Anyone reusing this repo
for another purpose should replace them.

## The film is a pure function of time

`film.html` has no CSS animations and no timers. Every gesture in it, a word
building letter by letter, a list arriving a line at a time, a push into the
part of a screenshot that carries the claim, a highlight sweeping across the
verdict line once the transcript has printed it, is arithmetic on the clock.
It exposes `seek(ms)`, which computes every pixel of state from that clock, which scene is showing, how much
of a transcript has printed, where a stamp is in its landing, what the escrow
chip in the margin says. A frame at `t` is the same frame no matter when, or on
whose machine, it is rendered.

That is the same property the project claims for its verdicts, and it buys two
concrete things:

- **Frames can be skipped.** `seek` returns a signature of the state it painted.
  The renderer captures a frame only when the signature changes and turns the
  rest into a longer `duration` in the ffmpeg concat list. A scene that holds
  still for twelve seconds costs one screenshot, not three hundred and sixty.
- **Re-rendering is safe.** There is no wall-clock animation to race, so a
  slow machine produces the same video as a fast one.

Opening `film.html` in a browser plays it: the same `seek` is driven off
`requestAnimationFrame` instead. `#render` freezes it at `t=0` for the renderer.

## Checking a change without a full render

```bash
node demo/render.mjs --at 0,62000,163000
```

Renders just those moments into `demo/.frames/` and exits.

## Files

| | |
|---|---|
| `film.html` | the film. one family, no animation, `seek(ms)` paints everything |
| `capture.mjs` | runs the scenes for real and writes `demo-data.js` |
| `demo-data.js` | captured transcripts and verdicts, generated, not hand-edited |
| `render.mjs` | headless Chrome + ffmpeg, no dependencies |
| `shot.mjs` | captures the explorer pages the *evidence* scene shows |
| `interact.mjs` | records a real session on the live ledger, frame by frame |
| `cdp.mjs` | the DevTools Protocol client both of those share |
| `shots/` | those captures, committed so the film can be rebuilt offline |
| `shots/run/` | the recorded session, one JPEG per frame |
| `shots/memes/` | blank meme templates, captioned by the film in its own type |
| `../assets/logo.svg` | the project mark, inlined by the film and by the live page |
| `run-frames.js` | the frame count, written by `interact.mjs` so the film cannot hold a stale copy |
| `schedule.json` | the running order, written by the renderer; `DEMO.md` is tested against it |
| `receipt-demo.mp4` | the rendered film |
| `narrate.py` | reads the DEMO.md script onto the film, timed from `schedule.json` |
| `receipt-demo-narrated.mp4` | the narrated cut, the one submitted |
| `receipt-demo-v1.mp4` | the earlier cut, kept on request: same content, longer runway, emoji art |
