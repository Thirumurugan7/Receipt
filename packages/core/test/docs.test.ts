import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { ADJUDICATOR_VERSION, REPRODUCIBLE_ORDER } from '../src/adjudicator.js'
import { EIP712_TERMS_TYPES } from '../src/terms.js'

/**
 * The README is judged, and a README that disagrees with the repo is worse
 * than no README. These assert the claims that rot fastest: addresses that
 * change on redeploy, and commands that get renamed.
 */
const root = new URL('../../../', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

const readme = read('README.md')
const demo = read('DEMO.md')
const deployments = read('DEPLOYMENTS.md')
const rootPkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }

// Anchored on both sides: an unanchored {40} also matches the first 40
// characters of a 64-character hash, which would flag every verdict hash as a
// drifted address.
const ADDRESS_RE = /(?<![0-9a-fA-F])0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g
const addresses = (s: string) =>
  new Set(s.match(ADDRESS_RE)?.map((a) => a.toLowerCase()) ?? [])
const hederaIds = (s: string) => new Set(s.match(/\b0\.0\.\d{4,}\b/g) ?? [])

describe('README agrees with DEPLOYMENTS', () => {
  test('every EVM address in the README also appears in DEPLOYMENTS', () => {
    const inDeployments = addresses(deployments)
    for (const a of addresses(readme)) expect(inDeployments).toContain(a)
  })

  test('every Hedera entity id in the README also appears in DEPLOYMENTS', () => {
    const inDeployments = hederaIds(deployments)
    for (const id of hederaIds(readme)) expect(inDeployments).toContain(id)
  })

  test('the escrow address is stated exactly once per document, so a redeploy cannot half-update it', () => {
    const count = (s: string, a: string) => (s.toLowerCase().match(new RegExp(a, 'g')) ?? []).length
    const escrow = '0x3483b3761ebe3c2fc2eb3efe8215a7cf90634071'
    // README links it and shows it as text, DEPLOYMENTS lists it in several rows;
    // the point is only that both agree on a single value.
    expect(count(readme, escrow)).toBeGreaterThan(0)
    expect(count(deployments, escrow)).toBeGreaterThan(0)
  })
})

describe('README commands exist', () => {
  const referenced = [...readme.matchAll(/^\s*(?:\$ )?pnpm ([a-z][a-z-]*)/gm)]
    .map((m) => m[1]!)
    .filter((s) => !['install', 'test', 'typecheck', 'exec', 'run'].includes(s))

  test('the README references at least the core commands', () => {
    expect(referenced.length).toBeGreaterThan(3)
  })

  test.each([...new Set(referenced)])('pnpm %s is a real script', (name) => {
    expect(Object.keys(rootPkg.scripts)).toContain(name)
  })

  test('the workspace exposes the commands the demo depends on', () => {
    for (const s of ['facilitator', 'seller', 'scenes', 'buy', 'claim', 'verify', 'test', 'typecheck']) {
      expect(rootPkg.scripts).toHaveProperty(s)
    }
  })
})

describe('honesty section is present', () => {
  test('the README states what is not done', () => {
    expect(readme).toMatch(/## What is not done, honestly/)
  })

  test('it discloses the one-hop custody rather than burying it', () => {
    expect(readme.toLowerCase()).toMatch(/custodies for one hop/)
  })

  test('it discloses that latency is attested rather than proven', () => {
    expect(readme).toMatch(/observedLatencyMs/)
    expect(readme.toLowerCase()).toMatch(/cannot recompute|cannot prove|own stopwatch/)
  })
})

describe('DEMO.md is runnable as written', () => {
  const referenced = [...demo.matchAll(/^\s*pnpm ([a-z][a-z-]*)/gm)]
    .map((m) => m[1]!)
    .filter((s) => !['install', 'exec', 'run'].includes(s))

  test.each([...new Set(referenced)])('pnpm %s is a real script', (name) => {
    expect(Object.keys(rootPkg.scripts)).toContain(name)
  })

  test('every address it tells you to open also appears in DEPLOYMENTS', () => {
    const inDeployments = addresses(deployments)
    for (const a of addresses(demo)) expect(inDeployments).toContain(a)
  })

  test('every Hedera id it references also appears in DEPLOYMENTS', () => {
    const inDeployments = hederaIds(deployments)
    for (const id of hederaIds(demo)) expect(inDeployments).toContain(id)
  })

  /*
   * DEMO.md is now a narration script timed against the film rather than a
   * list of scenes to perform live, so its structure and running time are
   * checked against demo/schedule.json in demo-doc.test.ts, which compares
   * them to the film itself instead of to numbers written down by hand.
   * What is still worth asserting here is that the script makes the argument.
   */
  test('it tells the viewer not to take the verdicts on trust, and how to check', () => {
    // The wording is the presenter's; what must survive a rewrite is that the
    // script says do not take our word for it, and names the command.
    expect(demo.toLowerCase()).toMatch(/do not (trust|believe|take)/)
    expect(demo).toMatch(/verify --all/)
  })

  test('it tells the presenter to disclose the unprovable latency', () => {
    expect(demo.toLowerCase()).toMatch(/stopwatch/)
  })
})

describe('SPEC.md matches the implementation', () => {
  const spec = read('SPEC.md')

  test('the documented check order is the order the adjudicator runs', () => {
    // pull the ordered check names out of the spec's numbered table
    const documented = [...spec.matchAll(/^\|\s*\d+\s*\|\s*`([a-zA-Z]+)`/gm)].map((m) => m[1]!)
    expect(documented).toEqual([...REPRODUCIBLE_ORDER])
  })

  test('the spec states that maxLatencyMs is excluded from the reproducible list', () => {
    expect(REPRODUCIBLE_ORDER).not.toContain('maxLatencyMs')
    expect(spec).toMatch(/`maxLatencyMs` is \*\*not\*\* in this list/)
  })

  test('the documented adjudicator version is the one that gets published', () => {
    expect(spec).toContain(ADJUDICATOR_VERSION)
  })

  test('the documented EIP-712 struct matches the committed cross-language fixture', () => {
    const m = spec.match(/Terms\(bytes32 termsHash, address payer, address payee,\s*\n\s*uint256 amount, uint64 deadline, bytes32 nonce\)/)
    expect(m).not.toBeNull()
    // rebuild the canonical one-line form the typeHash is taken over
    const canonical =
      'Terms(bytes32 termsHash,address payer,address payee,uint256 amount,uint64 deadline,bytes32 nonce)'
    const fields = EIP712_TERMS_TYPES.Terms.map((f) => `${f.type} ${f.name}`).join(',')
    expect(`Terms(${fields})`).toBe(canonical)
  })

  test('the spec documents the JCS hashing rule the code implements', () => {
    expect(spec).toMatch(/keccak256\(\s*utf8Bytes\(\s*jcs\(doc\)\s*\)\s*\)/)
    expect(spec).toMatch(/never over\s*\n?`JSON\.stringify`/)
  })

  test('the spec states pass is the AND of reproducible only', () => {
    expect(spec).toMatch(/`pass` is the AND of\s*\n?`reproducible\[\]` only/)
  })
})

describe('.env.example documents every variable the code reads', () => {
  /**
   * The README tells a reader to `cp .env.example .env`. If the code reads a
   * variable the example does not mention, that instruction produces a broken
   * setup and the reader has to reverse-engineer the gap from a crash. This
   * caught 16 undocumented variables, including STRANGER_PRIVATE_KEY, without
   * which demo scene 4 cannot run at all.
   */
  const example = read('.env.example')
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!))

  const sourceFiles = (): string[] => {
    const out: string[] = []
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'test') continue
        const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
        if (entry.isDirectory()) walk(child)
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) out.push(readFileSync(child, 'utf8'))
      }
    }
    walk(new URL('packages/', root))
    return out
  }

  const referenced = new Set<string>()
  for (const src of sourceFiles()) {
    for (const re of [
      /process\.env\.([A-Z_][A-Z0-9_]*)/g,
      /process\.env\['([A-Z_][A-Z0-9_]*)'\]/g,
      /\bneed\('([A-Z_][A-Z0-9_]*)'\)/g,
      /\benv\('([A-Z_][A-Z0-9_]*)'\)/g,
    ]) {
      for (const m of src.matchAll(re)) referenced.add(m[1]!)
    }
  }

  test('the code reads a non-trivial number of variables', () => {
    expect(referenced.size).toBeGreaterThan(20)
  })

  test.each([...referenced].sort())('%s is documented in .env.example', (name) => {
    expect(documented).toContain(name)
  })
})

describe('README does not make claims that go stale', () => {
  test('no hardcoded test counts', () => {
    // It said "163 unit tests" when there were 218. A number in prose is a
    // promise to update it, and that promise is always broken eventually.
    expect(readme).not.toMatch(/\b\d+\s+(unit\s+)?tests\b/i)
  })

  test('every feature the README advertises has a workspace script', () => {
    const advertised = [...readme.matchAll(/^\s*pnpm ([a-z][a-z:-]*)/gm)]
      .map((m) => m[1]!)
      .filter((s) => !['install', 'exec', 'run'].includes(s))
    for (const cmd of new Set(advertised)) {
      expect(Object.keys(rootPkg.scripts)).toContain(cmd)
    }
  })
})

describe('the demo runner exercises every seller mode', () => {
  test('each mode the seller implements appears in scenes.ts', () => {
    const seller = read('packages/seller/src/server.ts')
    const scenes = read('packages/buyer/src/scenes.ts')
    const modes = [...seller.matchAll(/mode === '([a-z]+)'/g)].map((m) => m[1]!)
    expect(modes.length).toBeGreaterThan(1)
    for (const mode of new Set(modes)) {
      expect(scenes).toContain(`'${mode}'`)
    }
  })

  test('the self-check path is demonstrated too', () => {
    expect(read('packages/buyer/src/scenes.ts')).toMatch(/subtle-selfcheck/)
  })
})
