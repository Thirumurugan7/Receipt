/**
 * OpenAPI description of the buyer-facing surface.
 *
 * Bazantic builds a gateway from an OpenAPI spec, so this exists to make that
 * integration real rather than a manifest pointing at nothing. It describes
 * only the endpoints an agent calls; the x402 facilitator endpoints
 * (/verify, /settle, /supported) are machine-to-machine and not part of it.
 */
import { config } from './env.js'

export const openapi = (publicUrl: string) => ({
  openapi: '3.1.0',
  info: {
    title: 'Receipt',
    version: '0.1.0',
    description:
      'Conditional settlement for x402. Payment is escrowed and released only if the ' +
      'response satisfies buyer-signed, machine-checkable acceptance terms. Every verdict ' +
      'is published to a public Hedera Consensus Service topic and can be recomputed by anyone.',
  },
  servers: [{ url: publicUrl }],
  paths: {
    '/proxy': {
      post: {
        operationId: 'buyWithTerms',
        summary: 'Buy a resource under machine-checkable acceptance terms',
        description:
          'Returns 402 with payment requirements when called without a payment. Call again ' +
          'with the payment attached to settle, escrow, fetch the resource, adjudicate it and ' +
          'release or refund. Response headers carry the verdict and every transaction id.',
        parameters: [
          {
            name: 'X-Receipt-Terms',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'base64url of the JCS-canonical Terms document',
          },
          {
            name: 'X-Receipt-Signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: "the buyer's EIP-712 signature over those terms",
          },
          {
            name: 'PAYMENT-SIGNATURE',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'base64 x402 v2 payment payload; omit to receive a 402 quote',
          },
        ],
        responses: {
          200: { description: "The seller's response body, with verdict headers attached" },
          402: { description: 'Payment required; body carries the accepted payment requirements' },
          504: {
            description:
              'The seller did not respond. No verdict is published; the deal stays open and ' +
              'claimExpired is callable by anyone after the deadline.',
          },
        },
      },
    },
    '/deals/{dealId}': {
      get: {
        operationId: 'getDeal',
        summary: 'Verdict and on-chain state for one deal',
        parameters: [
          { name: 'dealId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Deal record including the verdict and its on-chain status' },
          404: { description: 'Unknown deal' },
        },
      },
    },
    '/health': {
      get: {
        operationId: 'health',
        summary: 'Deployment identifiers: escrow address, audit topic, settlement facilitator',
        responses: { 200: { description: 'ok' } },
      },
    },
  },
})

export const publicUrl = () => process.env.PUBLIC_URL ?? `http://localhost:${config.port}`
