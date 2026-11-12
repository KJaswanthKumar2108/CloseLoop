import { describe, it, expect } from 'vitest';
import { runDeterministicMatching } from '../matcher/matchingEngine';
import { createMoney } from '../money';
import { MerchantOrder, PaymentTransaction } from '@/types/financial';
import { NextRequest } from 'next/server';
import { POST as previewHandler } from '@/app/api/reconciliation/preview/route';

function makeOrder(overrides: Partial<MerchantOrder> = {}): MerchantOrder {
  return {
    id: overrides.merchantOrderId ? `ord_${overrides.merchantOrderId}` : 'ord_1',
    merchantOrderId: overrides.merchantOrderId || 'ORD-1',
    externalReference: overrides.externalReference || 'INV-1',
    expectedAmount: overrides.expectedAmount || createMoney(5000, 'USD'),
    currency: overrides.currency || 'USD',
    createdAt: overrides.createdAt || '2026-11-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-11-01T10:00:00.000Z',
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
    grossAmount: overrides.grossAmount || createMoney(5000, 'USD'),
    currency: overrides.currency || 'USD',
    transactionType: overrides.transactionType || 'CAPTURE',
    transactionStatus: overrides.transactionStatus || 'COMPLETED',
    transactionTime: overrides.transactionTime || '2026-11-01T10:00:00.000Z',
    source: 'PAYPAL_EXPORT',
    rawReference: 'TEST ROW',
    ...overrides,
  };
}

describe('Final Phase 2A Acceptance Audit', () => {
  // =========================================================================
  // AUDIT 1: Global Allocation Correctness
  // =========================================================================
  describe('Audit 1: Global Allocation Correctness', () => {
    it('Scenario 1.1: User Prompt Case (Order A @ 10:00, Order B @ 10:01, Txn X @ 10:00, Txn Y @ 09:59)', () => {
      const orderA = makeOrder({
        merchantOrderId: 'ORD-A',
        expectedAmount: createMoney(5000, 'USD'),
        createdAt: '2026-11-01T10:00:00.000Z',
      });
      const orderB = makeOrder({
        merchantOrderId: 'ORD-B',
        expectedAmount: createMoney(5000, 'USD'),
        createdAt: '2026-11-01T10:01:00.000Z',
      });
      const txnX = makeTxn({
        paypalTransactionId: 'TXN-X',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T10:00:00.000Z',
      });
      const txnY = makeTxn({
        paypalTransactionId: 'TXN-Y',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T09:59:00.000Z',
      });

      const res = runDeterministicMatching([orderA, orderB], [txnX, txnY]);

      // Report what happens:
      // For Order A: Txn X is 0s delta, Txn Y is 60s delta. |60 - 0| = 60s (< 300s ambiguityToleranceSeconds).
      // Order A has ambiguous candidates X and Y!
      // For Order B: Txn X is 60s delta, Txn Y is 120s delta. |120 - 60| = 60s (< 300s).
      // Both orders are flagged AMBIGUOUS!
      console.log('Scenario 1.1 Results:', {
        matchedCount: res.matchedOrdersCount,
        unmatchedOrders: res.unmatchedOrdersCount,
        records: res.records.map((r) => ({
          orderId: r.orderId,
          txnIds: r.transactionIds,
          status: r.matchStatus,
          confidence: r.confidence,
        })),
      });

      expect(res.matchedOrdersCount).toBe(0);
      expect(res.records.filter((r) => r.matchStatus === 'AMBIGUOUS')).toHaveLength(2);
    });

    it('Scenario 1.2: Remediated Maximum-Cardinality Case (A has 2 candidates [X, Y], B has only 1 candidate [X])', () => {
      // Configuration with timestamp tolerance = 900s (15 min), ambiguity window = 300s
      // Order A at 10:00:00
      // Txn X at 10:00:00 (delta to A: 0s, delta to B: 600s)
      // Txn Y at 09:50:00 (delta to A: 600s, delta to B: 1200s [out of 900s tolerance])
      // Order B at 10:10:00 (delta to X: 600s [eligible!], delta to Y: 1200s [ineligible!])
      const orderA = makeOrder({
        merchantOrderId: 'ORD-A',
        expectedAmount: createMoney(5000, 'USD'),
        createdAt: '2026-11-01T10:00:00.000Z',
        customerReference: 'alice@example.com',
      });
      const orderB = makeOrder({
        merchantOrderId: 'ORD-B',
        expectedAmount: createMoney(5000, 'USD'),
        createdAt: '2026-11-01T10:10:00.000Z',
        customerReference: 'bob@example.com',
      });
      const txnX = makeTxn({
        paypalTransactionId: 'TXN-X',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T10:00:00.000Z',
        rawReference: 'alice@example.com bob@example.com',
      });
      const txnY = makeTxn({
        paypalTransactionId: 'TXN-Y',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T09:50:00.000Z',
        rawReference: 'alice@example.com',
      });

      const res = runDeterministicMatching([orderA, orderB], [txnX, txnY], {
        timestampToleranceSeconds: 900,
        ambiguityToleranceSeconds: 300,
      });

      // Under Maximum Cardinality Matching:
      // Both orders match: A -> Y, B -> X (2 matches!)
      expect(res.matchedOrdersCount).toBe(2);
      expect(res.unmatchedOrdersCount).toBe(0);
    });
  });

  // =========================================================================
  // AUDIT 2: Ambiguity Policy
  // =========================================================================
  describe('Audit 2: Ambiguity Policy & Thresholds', () => {
    it('Candidates separated by 299s (< 300s) are flagged AMBIGUOUS', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn1 = makeTxn({ paypalTransactionId: 'T1', transactionTime: '2026-11-01T10:01:00.000Z' }); // diff 60s
      const txn2 = makeTxn({ paypalTransactionId: 'T2', transactionTime: '2026-11-01T10:05:59.000Z' }); // diff 359s (sep = 299s)

      const res = runDeterministicMatching([order], [txn1, txn2], { ambiguityToleranceSeconds: 300 });
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('Candidates separated by exactly 300s without identity corroboration are routed to manual review', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn1 = makeTxn({ paypalTransactionId: 'T1', transactionTime: '2026-11-01T10:01:00.000Z' }); // diff 60s
      const txn2 = makeTxn({ paypalTransactionId: 'T2', transactionTime: '2026-11-01T10:06:00.000Z' }); // diff 360s (sep = 300s)

      const res = runDeterministicMatching([order], [txn1, txn2], { ambiguityToleranceSeconds: 300 });
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('Candidates separated by 301s without identity corroboration are routed to manual review, never auto-confirmed', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z', customerReference: undefined });
      const txn1 = makeTxn({ paypalTransactionId: 'T1', transactionTime: '2026-11-01T10:01:00.000Z', merchantReference: undefined }); // diff 60s
      const txn2 = makeTxn({ paypalTransactionId: 'T2', transactionTime: '2026-11-01T10:06:01.000Z', merchantReference: undefined }); // diff 361s (sep = 301s)

      const res = runDeterministicMatching([order], [txn1, txn2], { ambiguityToleranceSeconds: 300 });
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('Customer reference breaks tie even within ambiguity window', () => {
      const order = makeOrder({
        createdAt: '2026-11-01T10:00:00.000Z',
        customerReference: 'alice@example.com',
      });
      // T1 has no customer match, diff 60s
      const txn1 = makeTxn({
        paypalTransactionId: 'T1',
        transactionTime: '2026-11-01T10:01:00.000Z',
        merchantReference: 'bob@example.com',
      });
      // T2 has matching customer, diff 65s (only 5s difference!)
      const txn2 = makeTxn({
        paypalTransactionId: 'T2',
        transactionTime: '2026-11-01T10:01:05.000Z',
        merchantReference: 'alice@example.com',
      });

      const res = runDeterministicMatching([order], [txn1, txn2]);
      // Because e1.hasCustomerMatch !== e2.hasCustomerMatch, customer match wins and is NOT ambiguous
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].transactionIds).toEqual(['T2']);
    });
  });

  // =========================================================================
  // AUDIT 3: Refund Accounting
  // =========================================================================
  describe('Audit 3: Refund Accounting Rigor', () => {
    it('Original completed capture $100 + linked completed refund $25', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-R1', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-1',
        paypalOrderId: 'ORD-R1',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-1',
        paypalOrderId: 'ORD-R1',
        grossAmount: createMoney(-2500, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      console.log('Capture + Partial Refund:', res.records[0].matchStatus, res.records[0].discrepancyType);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
    });

    it('Original completed capture $100 + linked completed refund $100', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-R2', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-2',
        paypalOrderId: 'ORD-R2',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-2',
        paypalOrderId: 'ORD-R2',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      console.log('Capture + Full Refund:', res.records[0].matchStatus, res.records[0].discrepancyType);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('Two linked refunds of $40 and $60 against $100 order', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-R3', expectedAmount: createMoney(10000, 'USD') });
      const ref1 = makeTxn({
        paypalTransactionId: 'REF-3A',
        paypalOrderId: 'ORD-R3',
        grossAmount: createMoney(-4000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const ref2 = makeTxn({
        paypalTransactionId: 'REF-3B',
        paypalOrderId: 'ORD-R3',
        grossAmount: createMoney(-6000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [ref1, ref2]);
      expect(res.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('Non-completed refund (PENDING, DENIED, REVERSED) handling', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-R4', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-4',
        paypalOrderId: 'ORD-R4',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      // PENDING refund
      const refPending = makeTxn({
        paypalTransactionId: 'REF-PEND',
        paypalOrderId: 'ORD-R4',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'PENDING', // NOT COMPLETED!
      });

      const res = runDeterministicMatching([order], [cap, refPending]);
      console.log('Pending Refund Classification:', {
        status: res.records[0].matchStatus,
        discrepancy: res.records[0].discrepancyType,
      });

      // Remediated behavior: Pending refund is classified as TIMING_DELAY, never FULL_REFUND_SETTLEMENT
      expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
    });
  });

  // =========================================================================
  // AUDIT 4: API Compatibility & Security
  // =========================================================================
  describe('Audit 4: API Compatibility & Security', () => {
    it('Verifies application/json with mode JSON works', async () => {
      const req = new NextRequest('http://localhost:3000/api/reconciliation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'JSON',
          orders: [makeOrder()],
          transactions: [makeTxn()],
        }),
      });
      const res = await previewHandler(req);
      expect(res.status).toBe(200);
    });

    it('Verifies application/json with mode CSV works', async () => {
      const req = new NextRequest('http://localhost:3000/api/reconciliation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'CSV',
          ordersCsv: 'order_id,amount,currency,date\nORD-1,10.00,USD,2026-11-01T10:00:00Z\n',
          transactionsCsv: 'transaction_id,gross,currency,date\nTXN-1,10.00,USD,2026-11-01T10:00:00Z\n',
        }),
      });
      const res = await previewHandler(req);
      expect(res.status).toBe(200);
    });

    it('Verifies direct Content-Type text/csv returns 415 Unsupported Media Type', async () => {
      const req = new NextRequest('http://localhost:3000/api/reconciliation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: 'order_id,amount,currency,date\nORD-1,10.00,USD,2026-11-01T10:00:00Z\n',
      });
      const res = await previewHandler(req);
      expect(res.status).toBe(415);
    });
  });
});

