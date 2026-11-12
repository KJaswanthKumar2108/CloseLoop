import { NormalizedTransaction } from '@/types/financial';

/**
 * Realistic PayPal Sandbox demonstration fixtures.
 * CRITICAL ARCHITECTURAL RULE (Principle 7: Data Integrity):
 * These records are strictly labeled as sample/demo data and serve as the baseline
 * for verifying deterministic reconciliation, fee variance detection, and AI diagnosis.
 */

export const DEMO_PAYPAL_TRANSACTIONS: NormalizedTransaction[] = [
  {
    id: 'pp_txn_1001',
    source: 'PAYPAL',
    externalId: 'TXN-PP-1001',
    orderId: 'ORD-9021',
    invoiceId: 'INV-2026-001',
    grossAmount: {
      amountMinor: 12000, // $120.00
      currency: 'USD',
      precision: 2,
    },
    feeAmount: {
      amountMinor: 468, // $4.68 (3.49% + $0.49 standard PayPal card rate)
      currency: 'USD',
      precision: 2,
    },
    netAmount: {
      amountMinor: 11532, // $115.32
      currency: 'USD',
      precision: 2,
    },
    status: 'COMPLETED',
    timestamp: '2026-11-06T14:32:00.000Z',
    payerEmailMasked: 'j***n@example.com',
    description: 'Enterprise Cloud Subscription - Monthly',
    rawMetadata: {
      isDemo: true,
      dataSource: 'SAMPLE_SANDBOX_FIXTURE',
      paymentMethod: 'PAYPAL_WALLET',
      protectionEligibility: 'ELIGIBLE',
    },
  },
  {
    id: 'pp_txn_1002',
    source: 'PAYPAL',
    externalId: 'TXN-PP-1002',
    orderId: 'ORD-9022',
    invoiceId: 'INV-2026-002',
    grossAmount: {
      amountMinor: 25000, // $250.00
      currency: 'USD',
      precision: 2,
    },
    feeAmount: {
      // Expected domestic fee: $250 * 0.0349 + $0.49 = $9.22 (922 minor)
      // Actual international card fee: $250 * 0.0499 + $0.49 = $12.97 (1297 minor)
      // Variance: $3.75 (375 minor)
      amountMinor: 1297,
      currency: 'USD',
      precision: 2,
    },
    netAmount: {
      amountMinor: 23703, // $237.03
      currency: 'USD',
      precision: 2,
    },
    status: 'COMPLETED',
    timestamp: '2026-11-06T16:15:22.000Z',
    payerEmailMasked: 's***z@international-corp.de',
    description: 'Custom Integration Service Tier',
    rawMetadata: {
      isDemo: true,
      dataSource: 'SAMPLE_SANDBOX_FIXTURE',
      paymentMethod: 'CREDIT_CARD',
      cardCountry: 'DE',
      crossBorderFeeApplied: true,
    },
  },
  {
    id: 'pp_txn_1003',
    source: 'PAYPAL',
    externalId: 'TXN-PP-1003',
    orderId: 'ORD-9023',
    invoiceId: 'INV-2026-003',
    grossAmount: {
      amountMinor: 8550, // €85.50
      currency: 'EUR',
      precision: 2,
    },
    feeAmount: {
      amountMinor: 337, // €3.37
      currency: 'EUR',
      precision: 2,
    },
    netAmount: {
      amountMinor: 8213, // €82.13
      currency: 'EUR',
      precision: 2,
    },
    status: 'PENDING_SETTLEMENT',
    timestamp: '2026-11-07T23:54:10.000Z',
    payerEmailMasked: 'm***k@paristechnologies.fr',
    description: 'API Gateway Seat License',
    rawMetadata: {
      isDemo: true,
      dataSource: 'SAMPLE_SANDBOX_FIXTURE',
      settlementDelayReason: 'CLEARING_BANK_HOLD',
    },
  },
  {
    id: 'pp_txn_1004',
    source: 'PAYPAL',
    externalId: 'TXN-PP-1004',
    orderId: 'ORD-9024',
    invoiceId: 'INV-2026-004',
    grossAmount: {
      amountMinor: 30000, // $300.00 original capture
      currency: 'USD',
      precision: 2,
    },
    feeAmount: {
      amountMinor: 1096, // $10.96
      currency: 'USD',
      precision: 2,
    },
    netAmount: {
      amountMinor: 28904, // $289.04
      currency: 'USD',
      precision: 2,
    },
    status: 'PARTIALLY_REFUNDED',
    timestamp: '2026-11-05T09:12:00.000Z',
    payerEmailMasked: 'a***y@acmelabs.io',
    description: 'Hardware Terminal Support Bundle',
    rawMetadata: {
      isDemo: true,
      dataSource: 'SAMPLE_SANDBOX_FIXTURE',
      refundId: 'REF-PP-9941',
      refundAmountMinor: 5000, // $50.00 refund
      refundTimestamp: '2026-11-07T11:20:00.000Z',
    },
  },
  {
    id: 'pp_txn_1005',
    source: 'PAYPAL',
    externalId: 'TXN-PP-1005',
    orderId: 'ORD-9025',
    invoiceId: 'INV-2026-005',
    grossAmount: {
      amountMinor: 45000, // $450.00
      currency: 'USD',
      precision: 2,
    },
    feeAmount: {
      amountMinor: 1620, // $16.20
      currency: 'USD',
      precision: 2,
    },
    netAmount: {
      amountMinor: 43380, // $433.80
      currency: 'USD',
      precision: 2,
    },
    status: 'HELD_DISPUTE',
    timestamp: '2026-11-04T18:05:40.000Z',
    payerEmailMasked: 'b***n@ventureholdings.com',
    description: 'Annual Enterprise Developer Plan',
    rawMetadata: {
      isDemo: true,
      dataSource: 'SAMPLE_SANDBOX_FIXTURE',
      disputeId: 'DISP-PP-7712',
      disputeReason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      disputeStatus: 'UNDER_REVIEW',
    },
  },
];

