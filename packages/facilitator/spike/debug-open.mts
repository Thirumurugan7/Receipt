import 'dotenv/config'
import { createPublicClient, defineChain, http, parseAbi, toHex, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { hashTerms, termsTypedData, tinybarsToWeibars, floorDeadlineToSeconds, EIP712_TERMS_TYPES } from '@receipt/core'
import type { Terms } from '@receipt/core'

const env = (k: string) => { const v = process.env[k]; if (!v) throw new Error(k); return v }
const hedera = defineChain({ id: 296, name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [env('HEDERA_RPC_URL')] } } })
const ESCROW = env('ESCROW_ADDRESS') as `0x${string}`

const abi = parseAbi([
  'function open(address payer,address payee,uint256 amount,bytes32 termsHash,uint64 deadline,bytes32 nonce,bytes signature) payable returns (bytes32)',
  'function termsDigest(bytes32 termsHash,address payer,address payee,uint256 amount,uint64 deadline,bytes32 nonce) view returns (bytes32)',
  'function valueScale() view returns (uint256)',
  'error BadSignature()','error ValueMismatch(uint256 expected,uint256 received)','error DeadlineInPast()',
  'error DealExists()','error ZeroAddress()','error NotAdjudicator()','error DealNotOpen()',
])

const pub = createPublicClient({ chain: hedera, transport: http() })
const facilitator = privateKeyToAccount(env('ADJUDICATOR_PRIVATE_KEY') as `0x${string}`)
const buyer = privateKeyToAccount(env('BUYER_PRIVATE_KEY') as `0x${string}`)

const AMT = 50_000_000n
const terms: Terms = {
  v: 1, nonce: toHex(BigInt(Date.now()), { size: 32 }),
  payer: buyer.address, payee: env('SELLER_EVM_ADDRESS') as `0x${string}`,
  token: '0.0.0', amount: AMT.toString(), resource: 'x',
  deadlineMs: Date.now() + 60_000, checks: { status: { in: [200] } },
}
const domain = { name: 'Receipt', version: '1', chainId: 296, verifyingContract: ESCROW } as const
const typed = termsTypedData(terms, domain)
const sig = await buyer.signTypedData(typed as never)
const deadline = floorDeadlineToSeconds(terms.deadlineMs)

console.log('buyer addr     :', buyer.address)
console.log('recovered off  :', await recoverTypedDataAddress({ ...(typed as never), signature: sig }))

const onchainDigest = await pub.readContract({ address: ESCROW, abi, functionName: 'termsDigest',
  args: [hashTerms(terms), terms.payer, terms.payee, AMT, deadline, terms.nonce] })
const { hashTypedData } = await import('viem')
const offchainDigest = hashTypedData(typed as never)
console.log('digest onchain :', onchainDigest)
console.log('digest offchain:', offchainDigest)
console.log('DIGESTS MATCH  :', onchainDigest === offchainDigest)

console.log('valueScale     :', await pub.readContract({ address: ESCROW, abi, functionName: 'valueScale' }))
console.log('deadline       :', deadline, ' now(s):', Math.floor(Date.now()/1000))
const blk = await pub.getBlock()
console.log('block.timestamp:', blk.timestamp, ' deadline > block.ts ?', deadline > blk.timestamp)

try {
  const sim = await pub.simulateContract({ account: facilitator, address: ESCROW, abi,
    functionName: 'open',
    args: [terms.payer, terms.payee, AMT, hashTerms(terms), deadline, terms.nonce, sig],
    value: tinybarsToWeibars(AMT) })
  console.log('\nSIMULATION OK ->', sim.result)
} catch (e: any) {
  console.log('\nSIMULATION REVERT:')
  console.log('  name   :', e.name)
  console.log('  short  :', e.shortMessage)
  const cause = e.cause?.data ?? e.cause?.cause?.data
  console.log('  errName:', e.cause?.data?.errorName ?? e.cause?.cause?.data?.errorName ?? '(none decoded)')
  console.log('  details:', (e.details ?? e.cause?.details ?? '').slice(0, 300))
  console.log('  meta   :', (e.metaMessages ?? []).join(' | ').slice(0, 400))
}
