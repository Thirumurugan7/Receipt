/**
 * claimExpired, called by a wallet with no relationship to the deal.
 *
 * This is the liveness guarantee. The signer here is STRANGER_PRIVATE_KEY —
 * not the buyer, not the seller, not the facilitator, not the adjudicator. It
 * has no special standing and cannot direct the money anywhere: the contract
 * only ever pays the payer. If the seller hangs and the facilitator walks
 * away, the buyer's funds are still recoverable by literally anyone.
 *
 *   pnpm claim --deal <dealId>
 */
import '@receipt/core/loadenv'
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const dealId = arg('deal') as `0x${string}` | undefined
if (!dealId) {
  console.error('usage: pnpm claim --deal <dealId>')
  process.exit(2)
}

const chain = defineChain({
  id: Number(need('HEDERA_CHAIN_ID')),
  name: 'Hedera Testnet',
  nativeCurrency: { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls: { default: { http: [need('HEDERA_RPC_URL')] } },
})

const abi = parseAbi([
  'function claimExpired(bytes32 dealId)',
  'function deals(bytes32) view returns (address payer,address payee,uint256 amount,bytes32 termsHash,uint64 openedAt,uint64 deadline,uint8 status)',
  'error NotYetExpired()','error DealNotOpen()',
])

const ESCROW = need('ESCROW_ADDRESS') as `0x${string}`
const stranger = privateKeyToAccount(need('STRANGER_PRIVATE_KEY') as `0x${string}`)
const pub = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ account: stranger, chain, transport: http() })

const STATUS = ['None', 'Open', 'Released', 'Refunded']
const hbar = (weibars: bigint) => `${(Number(weibars) / 1e18).toFixed(8)} ℏ`

const deal = await pub.readContract({ address: ESCROW, abi, functionName: 'deals', args: [dealId] })
const [payer, payee, amount, , , deadline, status] = deal

console.log('\nclaimExpired — called by an unrelated third party')
console.log(`  caller (stranger)  ${stranger.address}`)
console.log(`  deal               ${dealId}`)
console.log(`  payer              ${payer}`)
console.log(`  payee              ${payee}`)
console.log(`  amount             ${amount} tinybars`)
console.log(`  status             ${STATUS[status] ?? status}`)

const now = Math.floor(Date.now() / 1000)
console.log(`  deadline           ${deadline} (${Number(deadline) - now}s from now)`)

if (STATUS[status] !== 'Open') {
  console.error(`\nnothing to claim: deal is ${STATUS[status]}`)
  process.exit(1)
}

const payerBefore = await pub.getBalance({ address: payer })
console.log(`\npayer balance before ${hbar(payerBefore)}`)

if (BigInt(now) <= deadline) {
  const wait = Number(deadline) - now + 2
  console.log(`\ndeadline has not passed; waiting ${wait}s so the revert is not the point of the demo…`)
  await new Promise((r) => setTimeout(r, wait * 1000))
}

const hash = await wallet.writeContract({
  address: ESCROW, abi, functionName: 'claimExpired', args: [dealId], gas: 1_000_000n,
})
const receipt = await pub.waitForTransactionReceipt({ hash })
console.log(`\nclaimExpired tx ${hash}`)
console.log(`  status ${receipt.status}`)

const after = await pub.readContract({ address: ESCROW, abi, functionName: 'deals', args: [dealId] })
const payerAfter = await pub.getBalance({ address: payer })
console.log(`  deal is now ${STATUS[after[6]] ?? after[6]}`)
console.log(`\npayer balance after  ${hbar(payerAfter)}`)
console.log(`payer delta          ${hbar(payerAfter - payerBefore)}`)
console.log('\nthe funds went to the payer. The caller could not have sent them anywhere else.')
