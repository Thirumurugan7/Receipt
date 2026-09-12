# demo

`receipt-demo.mp4` — 1920×1080, no audio. Every number in it is real, captured
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

**`capture.mjs`** runs the scenes end to end — real settlement, real escrow,
real release and refund — and writes the transcripts to `demo-data.js`. The
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
lands — then follows one of those links to HashScan. The film plays the frames
back, so what a viewer sees is a real session rather than a mock-up of one. The
frames are shrunk before they are committed, and a test keeps the film's frame
count honest against the directory.

**`render.mjs`** drives headless Chrome over the DevTools Protocol and
assembles the frames with ffmpeg. It has no dependencies: the WebSocket client
is the one built into Node, and the page is served by `node:http`.

## The film is a pure function of time

`film.html` has no CSS animations and no timers. It exposes `seek(ms)`, which
computes every pixel of state from the clock — which scene is showing, how much
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
| `demo-data.js` | captured transcripts and verdicts — generated, not hand-edited |
| `render.mjs` | headless Chrome + ffmpeg, no dependencies |
| `shot.mjs` | captures the explorer pages the *evidence* scene shows |
| `interact.mjs` | records a real session on the live ledger, frame by frame |
| `cdp.mjs` | the DevTools Protocol client both of those share |
| `shots/` | those captures, committed so the film can be rebuilt offline |
| `shots/run/` | the recorded session, one JPEG per frame |
| `schedule.json` | the running order, written by the renderer; `DEMO.md` is tested against it |
| `receipt-demo.mp4` | the rendered film |
