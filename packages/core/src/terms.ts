import canonicalize from 'canonicalize'
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  recoverTypedDataAddress,
  toBytes,
} from 'viem'
import type { TypedDataDefinition } from 'viem'
import type { Hex, Terms } from './types.js'
import { floorDeadlineToSeconds } from './units.js'

export interface ReceiptDomain {
  name: string
  version: string
  chainId: number
  verifyingContract: Hex
}

export const EIP712_TERMS_TYPES = {
  Terms: [
    { name: 'termsHash', type: 'bytes32' },
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

/**
 * RFC 8785 JSON Canonicalization Scheme. Never hash JSON.stringify output:
 * key order and number formatting are not stable across producers, and the
 * whole reproducibility claim rests on two machines agreeing byte-for-byte.
 */
export function jcs(value: unknown): string {
  const out = canonicalize(value)
  if (out === undefined) throw new Error('value is not JCS-serialisable')
  return out
}

export function hashJcs(value: unknown): Hex {
  return keccak256(toBytes(jcs(value)))
}

export function hashTerms(terms: Terms): Hex {
  return hashJcs(terms)
}

/** Matches the contract: keccak256(abi.encode(payer, payee, nonce)). */
export function dealId(terms: Terms): Hex {
  return keccak256(
    encodeAbiParameters(parseAbiParameters('address, address, bytes32'), [
      terms.payer,
      terms.payee,
      terms.nonce,
    ]),
  )
}

/**
 * The EIP-712 payload the buyer signs. It commits to the full terms via
 * `termsHash` AND repeats the economically meaningful fields, so `open()` can
 * check that the facilitator did not alter the amount, payee or deadline on
 * the way through. That is what makes the one-hop custody survivable.
 */
export function termsTypedData(terms: Terms, domain: ReceiptDomain) {
  return {
    domain,
    types: EIP712_TERMS_TYPES,
    primaryType: 'Terms' as const,
    message: {
      termsHash: hashTerms(terms),
      payer: terms.payer,
      payee: terms.payee,
      amount: BigInt(terms.amount),
      deadline: floorDeadlineToSeconds(terms.deadlineMs),
      nonce: terms.nonce,
    },
  }
}

export function encodeTermsHeader(terms: Terms): string {
  return Buffer.from(jcs(terms), 'utf8').toString('base64url')
}

export function decodeTermsHeader(header: string): Terms {
  return JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) as Terms
}

/** Anything that can sign EIP-712 — a viem account, or a wallet client. */
export interface TypedDataSigner {
  signTypedData(parameters: TypedDataDefinition): Promise<Hex>
}

/**
 * The EIP-712 payload, shaped so viem accepts it without casts and so the
 * facilitator is not left wrestling generics at the call site.
 */
export function termsTypedDataDefinition(terms: Terms, domain: ReceiptDomain): TypedDataDefinition {
  return termsTypedData(terms, domain) as unknown as TypedDataDefinition
}

export async function signTerms(
  terms: Terms,
  domain: ReceiptDomain,
  signer: TypedDataSigner,
): Promise<Hex> {
  return signer.signTypedData(termsTypedDataDefinition(terms, domain))
}

export async function recoverTermsSigner(
  terms: Terms,
  domain: ReceiptDomain,
  signature: Hex,
): Promise<Hex> {
  return recoverTypedDataAddress({
    ...(termsTypedDataDefinition(terms, domain) as Parameters<typeof recoverTypedDataAddress>[0]),
    signature,
  })
}

/**
 * True when `signature` is the payer's signature over exactly these terms.
 * Because the signed struct carries `termsHash`, altering any part of the
 * terms document — including a check the struct does not name individually —
 * changes the digest and fails here.
 */
export async function verifyTermsSignature(
  terms: Terms,
  domain: ReceiptDomain,
  signature: Hex,
): Promise<boolean> {
  try {
    const recovered = await recoverTermsSigner(terms, domain, signature)
    return recovered.toLowerCase() === terms.payer.toLowerCase()
  } catch {
    return false
  }
}
