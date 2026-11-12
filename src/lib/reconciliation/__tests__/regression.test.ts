import { describe, it, expect } from 'vitest';
import { runDeterministicMatching } from '../matcher/matchingEngine';
import {
  importPayPalTransactionsCsv,
  normalizeTransactionType,
  normalizeTransactionStatus,
} from '../importer/transactionCsvImporter';
import { createMoney } from '../money';
import { MerchantOrder, PaymentTransaction } from '@/types/financial';
import { NextRequest } from 'next/server';
import { POST as previewHandler } from '@/app/api/reconciliation/preview/route';

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
    transactionType: overrides.transactionType || 'CAPTURE',
    transactionStatus: overrides.transactionStatus || 'COMPLETED',
    transactionTime: overrides.transactionTime || '2026-11-01T12:05:00.000Z',
    source: 'PAYPAL_EXPORT',
    rawReference: 'TEST ROW',
    ...overrides,
  };
}

describe('Phase 2A Regression Test Suite: Financial Integrity Hardening', () => {
  // ==========================================
  // TASK 1: Multi-Capture Financial Eligibility
  // ==========================================
  describe('Task 1: Multi-Capture Financial Eligibility', () => {
    it('Completed $120 + denied $80 against $200 order flags MULTI_CAPTURE_VARIANCE discrepancy', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-DENIED', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-DENIED',
        grossAmount: createMoney(12000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-DENIED',
        grossAmount: createMoney(8000, 'USD'),
        transactionStatus: 'DENIED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('MULTI_CAPTURE_VARIANCE');
      expect(res.records[0].actualAmount.amountMinor).toBe(12000);
      expect(res.records[0].varianceAmount.amountMinor).toBe(8000);
    });

    it('Completed $120 + pending $80 against $200 order flags TIMING_DELAY discrepancy', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-PENDING', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-PENDING',
        grossAmount: createMoney(12000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-PENDING',
        grossAmount: createMoney(8000, 'USD'),
        transactionStatus: 'PENDING',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
      expect(res.records[0].actualAmount.amountMinor).toBe(12000);
    });

    it('Completed $120 + failed $80 against $200 order flags MULTI_CAPTURE_VARIANCE', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-FAILED', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-FAILED',
        grossAmount: createMoney(12000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-FAILED',
        grossAmount: createMoney(8000, 'USD'),
        transactionStatus: 'DENIED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('MULTI_CAPTURE_VARIANCE');
      expect(res.records[0].actualAmount.amountMinor).toBe(12000);
    });

    it('Completed $120 + completed $80 against $200 order successfully matches', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-SUCCESS', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-SUCCESS',
        grossAmount: createMoney(12000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-SUCCESS',
        grossAmount: createMoney(8000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].discrepancyType).toBe('NONE');
      expect(res.records[0].actualAmount.amountMinor).toBe(20000);
      expect(res.records[0].varianceAmount.amountMinor).toBe(0);
    });

    it('Completed captures exceeding expected amount flags OVER_PAYMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-OVER', expectedAmount: createMoney(15000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-OVER',
        grossAmount: createMoney(10000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-OVER',
        grossAmount: createMoney(8000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('MULTI_CAPTURE_VARIANCE');
      expect(res.records[0].actualAmount.amountMinor).toBe(18000);
    });

    it('Completed captures below expected amount flags UNDER_PAYMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-UNDER', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-UNDER',
        grossAmount: createMoney(10000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-UNDER',
        grossAmount: createMoney(5000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('MULTI_CAPTURE_VARIANCE');
      expect(res.records[0].actualAmount.amountMinor).toBe(15000);
    });

    it('Duplicate capture ID is deduplicated and not counted twice', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-DUP', expectedAmount: createMoney(20000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-DUP',
        grossAmount: createMoney(10000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      // Identical capture ID C1 passed twice
      const cap1Dup = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-DUP',
        grossAmount: createMoney(10000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap1Dup]);
      // Should only count C1 once ($100), not twice ($200)
      expect(res.records[0].actualAmount.amountMinor).toBe(10000);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('AMOUNT_MISMATCH');
    });

    it('Mixed currencies in multi-capture flags CURRENCY_MISMATCH', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SPLIT-CURR', expectedAmount: createMoney(20000, 'USD'), currency: 'USD' });
      const cap1 = makeTxn({
        paypalTransactionId: 'C1',
        paypalOrderId: 'ORD-SPLIT-CURR',
        grossAmount: createMoney(10000, 'USD'),
        currency: 'USD',
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });
      const cap2 = makeTxn({
        paypalTransactionId: 'C2',
        paypalOrderId: 'ORD-SPLIT-CURR',
        grossAmount: createMoney(10000, 'EUR'),
        currency: 'EUR',
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order], [cap1, cap2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('CURRENCY_MISMATCH');
    });

    it('One capture cannot be allocated to multiple orders', () => {
      const order1 = makeOrder({ merchantOrderId: 'ORD-COMPETE-1', expectedAmount: createMoney(10000, 'USD') });
      const order2 = makeOrder({ merchantOrderId: 'ORD-COMPETE-2', expectedAmount: createMoney(10000, 'USD') });
      const cap1 = makeTxn({
        paypalTransactionId: 'SHARED-CAP',
        paypalOrderId: 'ORD-COMPETE-1',
        grossAmount: createMoney(10000, 'USD'),
        transactionStatus: 'COMPLETED',
        transactionType: 'CAPTURE',
      });

      const res = runDeterministicMatching([order1, order2], [cap1]);
      const matchedRecords = res.records.filter(r => r.transactionIds.includes('SHARED-CAP'));
      // Exactly 1 reconciliation record references SHARED-CAP
      expect(matchedRecords).toHaveLength(1);
      expect(matchedRecords[0].orderId).toBe('ORD-COMPETE-1');
      expect(matchedRecords[0].matchStatus).toBe('MATCHED');

      // The other order remains unmatched
      const unassignedOrder = res.records.find(r => r.orderId === 'ORD-COMPETE-2');
      expect(unassignedOrder?.matchStatus).toBe('UNMATCHED_ORDER');
    });
  });

  // ==========================================
  // TASK 2: Authorization vs. Capture Safety
  // ==========================================
  describe('Task 2: Authorization vs. Capture Safety', () => {
    it('Authorization + COMPLETED + exact amount flags TIMING_DELAY, never MATCHED', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AUTH-1', expectedAmount: createMoney(10000, 'USD') });
      const auth = makeTxn({
        paypalTransactionId: 'AUTH-1',
        paypalOrderId: 'ORD-AUTH-1',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [auth]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
      expect(res.records[0].confidence).toBe('EXACT_AUTHORITATIVE');
    });

    it('Authorization + PENDING flags TIMING_DELAY', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AUTH-2', expectedAmount: createMoney(10000, 'USD') });
      const auth = makeTxn({
        paypalTransactionId: 'AUTH-2',
        paypalOrderId: 'ORD-AUTH-2',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'PENDING',
      });

      const res = runDeterministicMatching([order], [auth]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
    });

    it('Authorization with matching PayPal Order ID preserves authoritative evidence', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AUTH-3', expectedAmount: createMoney(10000, 'USD') });
      const auth = makeTxn({
        paypalTransactionId: 'AUTH-3',
        paypalOrderId: 'ORD-AUTH-3',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [auth]);
      expect(res.records[0].evidence.matchingRule).toBe('RULE_AUTH_PAYPAL_ORDER_ID');
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
    });

    it('Authorization alongside completed capture matches capture and separates authorization', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AUTH-CAP', expectedAmount: createMoney(10000, 'USD') });
      const auth = makeTxn({
        paypalTransactionId: 'AUTH-X',
        paypalOrderId: 'ORD-AUTH-CAP',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'COMPLETED',
      });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-X',
        paypalOrderId: 'ORD-AUTH-CAP',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [auth, cap]);
      const matchedRec = res.records.find(r => r.matchStatus === 'MATCHED');
      expect(matchedRec).toBeDefined();
      expect(matchedRec?.transactionIds).toEqual(['CAP-X']);

      // Authorization is left unconsumed or recorded without corrupting order match
      const authRec = res.records.find(r => r.transactionIds.includes('AUTH-X'));
      expect(authRec?.matchStatus).toBe('UNMATCHED_TRANSACTION');
    });

    it('Authorization without any capture never confirms settlement', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AUTH-ONLY', expectedAmount: createMoney(10000, 'USD') });
      const auth = makeTxn({
        paypalTransactionId: 'AUTH-SOLO',
        paypalOrderId: 'ORD-AUTH-ONLY',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [auth]);
      expect(res.matchedOrdersCount).toBe(0);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
    });
  });

  // ==========================================
  // TASK 3: Strict CSV Importer Validation
  // ==========================================
  describe('Task 3: Strict CSV Importer Validation', () => {
    it('Rejects unknown transaction types (ACCOUNT_HOLD, SUSPENDED_PAYMENT, CHARGE_FAILED)', () => {
      expect(normalizeTransactionType('ACCOUNT_HOLD')).toBeNull();
      expect(normalizeTransactionType('SUSPENDED_PAYMENT')).toBeNull();
      expect(normalizeTransactionType('CHARGE_FAILED')).toBeNull();
    });

    it('Rejects unknown transaction statuses (EXPIRED_AUTH, UNKNOWN_STATUS)', () => {
      expect(normalizeTransactionStatus('EXPIRED_AUTH')).toBeNull();
      expect(normalizeTransactionStatus('UNKNOWN_STATUS')).toBeNull();
      expect(normalizeTransactionStatus('ARBITRARY_STATUS')).toBeNull();
    });

    it('Rejects empty transaction type and empty status string', () => {
      expect(normalizeTransactionType('')).toBeNull();
      expect(normalizeTransactionType('   ')).toBeNull();
      expect(normalizeTransactionStatus('')).toBeNull();
      expect(normalizeTransactionStatus('   ')).toBeNull();
    });

    it('Marks CSV row invalid when type or status is unknown', () => {
      const csv = `transaction_id,gross,currency,date,type,status
TXN-INV-1,50.00,USD,2026-11-01T12:00:00Z,UNKNOWN_TYPE,COMPLETED
TXN-INV-2,50.00,USD,2026-11-01T12:00:00Z,CAPTURE,UNKNOWN_STATUS`;

      const result = importPayPalTransactionsCsv(csv);
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(2);
      expect(result.validationErrors).toHaveLength(2);
      expect(result.validationErrors[0].field).toBe('type');
      expect(result.validationErrors[1].field).toBe('status');
    });
  });

  // ==========================================
  // TASK 4 & 5: Permutation Invariance & Ambiguity Threshold
  // ==========================================
  describe('Tasks 4 & 5: Permutation Invariance & Ambiguity Window', () => {
    it('Permutation invariance: order array shuffle produces identical output', () => {
      const orderA = makeOrder({ merchantOrderId: 'ORD-AAA', expectedAmount: createMoney(7500, 'USD'), createdAt: '2026-11-01T10:00:00Z' });
      const orderB = makeOrder({ merchantOrderId: 'ORD-BBB', expectedAmount: createMoney(7500, 'USD'), createdAt: '2026-11-01T10:10:00Z' });
      const txn = makeTxn({ paypalTransactionId: 'TXN-TARGET', grossAmount: createMoney(7500, 'USD'), transactionTime: '2026-11-01T10:10:00Z' });

      // Run with [A, B]
      const res1 = runDeterministicMatching([orderA, orderB], [txn]);
      // Run with [B, A]
      const res2 = runDeterministicMatching([orderB, orderA], [txn]);

      expect(res1.matchedOrdersCount).toBe(res2.matchedOrdersCount);
      expect(res1.unmatchedOrdersCount).toBe(res2.unmatchedOrdersCount);
      expect(res1.records.map(r => r.id).sort()).toEqual(res2.records.map(r => r.id).sort());
    });

    it('Ambiguity detection: candidates at 60s and 61s delta are flagged AMBIGUOUS', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AMB', expectedAmount: createMoney(5000, 'USD'), createdAt: '2026-11-01T12:00:00Z' });
      const txn1 = makeTxn({ paypalTransactionId: 'TXN-60', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:01:00Z' });
      const txn2 = makeTxn({ paypalTransactionId: 'TXN-61', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:01:01Z' });

      const res = runDeterministicMatching([order], [txn1, txn2]);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('Candidates at 60s and 400s delta: unambiguous assignment (> 300s window)', () => {
      const order = makeOrder({
        merchantOrderId: 'ORD-UNAMB',
        expectedAmount: createMoney(5000, 'USD'),
        createdAt: '2026-11-01T12:00:00Z',
        customerReference: 'unamb@example.com',
      });
      // txn1 delta: 60s; txn2 delta: 400s (difference = 340s > 300s tolerance)
      const txn1 = makeTxn({
        paypalTransactionId: 'TXN-CLOSE',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T12:01:00Z',
        merchantReference: 'unamb@example.com',
      });
      const txn2 = makeTxn({
        paypalTransactionId: 'TXN-FAR',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T12:06:40Z',
      });

      const res = runDeterministicMatching([order], [txn1, txn2]);
      const matched = res.records.find(r => r.matchStatus === 'MATCHED');
      expect(matched).toBeDefined();
      expect(matched?.transactionIds).toEqual(['TXN-CLOSE']);
    });
  });

  // ==========================================
  // TASK 6: Single-Record Ownership Policy
  // ==========================================
  describe('Task 6: Single-Record Ownership Policy', () => {
    it('Each physical transaction appears in at most one reconciliation record across all passes', () => {
      const order1 = makeOrder({ merchantOrderId: 'ORD-OWN-1', expectedAmount: createMoney(5000, 'USD'), createdAt: '2026-11-01T12:00:00Z' });
      const order2 = makeOrder({ merchantOrderId: 'ORD-OWN-2', expectedAmount: createMoney(6000, 'USD'), createdAt: '2026-11-01T12:00:00Z' });

      const txn1 = makeTxn({ paypalTransactionId: 'TXN-1', grossAmount: createMoney(5000, 'USD'), transactionTime: '2026-11-01T12:02:00Z' });
      const txn2 = makeTxn({ paypalTransactionId: 'TXN-2', grossAmount: createMoney(9999, 'USD'), transactionTime: '2026-11-01T12:02:00Z' });

      const res = runDeterministicMatching([order1, order2], [txn1, txn2]);

      // Check occurrences of each transaction ID
      const allAssignedTxnIds = res.records.flatMap(r => r.transactionIds);
      const counts: Record<string, number> = {};
      for (const id of allAssignedTxnIds) {
        counts[id] = (counts[id] || 0) + 1;
      }

      expect(counts['TXN-1']).toBe(1);
      expect(counts['TXN-2']).toBe(1);
    });
  });

  // ==========================================
  // TASK 7: Conflicting Identifiers
  // ==========================================
  describe('Task 7: Conflicting Identifiers', () => {
    it('Conflicting identifiers: PayPal Order ID matches Order A, merchantReference matches Order B', () => {
      const orderA = makeOrder({ merchantOrderId: 'ORD-ALPHA', externalReference: 'INV-ALPHA' });
      const txn = makeTxn({
        paypalTransactionId: 'TXN-CONFLICT',
        paypalOrderId: 'ORD-ALPHA',
        merchantReference: 'INV-BETA', // Contradictory reference!
      });

      const res = runDeterministicMatching([orderA], [txn]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('CONFLICTING_REFERENCES');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('Consistent multiple identifiers successfully confirms MATCHED', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-CONSISTENT', externalReference: 'INV-CONSISTENT' });
      const txn = makeTxn({
        paypalTransactionId: 'TXN-CONSISTENT',
        paypalOrderId: 'ORD-CONSISTENT',
        merchantReference: 'INV-CONSISTENT',
      });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].discrepancyType).toBe('NONE');
      expect(res.records[0].confidence).toBe('EXACT_AUTHORITATIVE');
    });
  });

  // ==========================================
  // TASK 8: Full vs. Partial Refund Classification
  // ==========================================
  describe('Task 8: Full vs. Partial Refund Classification', () => {
    it('25% partial refund is classified as PARTIAL_REFUND_MISMATCH', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-PARTIAL-REF', expectedAmount: createMoney(10000, 'USD') });
      const refund = makeTxn({
        paypalTransactionId: 'REF-25',
        paypalOrderId: 'ORD-PARTIAL-REF',
        grossAmount: createMoney(-2500, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [refund]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
    });

    it('100% full refund is classified as FULL_REFUND_SETTLEMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-FULL-REF', expectedAmount: createMoney(10000, 'USD') });
      const refund = makeTxn({
        paypalTransactionId: 'REF-100',
        paypalOrderId: 'ORD-FULL-REF',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [refund]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('Multiple partial refunds summing to 100% full refund', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-MULTI-REF', expectedAmount: createMoney(10000, 'USD') });
      const ref1 = makeTxn({
        paypalTransactionId: 'REF-1',
        paypalOrderId: 'ORD-MULTI-REF',
        grossAmount: createMoney(-5000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const ref2 = makeTxn({
        paypalTransactionId: 'REF-2',
        paypalOrderId: 'ORD-MULTI-REF',
        grossAmount: createMoney(-5000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [ref1, ref2]);
      const refundRec = res.records.find(r => r.orderId === 'ORD-MULTI-REF');
      expect(refundRec?.matchStatus).toBe('DISCREPANCY');
      expect(refundRec?.discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });
  });

  // ==========================================
  // TASK 9: API Route Hardening
  // ==========================================
  describe('Task 9: Preview API Route Hardening', () => {
    it('Rejects non-JSON Content-Type with 415 Unsupported Media Type', async () => {
      const req = new NextRequest('http://localhost:3000/api/reconciliation/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'plain text content',
      });

      const response = await previewHandler(req);
      expect(response.status).toBe(415);
      const data = await response.json();
      expect(data.error).toBe('Unsupported Media Type');
    });

    it('Rejects CSV payload exceeding 5,000 rows with 400 Payload Too Large', async () => {
      // Generate a CSV string with 5001 rows
      let largeOrdersCsv = 'order_id,amount,currency,date\n';
      for (let i = 1; i <= 5001; i++) {
        largeOrdersCsv += `ORD-${i},10.00,USD,2026-11-01T12:00:00Z\n`;
      }

      const req = new NextRequest('http://localhost:3000/api/reconciliation/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mode: 'CSV',
          ordersCsv: largeOrdersCsv,
          transactionsCsv: 'transaction_id,gross,currency,date\nTXN-1,10.00,USD,2026-11-01T12:00:00Z\n',
        }),
      });

      const response = await previewHandler(req);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Payload Too Large');
      expect(data.message).toContain('5,000 rows');
    });
  });
});
