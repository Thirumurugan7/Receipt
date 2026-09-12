import '@receipt/core/loadenv'

const need = (k: string): string => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export const config = {
  rpcUrl: need('HEDERA_RPC_URL'),
  chainId: Number(need('HEDERA_CHAIN_ID')),
  mirrorUrl: need('HEDERA_MIRROR_URL'),

  operatorId: need('HEDERA_OPERATOR_ID'),
  operatorKey: need('HEDERA_OPERATOR_KEY'),
  topicId: need('HCS_TOPIC_ID'),

  escrow: need('ESCROW_ADDRESS') as `0x${string}`,
  adjudicatorKey: need('ADJUDICATOR_PRIVATE_KEY') as `0x${string}`,

  blockyUrl: need('BLOCKY402_FACILITATOR_URL'),
  network: need('BLOCKY402_NETWORK'),
  feePayer: need('BLOCKY402_FEE_PAYER'),
  asset: need('SETTLEMENT_ASSET'),
  payTo: need('FACILITATOR_HEDERA_ACCOUNT_ID'),

  port: Number(process.env.FACILITATOR_PORT ?? 8080),
  sellerUrl: process.env.SELLER_URL ?? 'http://localhost:8787',
} as const
