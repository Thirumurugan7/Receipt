import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { hashTypedData, keccak256, toBytes } from 'viem'
import { EIP712_TERMS_TYPES } from '../src/terms.js'

/**
 * The other half of the cross-language pin. ReceiptEscrow's Solidity test
 * asserts the same fixture, so a change to the struct on either side fails
 * loudly here instead of surfacing as "BadSignature" during a live request.
 */
const fixture = JSON.parse(
  readFileSync(new URL('../../contracts/test/fixtures/eip712.json', import.meta.url), 'utf8'),
)

describe('EIP-712 interop with ReceiptEscrow.sol', () => {
  test('the type string derived from EIP712_TERMS_TYPES matches the contract', () => {
    const fields = EIP712_TERMS_TYPES.Terms.map((f) => `${f.type} ${f.name}`).join(',')
    expect(keccak256(toBytes(`Terms(${fields})`))).toBe(fixture.typeHash)
  })

  test('viem produces the digest the contract recovers against', () => {
    const digest = hashTypedData({
      domain: {
        name: 'Receipt',
        version: '1',
        chainId: fixture.chainId,
        verifyingContract: fixture.verifyingContract,
      },
      types: EIP712_TERMS_TYPES,
      primaryType: 'Terms',
      message: {
        termsHash: fixture.termsHash,
        payer: fixture.payer,
        payee: fixture.payee,
        amount: BigInt(fixture.amount),
        deadline: BigInt(fixture.deadline),
        nonce: fixture.nonce,
      },
    })
    expect(digest).toBe(fixture.digest)
  })

  test('the domain is the one the contract constructs', () => {
    expect(fixture.chainId).toBe(296)
    const wrongDomain = hashTypedData({
      domain: { name: 'Receipt', version: '2', chainId: 296, verifyingContract: fixture.verifyingContract },
      types: EIP712_TERMS_TYPES,
      primaryType: 'Terms',
      message: {
        termsHash: fixture.termsHash,
        payer: fixture.payer,
        payee: fixture.payee,
        amount: BigInt(fixture.amount),
        deadline: BigInt(fixture.deadline),
        nonce: fixture.nonce,
      },
    })
    expect(wrongDomain).not.toBe(fixture.digest)
  })
})
