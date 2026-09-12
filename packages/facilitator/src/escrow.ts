/**
 * Escrow calls. The facilitator is the adjudicator key here: it funds open()
 * with the HBAR it just received from settlement, and it alone may release or
 * refund — but only for a deal the buyer signed, and only to the two addresses
 * in that signature.
 */
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { floorDeadlineToSeconds, hashTerms, dealId as computeDealId } from '@receipt/core'
import type { Hex, Terms } from '@receipt/core'
import { config } from './env.js'

export const chain = defineChain({
  id: config.chainId,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
})

export const escrowAbi = parseAbi([
  'function open(address payer,address payee,uint256 amount,bytes32 termsHash,uint64 deadline,bytes32 nonce,bytes signature) payable returns (bytes32)',
  'function release(bytes32 dealId,bytes32 verdictHash)',
  'function refund(bytes32 dealId,bytes32 verdictHash,string reason)',
  'function claimExpired(bytes32 dealId)',
  'function deals(bytes32) view returns (address payer,address payee,uint256 amount,bytes32 termsHash,uint64 openedAt,uint64 deadline,uint8 status)',
  'function valueScale() view returns (uint256)',
  'error BadSignature()','error ValueMismatch(uint256 expected,uint256 received)',
  'error DeadlineInPast()','error DealExists()','error DealNotOpen()','error NotAdjudicator()',
])

export const publicClient = createPublicClient({ chain, transport: http() })
const adjudicator = privateKeyToAccount(config.adjudicatorKey)
const wallet = createWalletClient({ account: adjudicator, chain, transport: http() })

export const adjudicatorAddress = adjudicator.address

/**
 * Hedera's relay takes `value` in WEIBARS and divides by 1e10, so Solidity
 * sees tinybars. The signed amount is already tinybars, hence the multiply
 * here and valueScale = 1 in the contract. See DEPLOYMENTS.md.
 */
const WEIBARS_PER_TINYBAR = 10_000_000_000n

export async function open(terms: Terms, signature: Hex): Promise<{ hash: Hex; dealId: Hex }> {
  const amount = BigInt(terms.amount)
  const hash = await wallet.writeContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: 'open',
    args: [
      terms.payer, terms.payee, amount, hashTerms(terms),
      floorDeadlineToSeconds(terms.deadlineMs), terms.nonce, signature,
    ],
    value: amount * WEIBARS_PER_TINYBAR,
    gas: 1_000_000n,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return { hash, dealId: computeDealId(terms) }
}

export async function release(dealId: Hex, verdictHash: Hex): Promise<Hex> {
  const hash = await wallet.writeContract({
    address: config.escrow, abi: escrowAbi, functionName: 'release',
    args: [dealId, verdictHash], gas: 1_000_000n,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export async function refund(dealId: Hex, verdictHash: Hex, reason: string): Promise<Hex> {
  const hash = await wallet.writeContract({
    address: config.escrow, abi: escrowAbi, functionName: 'refund',
    args: [dealId, verdictHash, reason], gas: 1_000_000n,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export async function readDeal(dealId: Hex) {
  const d = await publicClient.readContract({
    address: config.escrow, abi: escrowAbi, functionName: 'deals', args: [dealId],
  })
  const status = ['None', 'Open', 'Released', 'Refunded'][d[6]] ?? 'Unknown'
  return { payer: d[0], payee: d[1], amount: d[2], termsHash: d[3], openedAt: d[4], deadline: d[5], status }
}
