import { describe, it, expect } from 'vitest';
import {
  MerchantOrder,
  PaymentTransaction,
} from '@/types/financial';
import { createMoney } from '../money';
import { runDeterministicMatching } from '../matcher/matchingEngine';
import { executeReconciliationRun } from '../service';

function createTestOrder(overrides: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: overrides.merchantOrderId ? `ord_${overrides.merchantOrderId}` : 'ord_1',
    merchantOrderId: overrides.merchantOrderId || 'ORD-100',
    externalReference: overrides.externalReference || 'INV-100',
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

function createTestTxn(overrides: Partial<PaymentTransaction> = {}): PaymentTransaction {
  return {
    id: overrides.paypalTransactionId ? `txn_${overrides.paypalTransactionId}` : 'txn_1',
    paypalTransactionId: overrides.paypalTransactionId || 'TXN-100',
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

describe('Deterministic Matching Engine — Mandatory Scenarios', () => {
  // Scenario 1: Exact order-to-payment match
  it('Scenario 1: Exact order-to-payment match produces MATCHED with exact evidence', () => {
    const order = createTestOrder({ merchantOrderId: 'ORD-01' });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-01',
      paypalOrderId: 'ORD-01',
    });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.matchedOrdersCount).toBe(1);
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].confidence).toBe('EXACT_AUTHORITATIVE');
    expect(result.records[0].evidence.amountComparison.isExactMatch).toBe(true);
  });

  // Scenario 2: Exact PayPal order ID match
  it('Scenario 2: Matches via paypalOrderId explicitly', () => {
    const order = createTestOrder({ merchantOrderId: 'PO-9999' });
    const txn = createTestTxn({ paypalOrderId: 'PO-9999' });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].matchingMethod).toBe('AUTHORITATIVE_IDENTIFIER');
    expect(result.records[0].evidence.matchingRule).toBe('RULE_AUTH_PAYPAL_ORDER_ID');
  });

  // Scenario 3: Exact capture ID match
  it('Scenario 3: Matches via paypalCaptureId matching externalReference', () => {
    const order = createTestOrder({ externalReference: 'CAP-7777' });
    const txn = createTestTxn({ paypalCaptureId: 'CAP-7777' });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].evidence.matchingRule).toBe('RULE_AUTH_CAPTURE_ID');
  });

  // Scenario 4: Merchant reference match
  it('Scenario 4: Matches via merchantReference', () => {
    const order = createTestOrder({ merchantOrderId: 'CUSTOM-ORDER-42' });
    const txn = createTestTxn({ merchantReference: 'CUSTOM-ORDER-42' });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].evidence.matchingRule).toBe('RULE_AUTH_MERCHANT_REFERENCE');
  });

  // Scenario 5: Composite amount and currency match with corroborating identity metadata
  it('Scenario 5: Matches via composite heuristics when no authoritative ID exists', () => {
    const order = createTestOrder({
      merchantOrderId: 'ORD-COMPOSITE-1',
      expectedAmount: createMoney(7550, 'USD'),
      createdAt: '2026-11-01T10:00:00.000Z',
      customerReference: 'composite.customer@example.com',
    });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-ANON-1',
      grossAmount: createMoney(7550, 'USD'),
      transactionTime: '2026-11-01T10:15:00.000Z', // 15 mins later
      merchantReference: 'composite.customer@example.com',
    });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.matchedOrdersCount).toBe(1);
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].matchingMethod).toBe('COMPOSITE_HEURISTIC');
    expect(result.records[0].confidence).toBe('COMPOSITE_CONFIRMED');
  });

  // Scenario 6: Same amount but different currency
  it('Scenario 6: Rejects or flags currency mismatch even when numeric amounts match', () => {
    const order = createTestOrder({
      merchantOrderId: 'ORD-FX-01',
      expectedAmount: createMoney(10000, 'USD'),
      currency: 'USD',
    });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-FX-01',
      paypalOrderId: 'ORD-FX-01',
      grossAmount: createMoney(10000, 'EUR'),
      currency: 'EUR',
    });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.records[0].matchStatus).toBe('DISCREPANCY');
    expect(result.records[0].discrepancyType).toBe('CURRENCY_MISMATCH');
    expect(result.records[0].evidence.currencyComparison.matches).toBe(false);
  });

  // Scenario 7: Missing transaction
  it('Scenario 7: Order without matching payment classified as UNMATCHED_ORDER / MISSING_PAYMENT', () => {
    const order = createTestOrder({ merchantOrderId: 'ORD-UNPAID-1' });

    const result = runDeterministicMatching([order], []);
    expect(result.unmatchedOrdersCount).toBe(1);
    expect(result.records[0].matchStatus).toBe('UNMATCHED_ORDER');
    expect(result.records[0].discrepancyType).toBe('MISSING_PAYMENT');
  });

  // Scenario 8: Unmatched transaction
  it('Scenario 8: Transaction without corresponding order classified as UNMATCHED_TRANSACTION', () => {
    const txn = createTestTxn({ paypalTransactionId: 'TXN-ORPHAN-1' });

    const result = runDeterministicMatching([], [txn]);
    expect(result.unmatchedTransactionsCount).toBe(1);
    expect(result.records[0].matchStatus).toBe('UNMATCHED_TRANSACTION');
    expect(result.records[0].discrepancyType).toBe('MISSING_METADATA');
  });

  // Scenario 9 & 10: Multiple transactions against one order / duplicate check
  it('Scenario 10: Never silently consumes the same transaction twice', () => {
    const order1 = createTestOrder({ merchantOrderId: 'ORD-A', expectedAmount: createMoney(5000, 'USD') });
    const order2 = createTestOrder({ merchantOrderId: 'ORD-B', expectedAmount: createMoney(5000, 'USD') });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-SINGLE',
      grossAmount: createMoney(5000, 'USD'),
      paypalOrderId: 'ORD-A',
    });

    const result = runDeterministicMatching([order1, order2], [txn]);
    expect(result.matchedOrdersCount).toBe(1);
    expect(result.unmatchedOrdersCount).toBe(1);

    const matchedRec = result.records.find((r) => r.orderId === 'ORD-A');
    expect(matchedRec?.matchStatus).toBe('MATCHED');

    const unmatchedRec = result.records.find((r) => r.orderId === 'ORD-B');
    expect(unmatchedRec?.matchStatus).toBe('UNMATCHED_ORDER');
  });

  // Scenario 11 & 12: Partial and multiple legitimate captures
  it('Scenario 12: Aggregates multiple legitimate captures against one order', () => {
    const order = createTestOrder({
      merchantOrderId: 'ORD-SPLIT',
      expectedAmount: createMoney(20000, 'USD'), // $200.00
    });
    const cap1 = createTestTxn({
      paypalTransactionId: 'TXN-CAP-1',
      paypalOrderId: 'ORD-SPLIT',
      grossAmount: createMoney(12000, 'USD'), // $120.00
    });
    const cap2 = createTestTxn({
      paypalTransactionId: 'TXN-CAP-2',
      paypalOrderId: 'ORD-SPLIT',
      grossAmount: createMoney(8000, 'USD'), // $80.00
    });

    const result = runDeterministicMatching([order], [cap1, cap2]);
    expect(result.matchedOrdersCount).toBe(1);
    const rec = result.records[0];
    expect(rec.matchStatus).toBe('MATCHED');
    expect(rec.matchingMethod).toBe('MULTI_CAPTURE_RULE');
    expect(rec.transactionIds).toHaveLength(2);
    expect(rec.actualAmount.amountMinor).toBe(20000);
  });

  // Scenario 13: Pending authorisation
  it('Scenario 13: Pending transactions classified with TIMING_DELAY discrepancy', () => {
    const order = createTestOrder({ merchantOrderId: 'ORD-PEND' });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-PEND',
      paypalOrderId: 'ORD-PEND',
      transactionStatus: 'PENDING',
    });

    const result = runDeterministicMatching([order], [txn]);
    expect(result.records[0].matchStatus).toBe('DISCREPANCY');
    expect(result.records[0].discrepancyType).toBe('TIMING_DELAY');
  });

  // Scenario 14: Completed refund
  it('Scenario 14: Linked refund transaction classified with PARTIAL_REFUND_MISMATCH', () => {
    const order = createTestOrder({ merchantOrderId: 'ORD-REF' });
    const refundTxn = createTestTxn({
      paypalTransactionId: 'TXN-REF',
      paypalOrderId: 'ORD-REF',
      transactionType: 'REFUND',
      grossAmount: createMoney(-5000, 'USD'),
    });

    const result = runDeterministicMatching([order], [refundTxn]);
    expect(result.records[0].matchStatus).toBe('DISCREPANCY');
    expect(result.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
  });

  // Scenario 15: Fee versus gross amount difference
  it('Scenario 15: Keeps gross and net separate, does not compare gross to net', () => {
    const order = createTestOrder({
      merchantOrderId: 'ORD-FEE-01',
      expectedAmount: createMoney(10000, 'USD'), // $100.00
    });
    const txn = createTestTxn({
      paypalTransactionId: 'TXN-FEE-01',
      paypalOrderId: 'ORD-FEE-01',
      grossAmount: createMoney(10000, 'USD'), // $100.00 gross
      feeAmount: createMoney(398, 'USD'), // $3.98 fee
      netAmount: createMoney(9602, 'USD'), // $96.02 net
    });

    const result = runDeterministicMatching([order], [txn]);
    // The gross amount matched the order expected amount, so the match is clean!
    expect(result.records[0].matchStatus).toBe('MATCHED');
    expect(result.records[0].actualAmount.amountMinor).toBe(10000);
  });

  // Scenario 21: Ambiguous candidates
  it('Scenario 21: Flags equal competing candidates as AMBIGUOUS without auto-confirming', () => {
    const order = createTestOrder({
      merchantOrderId: 'ORD-AMBIG',
      expectedAmount: createMoney(5000, 'USD'),
      createdAt: '2026-11-01T12:00:00.000Z',
    });
    const txn1 = createTestTxn({
      paypalTransactionId: 'TXN-A',
      grossAmount: createMoney(5000, 'USD'),
      transactionTime: '2026-11-01T12:10:00.000Z', // +10 min
    });
    const txn2 = createTestTxn({
      paypalTransactionId: 'TXN-B',
      grossAmount: createMoney(5000, 'USD'),
      transactionTime: '2026-11-01T11:50:00.000Z', // -10 min (equal delta!)
    });

    const result = runDeterministicMatching([order], [txn1, txn2]);
    const ambig = result.records.find((r) => r.matchStatus === 'AMBIGUOUS');
    expect(ambig).toBeDefined();
    expect(ambig?.confidence).toBe('MANUAL_REVIEW_REQUIRED');
    expect(ambig?.discrepancyType).toBe('CONFLICTING_REFERENCES');
  });

  // Scenario 25: Identical input produces identical output (Reproducibility)
  it('Scenario 25: Identical input produces identical output across multiple runs', () => {
    const orders = [
      createTestOrder({ merchantOrderId: 'ORD-REP-1', expectedAmount: createMoney(12000, 'USD') }),
      createTestOrder({ merchantOrderId: 'ORD-REP-2', expectedAmount: createMoney(8500, 'EUR'), currency: 'EUR' }),
    ];
    const txns = [
      createTestTxn({ paypalTransactionId: 'TXN-REP-1', paypalOrderId: 'ORD-REP-1', grossAmount: createMoney(12000, 'USD') }),
      createTestTxn({ paypalTransactionId: 'TXN-REP-2', paypalOrderId: 'ORD-REP-2', grossAmount: createMoney(8500, 'EUR'), currency: 'EUR' }),
    ];

    const run1 = executeReconciliationRun({ orders, transactions: txns });
    const run2 = executeReconciliationRun({ orders, transactions: txns });

    expect(run1.matchedCount).toBe(run2.matchedCount);
    expect(run1.unmatchedOrderCount).toBe(run2.unmatchedOrderCount);
    expect(run1.unmatchedTransactionCount).toBe(run2.unmatchedTransactionCount);
    expect(run1.records.length).toBe(run2.records.length);

    for (let i = 0; i < run1.records.length; i++) {
      expect(run1.records[i].matchStatus).toBe(run2.records[i].matchStatus);
      expect(run1.records[i].expectedAmount.amountMinor).toBe(run2.records[i].expectedAmount.amountMinor);
      expect(run1.records[i].actualAmount.amountMinor).toBe(run2.records[i].actualAmount.amountMinor);
    }
  });
});
