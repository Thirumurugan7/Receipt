# DEMO.md: the film, and what to say over it

`demo/receipt-demo.mp4` is 3:28, 1920×1080, no audio.

Every figure in it came off a live run against Hedera testnet: real settlement,
real escrow, real release and refund, real data bought from The Graph. Nothing
is mocked, which is why nothing needed to be faked.

The film is built to be understood without narration. Every screen carries one
idea, every real value has a plain-English label beside it, and the terminals
show six readable lines rather than a wall of log output. The narration below
is for when you are presenting it live. Timecodes come from
`demo/schedule.json`, which the renderer writes from the film itself, so this
script cannot drift out of sync with what is on screen.

---

## Narration

| at | screen | what to say |
|---|---|---|
| 0:00 | title | Receipt. Pay for an API call, and get your money back automatically if the answer is junk. |
| 0:07 | the problem | Right now an AI agent pays first and checks what it bought second. If the API answers with junk, the money has already gone. x402 has no refund step in it at all. |
| 0:19 | why not sue | You cannot arbitrate a forty six cent payment. Bonds and gas cost more than the thing. So people appoint a judge instead, and that product does five users a day. |
| 0:30 | so instead | So instead of arguing after the fact, the buyer says what a good answer is first, and only then pays. That is the whole idea. |
| 0:39 | the idea | So nobody judges. The buyer writes down what a good answer looks like, before paying. The money waits in escrow while a machine checks the answer against exactly that. |
| 0:52 | the checks | Seven questions, signed before any money moves. Did it answer two hundred. Is it really JSON. Are the addresses real. Is the data fresh. All of it arithmetic, so anyone can redo it. |
| 1:03 | architecture | Here is what actually runs. The buyer signs the checks. Hedera holds the money. The seller sells live Graph data and grades itself first. Everything lands on a public log. Blocky402 moves the money, and Bazantic makes it a tool any agent can call. |
| 1:19 | it works | A real purchase. The seller answers two hundred with live token data, all seven checks pass, and the money goes to the seller. Half an HBAR, really spent. |
| 1:31 | seven checks | These are the seven, and anyone can recompute every one. The last line is how fast it answered. That one is our own stopwatch, so we let it decide nothing. |
| 1:41 | junk answer | Same buyer, same terms. This time the seller answers two hundred with an error blob. The checks fail and the money comes back in seconds. No human, no dispute. |
| 1:53 | refunded | Nothing was wrong at the HTTP layer. Status passed. The shape of the data is what failed, and you can see exactly which fields were missing. |
| 2:03 | seller says no | Because the checks are only arithmetic, the seller can run them too. Here it grades itself, sees it would fail, and refuses the sale rather than take money it cannot keep. |
| 2:13 | seller vanishes | If the seller never answers, no verdict gets invented. The escrow expires, and a complete stranger can unlock it. The money can only go back to the buyer. |
| 2:24 | check it yourself | Now do not believe any of it. This replays every verdict ever published, straight from the public log, with no help from us. Twenty eight reproduce. Zero mismatch. |
| 2:35 | second opinion | And again in Python, no dependencies, written from the written spec. Same answer, same hash, and it is the hash the escrow recorded on chain. |
| 2:47 | the receipts | All of it is public. Here is half an HBAR leaving the escrow, on HashScan. Here is the reasoning, every check result published for every deal. And here is a real session on the live page: one button, a real deal, and every link is a transaction that just happened. |
| 3:11 | what we cannot prove | There is one thing we cannot prove. How fast the seller answered is our own stopwatch, so we publish it and let it gate no money at all. |
| 3:20 | close | x402 has no refund. Appointing a judge has been tried. It does five users a day. Receipt has no judge, because the answer is arithmetic. |

Pace is about 2.5 words a second. If you run long, cut **why not sue** and
**what we cannot prove**. Never cut **check it yourself** or **second
opinion**: those two are the reason to believe any of the rest.

---

## Questions judges ask, and the honest answer

**"Who decides what counts as a good answer?"** The buyer does, before paying,
in terms it signs. Nobody decides anything afterwards.

**"What if you lie about the verdict?"** Every deal publishes its terms, the
raw answer and the verdict to a public Hedera topic, and the escrow records the
verdict hash on chain. `pnpm verify --all` recomputes all of it from that log.
A lie would have to be a verdict that follows from inputs we also published,
which is the same as not lying.

**"You still hold the money for a moment."** Yes. Both legs are on the public
log, and the escrow checks the buyer's signature on chain, so we cannot alter
the deal we were handed. Removing that hop needs a change to x402 itself.

**"Why not let an LLM judge it?"** Then you need a judge, and somebody has to
pay it and trust it. That design shipped already. It does five users a day.

---

## Rebuilding the film

Four steps, all reproducible, and none of them records a screen.

```bash
pnpm facilitator            # :8080
pnpm seller                 # :8787

node demo/capture.mjs       # runs every scene for real, writes demo-data.js
node demo/shot.mjs          # captures the explorer pages the film shows
node demo/interact.mjs      # records a real session on the live page
node demo/render.mjs        # writes receipt-demo.mp4 and schedule.json
```

`node demo/render.mjs --at 0,40000,108000` renders single moments instead of
the whole film, which is how to check a screen without paying for a full
render. `demo/README.md` explains how it works.

---

## If you want to run it live instead

The film is the safer artifact. A live run needs testnet liquidity, a
responsive mirror node, and patience. If you do run it live:

```bash
pnpm buy honest             # releases
pnpm buy garbage            # refunds
pnpm verify --all           # replays every verdict from the public log
cd verify-py && python3 verify.py --deal <dealId> --topic 0.0.10495465
```

Better still, open the live ledger and press a button. See `DEPLOYMENTS.md` for
the URL. Every deal on it links to the transaction that moved the money, and
recomputes its own verdict in your browser.
