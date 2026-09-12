/**
 * Blocky402 client.
 *
 * Receipt sits in the facilitator slot for the seller, but it is itself a
 * *client* of Blocky402 for the actual Hedera settlement — that is what the
 * Hedera bounty requires. Wire shapes confirmed against
 * GET https://api.testnet.blocky402.com/supported and the live /verify+/settle
 * round trip in spike/settle-roundtrip.mts.
 */
import { config } from './env.js'

export interface PaymentRequirements {
  scheme: string
  network: string
  asset: string
  amount: string
  payTo: string
  maxTimeoutSeconds: number
  extra: Record<string, unknown>
}

export interface PaymentPayload {
  x402Version: number
  scheme?: string
  network?: string
  accepted: PaymentRequirements
  payload: Record<string, unknown>
}

export interface VerifyResponse {
  isValid: boolean
  payer?: string
  invalidReason?: string
  invalidMessage?: string
}

export interface SettleResponse {
  success: boolean
  transaction?: string
  network?: string
  payer?: string
  errorReason?: string
  errorMessage?: string
}

/** The requirements Receipt advertises: payTo is the FACILITATOR, not the seller.
 *  That single rewrite is what routes the money into escrow instead of to the
 *  seller directly, and it is the whole product in one field. */
export function requirementsFor(amountTinybars: string): PaymentRequirements {
  return {
    scheme: 'exact',
    network: config.network,
    asset: config.asset,
    amount: amountTinybars,
    payTo: config.payTo,
    maxTimeoutSeconds: 300,
    extra: { feePayer: config.feePayer },
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.blockyUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`blocky402 ${path} returned ${res.status}: ${text.slice(0, 200)}`)
  }
}

export const blocky = {
  verify: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) =>
    post<VerifyResponse>('/verify', { x402Version: 2, paymentPayload, paymentRequirements }),

  settle: (paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements) =>
    post<SettleResponse>('/settle', { x402Version: 2, paymentPayload, paymentRequirements }),

  supported: async () => {
    const res = await fetch(`${config.blockyUrl}/supported`)
    return res.json() as Promise<{ kinds: unknown[]; extensions: unknown[] }>
  },
}
