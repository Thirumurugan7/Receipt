// Captured from a live run against Hedera testnet by demo/capture.mjs.
// Do not edit by hand: every number here is meant to be one that happened.
window.DEMO_DATA = {
  "honest": "terms\n  resource   http://localhost:8787/api/quote?mode=honest\n  amount     50000000 tinybars (0.50000000 ℏ)\n  checks     status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds\n  products   the-graph token-api + subgraph (both asserted)\n  provenance indexedBlock >= 25962774  (eth head 25962974, tolerance 200 blocks)\n\nbuyer balance before  994.00000000 ℏ\n\n402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)\n\nseller responded HTTP 200\n  verdict        pass\n  firstFailure   (none)\n  dealId         0xff6a3996a3fe03fd47d858139d5ae6988643e3aaf7c6aeae83a229b455627b0f\n  settlement tx  0.0.7162784@1789235851.125983072\n  open tx        0xd1c5caf9dba3acd7d076795a8780df51e6eb623030e8edf30d77513e9997819b\n  resolve tx     0x85d4c887761b8dbce3b7c50838cb61b915176589cbc83ba1186790610223fb83\n\nbody: {\"source\":\"the-graph\",\"sources\":{\"balances\":\"token-api\",\"markets\":\"subgraph\"},\"address\":\"0x28C6c06298d514Db089934071355E5743bf21d60\",\"network\":\"mainnet\",\"data\":[{\"contract\":\"0xdac17f958d2ee523a2206206994597c13d831ec7\",\"symbol\":\"USDT\",\"name\":\"Tether\",\"amount\":\"1033271238875883\",\"decimals\":6,\"value\":1\n\nbuyer balance after   993.50000000 ℏ\nbuyer delta           -0.50000000 ℏ\n\nchecks passed -> funds released to the seller",
  "garbage": "terms\n  resource   http://localhost:8787/api/quote?mode=garbage\n  amount     50000000 tinybars (0.50000000 ℏ)\n  checks     status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds\n  products   the-graph token-api + subgraph (both asserted)\n  provenance indexedBlock >= 25962777  (eth head 25962977, tolerance 200 blocks)\n\nbuyer balance before  993.50000000 ℏ\n\n402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)\n\nseller responded HTTP 200\n  verdict        fail\n  firstFailure   requiredPaths\n  dealId         0xc95d7385e1c2ed761cddc0bbad2db9d7685a35e621492ca65b00be5b13512d39\n  settlement tx  0.0.7162784@1789235880.634972374\n  open tx        0x5548e373b7425f2d3dc0f8dda3bb5b7e64a1effb101e4ed62ccc23fc642070c6\n  resolve tx     0x4518720ae940b5b939c7993fb602d87c1470f969a6d2573ac361e0c671150742\n\nbody: {\"error\":\"upstream rate limited\"}\n\nbuyer balance after   993.50000000 ℏ\nbuyer delta           0.00000000 ℏ\n\nchecks failed -> funds refunded to the buyer",
  "subtle": "terms\n  resource   http://localhost:8787/api/quote?mode=subtle\n  amount     50000000 tinybars (0.50000000 ℏ)\n  checks     status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds\n  products   the-graph token-api + subgraph (both asserted)\n  provenance indexedBlock >= 25962778  (eth head 25962978, tolerance 200 blocks)\n\nbuyer balance before  993.50000000 ℏ\n\n402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)\n\nseller responded HTTP 200\n  verdict        fail\n  firstFailure   freshness\n  dealId         0xa15753855833ac674434aa0584dd044c26f6a67b2108fa64982e60555eae437d\n  settlement tx  0.0.7162784@1789235900.765160571\n  open tx        0x6cd093a24582d1b70c2c4d780313aba0ffecd71e441346317f274e417f342dc6\n  resolve tx     0x139fba5677838123aefbe269b71393666ed114e3302a9179e206ed3111872bf8\n\nbody: {\"source\":\"the-graph\",\"sources\":{\"balances\":\"token-api\",\"markets\":\"subgraph\"},\"address\":\"0x28C6c06298d514Db089934071355E5743bf21d60\",\"network\":\"mainnet\",\"data\":[{\"contract\":\"0xdac17f958d2ee523a2206206994597c13d831ec7\",\"symbol\":\"USDT\",\"name\":\"Tether\",\"amount\":\"1033270303761112\",\"decimals\":6,\"value\":1\n\nbuyer balance after   993.50000000 ℏ\nbuyer delta           0.00000000 ℏ\n\nchecks failed -> funds refunded to the buyer",
  "selfcheck": "terms\n  resource   http://localhost:8787/api/quote?mode=subtle&selfcheck=1\n  amount     50000000 tinybars (0.50000000 ℏ)\n  checks     status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds\n  products   the-graph token-api + subgraph (both asserted)\n  selfcheck  seller will grade its own response before answering\n  provenance indexedBlock >= 25962780  (eth head 25962980, tolerance 200 blocks)\n\nbuyer balance before  993.50000000 ℏ\n\n402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)\n\nseller responded HTTP 409\n  the seller DECLINED the sale\n  it ran the buyer's own checks, saw it would fail on: freshness\n  and refused rather than take a payment it could not keep\n  verdict        fail\n  firstFailure   status\n  dealId         0x6850217d3398ce8200eeb8827eab757871751a028eb1176361fa73ce3c479e3a\n  settlement tx  0.0.7162784@1789235925.967959941\n  open tx        0xe0a0e49511462cbcf848b21ceb1d0b61e979e296e06617aea2283b4e839e878a\n  resolve tx     0x07896ae1143b240a5613b733c7c61482e3f431d5cd0c3dc5d4e7f303ffcf1f89\n\nbody: {\"declined\":true,\"reason\":\"freshness\",\"detail\":\"the seller ran the buyer's own acceptance checks against this response, saw that it would be rejected, and declined the sale rather than take a payment it could not keep\",\"checks\":[{\"check\":\"status\",\"pass\":true},{\"check\":\"contentType\",\"pass\":true},{\"ch\n\nbuyer balance after   993.50000000 ℏ\nbuyer delta           0.00000000 ℏ\n\nchecks failed -> funds refunded to the buyer",
  "dead": "terms\n  resource   http://localhost:8787/api/quote?mode=dead\n  amount     50000000 tinybars (0.50000000 ℏ)\n  checks     status, contentType, minBytes, maxLatencyMs, requiredPaths, jsonSchema, freshnessSeconds\n  products   the-graph token-api + subgraph (both asserted)\n  provenance indexedBlock >= 25962783  (eth head 25962983, tolerance 200 blocks)\n\nbuyer balance before  993.50000000 ℏ\n\n402 payment required -> payTo 0.0.2672117 (the facilitator, not the seller)\n\nHTTP 504 — seller did not respond\n  dealId          0x194e31552fbf732bbc301c08b5197515ab764cbe56269b150c003a2a55f6cf8e\n  escrow          still Open; no verdict was published\n\nbuyer balance now     993.00000000 ℏ\nbuyer delta           -0.50000000 ℏ  (still escrowed)\n\nrecover it with:  pnpm claim --deal 0x194e31552fbf732bbc301c08b5197515ab764cbe56269b150c003a2a55f6cf8e\n\nclaimExpired — called by an unrelated third party\n  caller (stranger)  0x13DD3C134DE76eb85dAb76Bf3d3D4e435Dbe5770\n  deal               0x194e31552fbf732bbc301c08b5197515ab764cbe56269b150c003a2a55f6cf8e\n  payer              0xe748C0793Ee92098dcBf37c6557ff17836d40CC1\n  payee              0xf603bEc282b1F50e851C6470828b1b12A851Bd50\n  amount             50000000 tinybars\n  status             Open\n  deadline           1789236013 (2s from now)\n\npayer balance before 993.00000000 ℏ\n\ndeadline has not passed; waiting 4s so the revert is not the point of the demo…\n\nclaimExpired tx 0xf8e54d584b2093cbf302077c3ffd8f8ae3c473a7d33d0d710fa0bcc5630cba35\n  status success\n  deal is now Refunded\n\npayer balance after  993.50000000 ℏ\npayer delta          0.50000000 ℏ\n\nthe funds went to the payer. The caller could not have sent them anywhere else.",
  "verifyOne": "Receipt — independent verdict verification\n  topic                     0.0.10495465\n  deal                      0xff6a3996a3fe03fd47d858139d5ae6988643e3aaf7c6aeae83a229b455627b0f\n  mirror node               https://testnet.mirrornode.hedera.com\n  escrow                    0x3483b3761ebe3c2fc2eb3efe8215a7cf90634071\n\npublic log\n  messages for this deal    3\n  terms                     seq #133\n  observation               seq #135  status 200  1897 bytes\n  verdict                   seq #139\n\nre-running the adjudicator offline\n  checks recomputed         7\n  reproducible[] identical  YES\n  pass recomputed           true\n  pass published            true\n\nhashes\n  recomputed verdictHash    0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce\n  published verdictHash     0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce\n  on-chain verdictHash      0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce  (DealReleased)\n\nsettlement legs recorded on the log\n  x402 settlement           0.0.7162784@1789235851.125983072\n  open()                    0xd1c5caf9dba3acd7d076795a8780df51e6eb623030e8edf30d77513e9997819b\n  release()/refund()        0x85d4c887761b8dbce3b7c50838cb61b915176589cbc83ba1186790610223fb83\n\nMATCH\n  the verdict follows from the published terms and response, and its hash is the one the escrow recorded.",
  "verifyAll": "  0xb533d8ea…  no verdict — seller never answered (by design)\n  0x14541bd2…  MATCH   released\n  0xdeb21ee1…  MATCH   refunded (requiredPaths)\n  0x0dc4096b…  MATCH   released\n  0x432e57e0…  MATCH   refunded (requiredPaths)\n  0xfd18f47c…  no verdict — seller never answered (by design)\n  0x80f153a3…  MATCH   released\n  0x5d6d709f…  MATCH   released\n  0xbf70816f…  MATCH   refunded (requiredPaths)\n  0x0e35916f…  no verdict — seller never answered (by design)\n  0xfbc68a11…  MATCH   refunded (freshness)\n  0x85fb12da…  MATCH   released\n  0xdfea4b07…  MATCH   released\n  0xef8f6a21…  MATCH   released\n  0x025c3af5…  MATCH   released\n  0xfd6d59e7…  MATCH   refunded (status)\n  0x3853d7fa…  MATCH   refunded (status)\n  0xff6a3996…  MATCH   released\n  0xc95d7385…  MATCH   refunded (requiredPaths)\n  0xa1575385…  MATCH   refunded (freshness)\n  0x6850217d…  MATCH   refunded (status)\n  0x194e3155…  no verdict — seller never answered (by design)\n\n  reproduce        28\n  mismatch         0\n  no verdict       6   (seller never answered — correct behaviour)\n\nALL 28 VERDICTS REPRODUCE\n  every verdict this facilitator published follows from its own published\n  inputs. Recomputed independently, with no cooperation from it.",
  "python": "Receipt — independent verification (python, zero dependencies)\n  topic                       0.0.10495465\n  deal                        0xff6a3996a3fe03fd47d858139d5ae6988643e3aaf7c6aeae83a229b455627b0f\n  mirror node                 https://testnet.mirrornode.hedera.com\n\npublic log\n  messages for this deal      3\n  observation                 status 200  1897 bytes\n\nre-running the adjudicator, implemented here from SPEC.md\n    status          pass  agree\n    contentType     pass  agree\n    minBytes        pass  agree\n    requiredPaths   pass  agree\n    jsonSchema      pass  agree\n    freshness       pass  agree\n    expectedHash    pass  agree\n  verdict pass recomputed     True\n  verdict pass published      True\n  firstFailure recomputed     None\n  firstFailure published      None\n  responseHash recomputed     0x435cbd5704a0497c1c419a5ab0279bd1f66bdf300abf0fd021f0c04e0717d2c0\n  responseHash published      0x435cbd5704a0497c1c419a5ab0279bd1f66bdf300abf0fd021f0c04e0717d2c0\n\nhashes\n  recomputed verdictHash      0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce\n  published verdictHash       0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce\n  on-chain verdictHash        0xbf851c854bb38caf7d13d57e95ac3c7c0200752fd972a594cda4a127e49fb7ce  (DealReleased)\n\nMATCH\n  a second implementation, sharing no code with the first, reached the same\n  verdict and the same hash — the one the escrow recorded.",
  "conformance": "cross-implementation conformance — 12 cases\n\n  ok    honest               pass=True  first=-\n  ok    garbage              pass=False first=requiredPaths\n  ok    stale                pass=False first=freshness\n  ok    empty-holdings       pass=False first=jsonSchema\n  ok    forged-source        pass=False first=jsonSchema\n  ok    markets-missing      pass=False first=jsonSchema\n  ok    sources-half-claimed pass=False first=jsonSchema\n  ok    stale-indexed-block  pass=False first=jsonSchema\n  ok    bad-amount           pass=False first=jsonSchema\n  ok    bad-contract         pass=False first=jsonSchema\n  ok    wrong-status         pass=False first=status\n  ok    wrong-content-type   pass=False first=contentType\n\nall cases agree: two independent implementations, identical verdicts and hashes",
  "verdicts": {
    "honest": {
      "dealId": "0xff6a3996a3fe03fd47d858139d5ae6988643e3aaf7c6aeae83a229b455627b0f",
      "reproducible": [
        {
          "check": "status",
          "pass": true
        },
        {
          "check": "contentType",
          "pass": true
        },
        {
          "check": "minBytes",
          "pass": true
        },
        {
          "check": "requiredPaths",
          "pass": true
        },
        {
          "check": "jsonSchema",
          "pass": true
        },
        {
          "check": "freshness",
          "pass": true
        },
        {
          "check": "expectedHash",
          "pass": true,
          "skipped": true
        }
      ],
      "attested": [
        {
          "check": "maxLatencyMs",
          "pass": true,
          "observed": 4375
        }
      ],
      "pass": true,
      "firstFailure": null,
      "observedBytes": 1897,
      "observedStatus": 200,
      "latencyMs": 4375
    },
    "garbage": {
      "dealId": "0xc95d7385e1c2ed761cddc0bbad2db9d7685a35e621492ca65b00be5b13512d39",
      "reproducible": [
        {
          "check": "status",
          "pass": true
        },
        {
          "check": "contentType",
          "pass": true
        },
        {
          "check": "minBytes",
          "pass": true
        },
        {
          "check": "requiredPaths",
          "pass": false,
          "detail": "missing $.data, $.markets, $.sources.balances, $.sources.markets, $.indexedBlock, $.timestamp"
        },
        {
          "check": "jsonSchema",
          "pass": false,
          "detail": "/: must have required property 'data'; /: must have required property 'markets'; /: must have required property 'sources'; /: must have required property 'indexedBlock'; /: must have required property 'source'; /: must have required property 'timestamp'"
        },
        {
          "check": "freshness",
          "pass": false,
          "detail": "$.timestamp missing or unparseable"
        },
        {
          "check": "expectedHash",
          "pass": true,
          "skipped": true
        }
      ],
      "attested": [
        {
          "check": "maxLatencyMs",
          "pass": true,
          "observed": 53
        }
      ],
      "pass": false,
      "firstFailure": "requiredPaths",
      "observedBytes": 33,
      "observedStatus": 200,
      "latencyMs": 53
    },
    "subtle": {
      "dealId": "0xa15753855833ac674434aa0584dd044c26f6a67b2108fa64982e60555eae437d",
      "reproducible": [
        {
          "check": "status",
          "pass": true
        },
        {
          "check": "contentType",
          "pass": true
        },
        {
          "check": "minBytes",
          "pass": true
        },
        {
          "check": "requiredPaths",
          "pass": true
        },
        {
          "check": "jsonSchema",
          "pass": true
        },
        {
          "check": "freshness",
          "pass": false,
          "detail": "timestamp is 7235.528s from request, limit 3600s"
        },
        {
          "check": "expectedHash",
          "pass": true,
          "skipped": true
        }
      ],
      "attested": [
        {
          "check": "maxLatencyMs",
          "pass": true,
          "observed": 2608
        }
      ],
      "pass": false,
      "firstFailure": "freshness",
      "observedBytes": 1904,
      "observedStatus": 200,
      "latencyMs": 2608
    }
  },
  "capturedAt": "2026-09-12T18:02:31.848Z"
};
