/**
 * Spike 2: open() then release() against the LIVE escrow on Hedera testnet.
 * Exercises the two things unit tests cannot: the tinybar->weibar conversion
 * against a real msg.value, and on-chain ECDSA recovery of a signature that
 * viem produced.
 */
import '@receipt/core/loadenv'
import {
  createPublicClient, createWalletClient, defineChain, http, parseAbi, toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hashTerms, termsTypedData, dealId as computeDealId, tinybarsToWeibars, floorDeadlineToSeconds } from '@receipt/core'
import type { Terms } from '@receipt/core'

const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const hedera = defineChain({
  id: 296,
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [env('HEDERA_RPC_URL')] } },
})

const ESCROW = env('ESCROW_ADDRESS') as `0x${string}`
const abi = parseAbi([
  'function open(address payer,address payee,uint256 amount,bytes32 termsHash,uint64 deadline,bytes32 nonce,bytes signature) payable returns (bytes32)',
  'function release(bytes32 dealId,bytes32 verdictHash)',
  'function deals(bytes32) view returns (address payer,address payee,uint256 amountWeibars,bytes32 termsHash,uint64 openedAt,uint64 deadline,uint8 status)',
  'function computeDealId(address,address,bytes32) pure returns (bytes32)',
])

const pub = createPublicClient({ chain: hedera, transport: http() })
const facilitator = privateKeyToAccount(env('ADJUDICATOR_PRIVATE_KEY') as `0x${string}`)
const buyer = privateKeyToAccount(env('BUYER_PRIVATE_KEY') as `0x${string}`)
const wallet = createWalletClient({ account: facilitator, chain: hedera, transport: http() })

const AMOUNT_TINYBARS = 50_000_000n // 0.5 ℏ, matching what the buyer just paid
const nonce = toHex(BigInt(Date.now()), { size: 32 })

const terms: Terms = {
  v: 1,
  nonce,
  payer: buyer.address,
  payee: env('SELLER_EVM_ADDRESS') as `0x${string}`,
  token: env('SETTLEMENT_ASSET'),
  amount: AMOUNT_TINYBARS.toString(),
  resource: 'http://localhost:8787/api/quote?mode=honest',
  deadlineMs: Date.now() + 60_000,
  checks: { status: { in: [200] }, minBytes: 32 },
}

const domain = {
  name: 'Receipt', version: '1', chainId: 296, verifyingContract: ESCROW,
} as const

const typed = termsTypedData(terms, domain)
const signature = await buyer.signTypedData(typed as never)
console.log('termsHash :', hashTerms(terms))
console.log('dealId    :', computeDealId(terms))
console.log('signature :', signature.slice(0, 12) + '…')

const value = tinybarsToWeibars(AMOUNT_TINYBARS)
console.log(`msg.value : ${value} weibars (= ${AMOUNT_TINYBARS} tinybars = 0.5 HBAR)`)

const sellerBefore = await pub.getBalance({ address: terms.payee })

console.log('\n--- open() ---')
const openHash = await wallet.writeContract({
  address: ESCROW, abi, functionName: 'open',
  args: [terms.payer, terms.payee, AMOUNT_TINYBARS, hashTerms(terms),
         floorDeadlineToSeconds(terms.deadlineMs), terms.nonce, signature],
  value, gas: 1_000_000n,
})
console.log('tx:', openHash)
const openRcpt = await pub.waitForTransactionReceipt({ hash: openHash })
console.log('status:', openRcpt.status, ' gasUsed:', openRcpt.gasUsed)

const id = computeDealId(terms)
const deal = await pub.readContract({ address: ESCROW, abi, functionName: 'deals', args: [id] })
console.log('deal.status (1=Open):', deal[6], ' amountWeibars:', deal[2])
console.log('escrow balance:', await pub.getBalance({ address: ESCROW }), 'weibars')

console.log('\n--- release() ---')
const relHash = await wallet.writeContract({
  address: ESCROW, abi, functionName: 'release',
  args: [id, hashTerms(terms)], gas: 1_000_000n,
})
console.log('tx:', relHash)
const relRcpt = await pub.waitForTransactionReceipt({ hash: relHash })
console.log('status:', relRcpt.status)

const deal2 = await pub.readContract({ address: ESCROW, abi, functionName: 'deals', args: [id] })
const sellerAfter = await pub.getBalance({ address: terms.payee })
console.log('deal.status (2=Released):', deal2[6])
console.log('seller delta:', sellerAfter - sellerBefore, 'weibars =', Number(sellerAfter - sellerBefore) / 1e18, 'HBAR')
console.log('escrow balance:', await pub.getBalance({ address: ESCROW }), 'weibars')
