/**
 * Spike: prove one real x402 payment settles through Blocky402 on Hedera
 * testnet. Buyer builds a partially-signed TransferTransaction; Blocky402 adds
 * the fee-payer signature and submits. Nothing else in Phase 3 works until
 * this does, so it is proven first and in isolation.
 */
import 'dotenv/config'
import { PrivateKey } from '@hiero-ledger/sdk'
import { createClientHederaSigner } from '@x402/hedera'

const env = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

const NETWORK = env('BLOCKY402_NETWORK')
const FACILITATOR = env('BLOCKY402_FACILITATOR_URL')
const MIRROR = env('HEDERA_MIRROR_URL')
const BUYER_ID = env('BUYER_HEDERA_ACCOUNT_ID')
const PAY_TO = env('FACILITATOR_HEDERA_ACCOUNT_ID')
const FEE_PAYER = env('BLOCKY402_FEE_PAYER')
const ASSET = env('SETTLEMENT_ASSET')

const AMOUNT_TINYBARS = '50000000' // 0.5 ℏ

async function balance(id: string): Promise<bigint> {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${id}`)
  const j = (await r.json()) as { balance?: { balance?: number } }
  return BigInt(j.balance?.balance ?? 0)
}

const hbar = (tb: bigint) => `${(Number(tb) / 1e8).toFixed(8)} ℏ`

function parseKey(raw: string): PrivateKey {
  const s = raw.startsWith('0x') ? raw.slice(2) : raw
  return PrivateKey.fromStringECDSA(s)
}

const requirements = {
  scheme: 'exact',
  network: NETWORK,
  asset: ASSET,
  amount: AMOUNT_TINYBARS,
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { feePayer: FEE_PAYER },
}

console.log('requirements:', JSON.stringify(requirements))

const buyerBefore = await balance(BUYER_ID)
const payToBefore = await balance(PAY_TO)
const feePayerBefore = await balance(FEE_PAYER)
console.log(`\nbefore  buyer=${hbar(buyerBefore)}  payTo=${hbar(payToBefore)}  feePayer=${hbar(feePayerBefore)}`)

const signer = createClientHederaSigner(BUYER_ID, parseKey(env('BUYER_PRIVATE_KEY')), {
  network: NETWORK,
})
const transaction = await signer.createPartiallySignedTransferTransaction(requirements as never)
console.log(`\npartially signed tx: ${transaction.length} base64 chars`)

const paymentPayload = {
  x402Version: 2,
  scheme: 'exact',
  network: NETWORK,
  accepted: requirements,
  payload: { transaction },
}
const body = JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements })

const post = async (path: string) => {
  const r = await fetch(`${FACILITATOR}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })
  const text = await r.text()
  console.log(`\nPOST ${path} -> ${r.status}\n${text}`)
  return { status: r.status, json: (() => { try { return JSON.parse(text) } catch { return null } })() }
}

const verify = await post('/verify')
if (!verify.json?.isValid) {
  console.error('\nVERIFY FAILED — stopping before settle')
  process.exit(1)
}

const settle = await post('/settle')
if (!settle.json?.success) {
  console.error('\nSETTLE FAILED')
  process.exit(1)
}

await new Promise((r) => setTimeout(r, 6000))
const buyerAfter = await balance(BUYER_ID)
const payToAfter = await balance(PAY_TO)
const feePayerAfter = await balance(FEE_PAYER)
console.log(`\nafter   buyer=${hbar(buyerAfter)}  payTo=${hbar(payToAfter)}  feePayer=${hbar(feePayerAfter)}`)
console.log(`\ndelta   buyer=${hbar(buyerAfter - buyerBefore)}  payTo=${hbar(payToAfter - payToBefore)}  feePayer=${hbar(feePayerAfter - feePayerBefore)}`)
console.log(`\nbuyer paid network fee? ${buyerAfter - buyerBefore === -BigInt(AMOUNT_TINYBARS) ? 'NO — exactly the transfer amount, fee was paid by ' + FEE_PAYER : 'YES (unexpected)'}`)
console.log(`hedera tx: ${settle.json?.transaction}`)
