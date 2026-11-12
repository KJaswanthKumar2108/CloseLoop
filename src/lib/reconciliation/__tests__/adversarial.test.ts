import { describe, it, expect } from 'vitest';
import { runDeterministicMatching } from '../matcher/matchingEngine';
import { normalizeTransactionType, normalizeTransactionStatus } from '../importer/transactionCsvImporter';
import { createMoney } from '../money';
import { MerchantOrder, PaymentTransaction } from '@/types/financial';

function makeOrder(overrides: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: overrides.merchantOrderId ? `ord_${overrides.merchantOrderId}` : 'ord_1',
    merchantOrderId: overrides.merchantOrderId || 'ORD-1',
    externalReference: overrides.externalReference || 'INV-1',
    expectedAmount: overrides.expectedAmount || createMoney(10000, 'USD'),
    currency: overrides.currency || 'USD',
    createdAt: overrides.createdAt || '2026-11-01T12:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-11-01T12:00:00.000Z',
    orderStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    source: 'TEST',
    metadata: {},
    ...overrides,
  };
}

function makeTxn(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: overrides.paypalTransactionId ? `txn_${overrides.paypalTransactionId}` : 'txn_1',
    paypalTransactionId: overrides.paypalTransactionId || 'TXN-1',
    grossAmount: overrides.grossAmount || createMoney(10000, 'USD'),
    currency: overrides.currency || 'USD',
    transactionType: 'CAPTURE',
    transactionStatus: 'COMPLETED',
    transactionTime: overrides.transactionTime || '2026-11-01T12:05:00.000Z',
    source: 'PAYPAL_EXPORT',
    rawReference: 'TEST ROW',
    ...overrides,
  };
}

describe('Remediated Adversarial Audit 1: Matching Safety & False Confirmations', () => {
  it('REMEDIATED-1.1: Order-dependency eliminated; competing orders flagged as ambiguous regardless of order', () => {
    // Two orders with identical amount $50.00 within the ambiguity tolerance window
    const orderA = makeOrder({ merchantOrderId: 'ORD-A', expectedAmount: createMoney(5000, 'USD'), createdAt: '2026-11-01T12:00:00.000Z' });
    const orderB = makeOrder({ merchantOrderId: 'ORD-B', expectedAmount: createMoney(5000, 'USD'), createdAt: '2026-11-01T12:04:00.000Z' });
    const txn = makeTxn({ paypalTransactionId: 'TXN-CLOSE-TO-B', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:04:00.000Z' });

    // When orderA is first in input:
    const res1 = runDeterministicMatching([orderA, orderB], [txn]);
    // When orderB is first in input:
    const res2 = runDeterministicMatching([orderB, orderA], [txn]);

    // Both orders compete for a single transaction within ambiguity window (240s < 300s) with no customer reference
    // Neither order is falsely matched; both runs produce identical deterministic output
    expect(res1.records.filter(r => r.matchStatus === 'AMBIGUOUS')).toHaveLength(2);
    expect(res2.records.filter(r => r.matchStatus === 'AMBIGUOUS')).toHaveLength(2);
    expect(res1.matchedOrdersCount).toBe(0);
    expect(res2.matchedOrdersCount).toBe(0);
  });

  it('REMEDIATED-1.2: Tie-breaker vulnerability resolved (1-second difference correctly flagged as ambiguous)', () => {
    const order = makeOrder({ expectedAmount: createMoney(5000, 'USD'), createdAt: '2026-11-01T12:00:00.000Z' });
    // Txn 1 is +60s, Txn 2 is +61s (within 300s ambiguity window)
    const txn1 = makeTxn({ paypalTransactionId: 'TXN-60', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:01:00.000Z' });
    const txn2 = makeTxn({ paypalTransactionId: 'TXN-61', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:01:01.000Z' });

    const res = runDeterministicMatching([order], [txn1, txn2]);
    // Correctly flagged as AMBIGUOUS instead of falsely auto-confirming TXN-60
    expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
    expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
  });
});

describe('Remediated Adversarial Audit 2: Multi-Capture Safety & Status Leaks', () => {
  it('REMEDIATED-2.1: Multi-Capture excludes DENIED or PENDING captures and flags discrepancy', () => {
    const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-FAIL', expectedAmount: createMoney(20000, 'USD') });
    // Capture 1: $120 COMPLETED
    const cap1 = makeTxn({
      paypalTransactionId: 'CAP-1',
      paypalOrderId: 'ORD-SPLIT-FAIL',
      grossAmount: createMoney(12000, 'USD'),
      transactionStatus: 'COMPLETED',
      transactionType: 'CAPTURE',
    });
    // Capture 2: $80 DENIED / FAILED
    const cap2 = makeTxn({
      paypalTransactionId: 'CAP-2',
      paypalOrderId: 'ORD-SPLIT-FAIL',
      grossAmount: createMoney(8000, 'USD'),
      transactionStatus: 'DENIED',
      transactionType: 'CAPTURE',
    });

    const res = runDeterministicMatching([order], [cap1, cap2]);
    // Settled capture is only $120. Denied $80 is not settled, so matchStatus is DISCREPANCY
    expect(res.records[0].matchStatus).toBe('DISCREPANCY');
    expect(res.records[0].actualAmount.amountMinor).toBe(12000);
    expect(res.records[0].discrepancyType).toBe('MULTI_CAPTURE_VARIANCE');
  });

  it('REMEDIATED-2.2: Multi-Capture with Completed + Refunded capture excludes refund from gross capture', () => {
    const order = makeOrder({ merchantOrderId: 'ORD-REF-MULTI', expectedAmount: createMoney(10000, 'USD') });
    const cap1 = makeTxn({ paypalTransactionId: 'C1', paypalOrderId: 'ORD-REF-MULTI', grossAmount: createMoney(10000, 'USD'), transactionStatus: 'REFUNDED' });
    const cap2 = makeTxn({ paypalTransactionId: 'C2', paypalOrderId: 'ORD-REF-MULTI', grossAmount: createMoney(10000, 'USD'), transactionStatus: 'COMPLETED' });

    const res = runDeterministicMatching([order], [cap1, cap2]);
    // Refunded transaction is excluded from completed capture sum; completed capture is $100
    expect(res.records[0].actualAmount.amountMinor).toBe(10000);
  });
});

describe('Remediated Adversarial Audit 3: Authorizations Counted as Captures', () => {
  it('REMEDIATED-3.1: Authorization with status COMPLETED is classified as TIMING_DELAY discrepancy', () => {
    const order = makeOrder({ merchantOrderId: 'ORD-AUTH-TEST', expectedAmount: createMoney(10000, 'USD') });
    const authTxn = makeTxn({
      paypalTransactionId: 'AUTH-1',
      paypalOrderId: 'ORD-AUTH-TEST',
      grossAmount: createMoney(10000, 'USD'),
      transactionType: 'AUTHORIZATION',
      transactionStatus: 'COMPLETED',
    });

    const res = runDeterministicMatching([order], [authTxn]);
    // Uncaptured authorization must not be declared MATCHED
    expect(res.records[0].matchStatus).toBe('DISCREPANCY');
    expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
    expect(res.records[0].confidence).toBe('EXACT_AUTHORITATIVE');
  });
});

describe('Remediated Adversarial Audit 5: CSV Importer Strict Validation', () => {
  it('REMEDIATED-5.1: Unknown transaction types return null instead of falling back to CAPTURE', () => {
    expect(normalizeTransactionType('UNKNOWN_GARBAGE_TYPE')).toBeNull();
    expect(normalizeTransactionType('FAILED_ATTEMPT')).toBeNull();
    expect(normalizeTransactionType('ACCOUNT_HOLD')).toBeNull();
  });

  it('REMEDIATED-5.2: Unknown transaction statuses return null instead of falling back to COMPLETED', () => {
    expect(normalizeTransactionStatus('UNKNOWN_STATUS')).toBeNull();
    expect(normalizeTransactionStatus('SUSPENDED')).toBeNull();
    expect(normalizeTransactionStatus('EXPIRED')).toBeNull();
    expect(normalizeTransactionStatus('EXPIRED_AUTH')).toBeNull();
  });
});
