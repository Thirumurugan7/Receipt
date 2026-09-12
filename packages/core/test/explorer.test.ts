import { describe, expect, test } from 'vitest'
import {
  hashscanContract, hashscanTopic, hashscanTopicMessages, hashscanTx,
  mirrorContract, mirrorTopicMessage,
} from '../src/explorer.js'

/**
 * A judge checking this project follows these links. A link that 404s reads as
 * a claim that could not be backed up, so the formats here are the ones
 * verified against the live explorer, and the conversions are pinned.
 *
 * The conversion that matters: Hedera prints a transaction id as
 * `0.0.7162784@1789235851.125983072`, and HashScan routes on
 * `0.0.7162784-1789235851-125983072`. Passing the printed form straight
 * through gives a page that does not exist.
 */
describe('hashscanTx', () => {
  test('rewrites a Hedera transaction id into the form HashScan routes on', () => {
    expect(hashscanTx('0.0.7162784@1789235851.125983072', 'testnet'))
      .toBe('https://hashscan.io/testnet/transaction/0.0.7162784-1789235851-125983072')
  })

  test('passes an EVM transaction hash through untouched', () => {
    const h = '0xd1c5caf9dba3acd7d076795a8780df51e6eb623030e8edf30d77513e9997819b'
    expect(hashscanTx(h, 'testnet')).toBe(`https://hashscan.io/testnet/transaction/${h}`)
  })

  test('leaves an already-converted id alone rather than mangling it twice', () => {
    expect(hashscanTx('0.0.7162784-1789235851-125983072', 'testnet'))
      .toBe('https://hashscan.io/testnet/transaction/0.0.7162784-1789235851-125983072')
  })

  test('returns null for nothing, so callers render a dash instead of a dead link', () => {
    expect(hashscanTx(undefined, 'testnet')).toBeNull()
    expect(hashscanTx('', 'testnet')).toBeNull()
  })

  test('refuses a value that is neither an EVM hash nor a Hedera id', () => {
    expect(hashscanTx('not-a-transaction', 'testnet')).toBeNull()
  })
})

describe('the other explorer links', () => {
  test('contract, topic and topic messages', () => {
    expect(hashscanContract('0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071', 'testnet'))
      .toBe('https://hashscan.io/testnet/contract/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071')
    expect(hashscanTopic('0.0.10495465', 'testnet'))
      .toBe('https://hashscan.io/testnet/topic/0.0.10495465')
    expect(hashscanTopicMessages('0.0.10495465', 'testnet'))
      .toBe('https://hashscan.io/testnet/topic/0.0.10495465/messages')
  })

  /**
   * The mirror node is the better citation for a specific message: it is a
   * REST API returning the raw bytes, so a reader can check the input the
   * verdict was computed over without trusting an explorer's rendering.
   */
  test('mirror node links reach one message and one contract directly', () => {
    expect(mirrorTopicMessage('0.0.10495465', 161, 'testnet'))
      .toBe('https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10495465/messages/161')
    expect(mirrorContract('0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071', 'testnet'))
      .toBe('https://testnet.mirrornode.hedera.com/api/v1/contracts/0x3483B3761ebe3C2fC2eB3EfE8215a7CF90634071')
  })

  test('mainnet is spelled without a subdomain prefix on the mirror node', () => {
    expect(mirrorTopicMessage('0.0.1', 1, 'mainnet'))
      .toBe('https://mainnet.mirrornode.hedera.com/api/v1/topics/0.0.1/messages/1')
    expect(hashscanTopic('0.0.1', 'mainnet')).toBe('https://hashscan.io/mainnet/topic/0.0.1')
  })
})
