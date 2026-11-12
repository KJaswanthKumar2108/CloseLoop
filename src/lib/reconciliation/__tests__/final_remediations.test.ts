import { describe, it, expect } from 'vitest';
import { runDeterministicMatching } from '../matcher/matchingEngine';
import { hasIdentityCorroboration } from '../matcher/matchingRules';
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
    transactionType: overrides.transactionType || 'CAPTURE',
    transactionStatus: overrides.transactionStatus || 'COMPLETED',
    transactionTime: overrides.transactionTime || '2026-11-01T12:05:00.000Z',
    source: 'PAYPAL_EXPORT',
    rawReference: 'TEST ROW',
    ...overrides,
  };
}

describe('Phase 2A Final Financial Correctness Remediation Suite', () => {
  // =========================================================================
  // REMEDIATION A: Refund Settlement Status Gate
  // =========================================================================
  describe('Remediation A: Refund Settlement Status Gate', () => {
    it('1. Completed capture $100 + completed refund $25 flags PARTIAL_REFUND_MISMATCH', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-1', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-1',
        paypalOrderId: 'ORD-REF-1',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-1',
        paypalOrderId: 'ORD-REF-1',
        grossAmount: createMoney(-2500, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
      expect(res.records[0].transactionIds).toContain('REF-1');
    });

    it('2. Completed capture $100 + completed refund $100 flags FULL_REFUND_SETTLEMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-2', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-2',
        paypalOrderId: 'ORD-REF-2',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-2',
        paypalOrderId: 'ORD-REF-2',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('3. Completed capture $100 + completed refunds $40 and $60 aggregates to FULL_REFUND_SETTLEMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-3', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-3',
        paypalOrderId: 'ORD-REF-3',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref1 = makeTxn({
        paypalTransactionId: 'REF-3A',
        paypalOrderId: 'ORD-REF-3',
        grossAmount: createMoney(-4000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const ref2 = makeTxn({
        paypalTransactionId: 'REF-3B',
        paypalOrderId: 'ORD-REF-3',
        grossAmount: createMoney(-6000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref1, ref2]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('4. Completed capture $100 + pending refund $100 flags TIMING_DELAY, never FULL_REFUND_SETTLEMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-4', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-4',
        paypalOrderId: 'ORD-REF-4',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-4-PEND',
        paypalOrderId: 'ORD-REF-4',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'PENDING', // PENDING!
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('TIMING_DELAY');
      expect(res.records[0].transactionIds).toContain('REF-4-PEND');
    });

    it('5. Completed capture $100 + denied refund $100 flags UNEXPECTED_STATUS, never FULL_REFUND_SETTLEMENT', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-5', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-5',
        paypalOrderId: 'ORD-REF-5',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-5-DENIED',
        paypalOrderId: 'ORD-REF-5',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'DENIED', // DENIED!
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('UNEXPECTED_STATUS');
    });

    it('6. Completed capture $100 + reversed refund $100 flags DISPUTE_HOLD', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-6', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-6',
        paypalOrderId: 'ORD-REF-6',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-6-REV',
        paypalOrderId: 'ORD-REF-6',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'REVERSED', // REVERSED!
      });

      const res = runDeterministicMatching([order], [cap, ref]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('DISPUTE_HOLD');
    });

    it('7. Completed capture $100 + completed refund $40 + pending refund $60 flags PARTIAL_REFUND_MISMATCH', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-7', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-7',
        paypalOrderId: 'ORD-REF-7',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const refCompleted = makeTxn({
        paypalTransactionId: 'REF-7-COMP',
        paypalOrderId: 'ORD-REF-7',
        grossAmount: createMoney(-4000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const refPending = makeTxn({
        paypalTransactionId: 'REF-7-PEND',
        paypalOrderId: 'ORD-REF-7',
        grossAmount: createMoney(-6000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'PENDING',
      });

      const res = runDeterministicMatching([order], [cap, refCompleted, refPending]);
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      // Completed refund is only $40. Pending $60 is excluded from settled total!
      expect(res.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
      expect(res.records[0].evidence.reasonsForAccepting.some((r) => r.includes('pending refund'))).toBe(true);
    });

    it('8. Duplicate completed refund is deduplicated and not counted twice', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-REF-8', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-8',
        paypalOrderId: 'ORD-REF-8',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const ref = makeTxn({
        paypalTransactionId: 'REF-DUP',
        paypalOrderId: 'ORD-REF-8',
        grossAmount: createMoney(-5000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const refDuplicate = makeTxn({
        paypalTransactionId: 'REF-DUP', // Same transaction ID
        paypalOrderId: 'ORD-REF-8',
        grossAmount: createMoney(-5000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([order], [cap, ref, refDuplicate]);
      // Should only count $50 once, not twice ($100). Thus PARTIAL_REFUND_MISMATCH!
      expect(res.records[0].matchStatus).toBe('DISCREPANCY');
      expect(res.records[0].discrepancyType).toBe('PARTIAL_REFUND_MISMATCH');
    });

    it('9. Refund linked to another order does not affect target order', () => {
      const orderA = makeOrder({ merchantOrderId: 'ORD-AAA', expectedAmount: createMoney(10000, 'USD') });
      const orderB = makeOrder({ merchantOrderId: 'ORD-BBB', expectedAmount: createMoney(10000, 'USD') });

      const capA = makeTxn({
        paypalTransactionId: 'CAP-A',
        paypalOrderId: 'ORD-AAA',
        grossAmount: createMoney(10000, 'USD'),
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
      });
      const refB = makeTxn({
        paypalTransactionId: 'REF-B',
        paypalOrderId: 'ORD-BBB',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });

      const res = runDeterministicMatching([orderA, orderB], [capA, refB]);
      const recA = res.records.find((r) => r.orderId === 'ORD-AAA');
      const recB = res.records.find((r) => r.orderId === 'ORD-BBB');

      expect(recA?.matchStatus).toBe('MATCHED');
      expect(recA?.discrepancyType).toBe('NONE');
      expect(recB?.matchStatus).toBe('DISCREPANCY');
      expect(recB?.discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });

    it('10. Pending refund followed by completed refund in subsequent run shifts state safely', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-EVOLVE', expectedAmount: createMoney(10000, 'USD') });
      const cap = makeTxn({
        paypalTransactionId: 'CAP-EVO',
        paypalOrderId: 'ORD-EVOLVE',
        grossAmount: createMoney(10000, 'USD'),
      });

      // Run 1: Refund is pending
      const refRun1 = makeTxn({
        paypalTransactionId: 'REF-EVO',
        paypalOrderId: 'ORD-EVOLVE',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'PENDING',
      });
      const res1 = runDeterministicMatching([order], [cap, refRun1]);
      expect(res1.records[0].discrepancyType).toBe('TIMING_DELAY');

      // Run 2: Refund clears as completed
      const refRun2 = makeTxn({
        paypalTransactionId: 'REF-EVO',
        paypalOrderId: 'ORD-EVOLVE',
        grossAmount: createMoney(-10000, 'USD'),
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
      });
      const res2 = runDeterministicMatching([order], [cap, refRun2]);
      expect(res2.records[0].discrepancyType).toBe('FULL_REFUND_SETTLEMENT');
    });
  });

  // =========================================================================
  // REMEDIATION B: Prevent Uncorroborated Composite Auto-Confirmation
  // =========================================================================
  describe('Remediation B: Prevent Uncorroborated Composite Auto-Confirmation', () => {
    it('1. Amount + currency + timestamp only: routed to manual review (AMBIGUOUS), never MATCHED', () => {
      const order = makeOrder({
        createdAt: '2026-11-01T10:00:00.000Z',
        customerReference: undefined,
        externalReference: undefined,
      });
      const txn = makeTxn({
        transactionTime: '2026-11-01T10:02:00.000Z',
        merchantReference: undefined,
        invoiceId: undefined,
        paypalOrderId: undefined,
      });

      expect(hasIdentityCorroboration(order, txn)).toBe(false);
      const res = runDeterministicMatching([order], [txn]);
      expect(res.matchedOrdersCount).toBe(0);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
      expect(res.records[0].evidence.matchingRule).toBe('RULE_COMPOSITE_UNCORROBORATED_IDENTITY');
    });

    it('2. Same scenario with 60-second difference: manual review', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn = makeTxn({ transactionTime: '2026-11-01T10:01:00.000Z' });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('3. Same scenario with 301-second difference: manual review, never auto-confirmed', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn = makeTxn({ transactionTime: '2026-11-01T10:05:01.000Z' }); // 301s later

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('4. Same scenario with 600-second difference: manual review, never auto-confirmed', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn = makeTxn({ transactionTime: '2026-11-01T10:10:00.000Z' }); // 600s later

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('5. Composite candidate with corroborating customer email: confirmed as MATCHED', () => {
      const order = makeOrder({
        createdAt: '2026-11-01T10:00:00.000Z',
        customerReference: 'sarah.connor@cyberdyne.com',
      });
      const txn = makeTxn({
        transactionTime: '2026-11-01T10:05:00.000Z',
        merchantReference: 'sarah.connor@cyberdyne.com', // Corroborating email!
      });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.matchedOrdersCount).toBe(1);
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].confidence).toBe('COMPOSITE_CONFIRMED');
    });

    it('6. Composite candidate with supported invoice/reference metadata: confirmed as MATCHED', () => {
      const order = makeOrder({
        createdAt: '2026-11-01T10:00:00.000Z',
        externalReference: 'INV-CORROBORATED-99',
      });
      const txn = makeTxn({
        transactionTime: '2026-11-01T10:05:00.000Z',
        rawReference: 'Payment for order invoice INV-CORROBORATED-99',
      });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.matchedOrdersCount).toBe(1);
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].confidence).toBe('COMPOSITE_CONFIRMED');
    });

    it('7. Conflicting customer metadata routes to manual review', () => {
      const order = makeOrder({
        createdAt: '2026-11-01T10:00:00.000Z',
        customerReference: 'alice@example.com',
      });
      const txn = makeTxn({
        transactionTime: '2026-11-01T10:02:00.000Z',
        merchantReference: 'bob@example.com', // Conflicting customer identity!
      });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
      expect(res.records[0].confidence).toBe('MANUAL_REVIEW_REQUIRED');
    });

    it('8. Exact authoritative identifier preserves valid exact-match behavior', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-EXACT-AUTHORITATIVE' });
      const txn = makeTxn({
        paypalOrderId: 'ORD-EXACT-AUTHORITATIVE',
      });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records[0].matchStatus).toBe('MATCHED');
      expect(res.records[0].confidence).toBe('EXACT_AUTHORITATIVE');
    });

    it('9. Two competing candidates without corroborating identity: no false confirmation', () => {
      const order = makeOrder({ createdAt: '2026-11-01T10:00:00.000Z' });
      const txn1 = makeTxn({ paypalTransactionId: 'T1', transactionTime: '2026-11-01T10:01:00.000Z' });
      const txn2 = makeTxn({ paypalTransactionId: 'T2', transactionTime: '2026-11-01T10:02:00.000Z' });

      const res = runDeterministicMatching([order], [txn1, txn2]);
      expect(res.matchedOrdersCount).toBe(0);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
    });

    it('10. Ensure no duplicate unmatched/ambiguous records are created', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-SOLO-UNCORROB' });
      const txn = makeTxn({ paypalTransactionId: 'TXN-SOLO-UNCORROB' });

      const res = runDeterministicMatching([order], [txn]);
      expect(res.records).toHaveLength(1);
      expect(res.records[0].orderId).toBe('ORD-SOLO-UNCORROB');
      expect(res.records[0].transactionIds).toEqual(['TXN-SOLO-UNCORROB']);
      // Asserts that no UNMATCHED_ORDER or UNMATCHED_TRANSACTION record was duplicated!
      expect(res.records.filter((r) => r.matchStatus === 'UNMATCHED_ORDER')).toHaveLength(0);
      expect(res.records.filter((r) => r.matchStatus === 'UNMATCHED_TRANSACTION')).toHaveLength(0);
    });
  });

  // =========================================================================
  // REMEDIATION C: Maximum-Cardinality Pass 2 Allocation
  // =========================================================================
  describe('Remediation C: Maximum-Cardinality Pass 2 Allocation', () => {
    it('1. Counterexample: Bipartite augmenting path finds 2 matches where greedy found only 1', () => {
      // Order A at 10:00:00 (Customer: alice@example.com)
      // Order B at 10:10:00 (Customer: bob@example.com)
      // Txn X at 10:00:00 (References both alice and bob in memo)
      // Txn Y at 09:50:00 (References alice in memo)
      // Tolerance: 900 seconds.
      // Candidate edges:
      // A -> X (diff 0s), A -> Y (diff 600s)
      // B -> X (diff 600s) [Y is at 1200s, out of tolerance!]
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
        rawReference: 'Payment from alice@example.com and bob@example.com',
      });
      const txnY = makeTxn({
        paypalTransactionId: 'TXN-Y',
        grossAmount: createMoney(5000, 'USD'),
        transactionTime: '2026-11-01T09:50:00.000Z',
        rawReference: 'Payment from alice@example.com',
      });

      const res = runDeterministicMatching([orderA, orderB], [txnX, txnY], {
        timestampToleranceSeconds: 900,
        ambiguityToleranceSeconds: 300,
      });

      // IN A MAXIMUM CARDINALITY MATCHING:
      // A matches Y, B matches X => 2 matches!
      expect(res.matchedOrdersCount).toBe(2);
      expect(res.unmatchedOrdersCount).toBe(0);
      expect(res.unmatchedTransactionsCount).toBe(0);

      const matchA = res.records.find((r) => r.orderId === 'ORD-A');
      const matchB = res.records.find((r) => r.orderId === 'ORD-B');
      expect(matchA?.transactionIds).toEqual(['TXN-Y']);
      expect(matchB?.transactionIds).toEqual(['TXN-X']);
    });

    it('2. Multiple orders competing for one transaction: exactly 1 matched, other unmatched', () => {
      const order1 = makeOrder({
        merchantOrderId: 'ORD-1',
        createdAt: '2026-11-01T10:00:00Z',
        customerReference: 'shared@example.com',
      });
      const order2 = makeOrder({
        merchantOrderId: 'ORD-2',
        createdAt: '2026-11-01T10:10:00Z', // 600s later (outside 300s ambiguity)
        customerReference: 'shared@example.com',
      });
      const txn = makeTxn({
        paypalTransactionId: 'TXN-SOLO',
        transactionTime: '2026-11-01T10:00:00Z',
        merchantReference: 'shared@example.com',
      });

      const res = runDeterministicMatching([order1, order2], [txn]);
      expect(res.matchedOrdersCount).toBe(1);
      expect(res.unmatchedOrdersCount).toBe(1);
    });

    it('3. Multiple transactions competing for one order: exactly 1 matched, other unconsumed', () => {
      const order = makeOrder({
        merchantOrderId: 'ORD-1',
        createdAt: '2026-11-01T10:00:00Z',
        customerReference: 'user@example.com',
      });
      const txn1 = makeTxn({
        paypalTransactionId: 'TXN-1',
        transactionTime: '2026-11-01T10:01:00Z',
        merchantReference: 'user@example.com',
      });
      const txn2 = makeTxn({
        paypalTransactionId: 'TXN-2',
        transactionTime: '2026-11-01T10:10:00Z', // 600s later (outside 300s ambiguity)
        merchantReference: 'user@example.com',
      });

      const res = runDeterministicMatching([order], [txn1, txn2]);
      expect(res.matchedOrdersCount).toBe(1);
      expect(res.unmatchedTransactionsCount).toBe(1);
    });

    it('4. A graph with multiple maximum-cardinality assignments resolves deterministically', () => {
      const order1 = makeOrder({
        merchantOrderId: 'ORD-1',
        createdAt: '2026-11-01T10:00:00Z',
        customerReference: 'cust1@example.com',
      });
      const order2 = makeOrder({
        merchantOrderId: 'ORD-2',
        createdAt: '2026-11-01T10:10:00Z',
        customerReference: 'cust2@example.com',
      });
      const txn1 = makeTxn({
        paypalTransactionId: 'TXN-1',
        transactionTime: '2026-11-01T10:00:00Z',
        rawReference: 'Payment from cust1@example.com and cust2@example.com',
      });
      const txn2 = makeTxn({
        paypalTransactionId: 'TXN-2',
        transactionTime: '2026-11-01T10:10:00Z',
        rawReference: 'Payment from cust1@example.com and cust2@example.com',
      });

      const res = runDeterministicMatching([order1, order2], [txn1, txn2]);
      expect(res.matchedOrdersCount).toBe(2);
    });

    it('5. Prefers stronger customer reference match while preserving maximum cardinality', () => {
      const order1 = makeOrder({ merchantOrderId: 'ORD-STRONG', customerReference: 'direct@example.com' });
      const order2 = makeOrder({ merchantOrderId: 'ORD-PARTIAL', externalReference: 'INV-PARTIAL' });
      const txnDirect = makeTxn({ paypalTransactionId: 'TXN-DIRECT', merchantReference: 'direct@example.com' });
      const txnPartial = makeTxn({ paypalTransactionId: 'TXN-PARTIAL', rawReference: 'INV-PARTIAL' });

      const res = runDeterministicMatching([order1, order2], [txnDirect, txnPartial]);
      expect(res.matchedOrdersCount).toBe(2);
      expect(res.records.find((r) => r.orderId === 'ORD-STRONG')?.transactionIds).toEqual(['TXN-DIRECT']);
      expect(res.records.find((r) => r.orderId === 'ORD-PARTIAL')?.transactionIds).toEqual(['TXN-PARTIAL']);
    });

    it('6. Deterministic results across shuffled input arrays', () => {
      const o1 = makeOrder({ merchantOrderId: 'ORD-SHUFFLE-1', customerReference: 'u1@example.com' });
      const o2 = makeOrder({ merchantOrderId: 'ORD-SHUFFLE-2', customerReference: 'u2@example.com' });
      const t1 = makeTxn({ paypalTransactionId: 'TXN-SHUFFLE-1', merchantReference: 'u1@example.com' });
      const t2 = makeTxn({ paypalTransactionId: 'TXN-SHUFFLE-2', merchantReference: 'u2@example.com' });

      const resForward = runDeterministicMatching([o1, o2], [t1, t2]);
      const resReverse = runDeterministicMatching([o2, o1], [t2, t1]);

      expect(resForward.matchedOrdersCount).toBe(resReverse.matchedOrdersCount);
      expect(resForward.records.map((r) => r.id).sort()).toEqual(resReverse.records.map((r) => r.id).sort());
    });

    it('7. Previously consumed transactions excluded from Pass 2', () => {
      const orderExact = makeOrder({ merchantOrderId: 'ORD-EXACT', externalReference: 'INV-EXACT' });
      const orderComposite = makeOrder({ merchantOrderId: 'ORD-COMPOSITE', customerReference: 'user@example.com' });

      // Transaction that exactly matches orderExact via authoritative reference
      const txnExact = makeTxn({ paypalTransactionId: 'TXN-EXACT', paypalOrderId: 'ORD-EXACT', merchantReference: 'user@example.com' });
      const txnOther = makeTxn({ paypalTransactionId: 'TXN-OTHER', merchantReference: 'user@example.com' });

      const res = runDeterministicMatching([orderExact, orderComposite], [txnExact, txnOther]);
      // txnExact is consumed by Pass 1; Pass 2 matches orderComposite to txnOther
      expect(res.records.find((r) => r.orderId === 'ORD-EXACT')?.transactionIds).toEqual(['TXN-EXACT']);
      expect(res.records.find((r) => r.orderId === 'ORD-COMPOSITE')?.transactionIds).toEqual(['TXN-OTHER']);
    });

    it('8. Ambiguous candidates excluded from automatic allocation', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-AMBIG', createdAt: '2026-11-01T10:00:00Z', customerReference: 'u@example.com' });
      const t1 = makeTxn({ paypalTransactionId: 'TXN-A', transactionTime: '2026-11-01T10:01:00Z', merchantReference: 'u@example.com' });
      const t2 = makeTxn({ paypalTransactionId: 'TXN-B', transactionTime: '2026-11-01T10:01:05Z', merchantReference: 'u@example.com' });

      const res = runDeterministicMatching([order], [t1, t2]);
      expect(res.matchedOrdersCount).toBe(0);
      expect(res.records[0].matchStatus).toBe('AMBIGUOUS');
    });

    it('9. Ineligible currencies and amounts excluded', () => {
      const order = makeOrder({ merchantOrderId: 'ORD-USD', expectedAmount: createMoney(10000, 'USD'), currency: 'USD' });
      const txnEur = makeTxn({ paypalTransactionId: 'TXN-EUR', grossAmount: createMoney(10000, 'EUR'), currency: 'EUR' });
      const txnWrongAmt = makeTxn({ paypalTransactionId: 'TXN-WRONG', grossAmount: createMoney(9999, 'USD') });

      const res = runDeterministicMatching([order], [txnEur, txnWrongAmt]);
      expect(res.matchedOrdersCount).toBe(0);
      expect(res.unmatchedOrdersCount).toBe(1);
    });

    it('10. Large synthetic candidate graph executes deterministically with fast runtime', () => {
      const orders: MerchantOrder[] = [];
      const txns: PaymentTransaction[] = [];

      for (let i = 1; i <= 50; i++) {
        orders.push(makeOrder({
          merchantOrderId: `ORD-BULK-${i}`,
          expectedAmount: createMoney(2500, 'USD'),
          customerReference: `user${i}@example.com`,
          createdAt: `2026-11-01T10:${(i % 50).toString().padStart(2, '0')}:00Z`,
        }));
        txns.push(makeTxn({
          paypalTransactionId: `TXN-BULK-${i}`,
          grossAmount: createMoney(2500, 'USD'),
          merchantReference: `user${i}@example.com`,
          transactionTime: `2026-11-01T10:${(i % 50).toString().padStart(2, '0')}:05Z`,
        }));
      }

      const startTime = performance.now();
      const res = runDeterministicMatching(orders, txns);
      const durationMs = performance.now() - startTime;

      expect(res.matchedOrdersCount).toBe(50);
      expect(durationMs).toBeLessThan(100); // Executed in well under 100ms
    });

    it('11. Invariant: No transaction is assigned to more than one order in Pass 2', () => {
      const o1 = makeOrder({
        merchantOrderId: 'O-1',
        createdAt: '2026-11-01T10:00:00Z',
        customerReference: 'shared@test.com',
      });
      const o2 = makeOrder({
        merchantOrderId: 'O-2',
        createdAt: '2026-11-01T10:10:00Z',
        customerReference: 'shared@test.com',
      });
      const t1 = makeTxn({
        paypalTransactionId: 'T-SHARED',
        transactionTime: '2026-11-01T10:00:00Z',
        merchantReference: 'shared@test.com',
      });

      const res = runDeterministicMatching([o1, o2], [t1]);
      const txnMatches = res.records.filter(
        (r) => r.matchStatus === 'MATCHED' && r.transactionIds.includes('T-SHARED')
      );
      expect(txnMatches).toHaveLength(1);
    });

    it('12. Invariant: No order is assigned more than one transaction in Pass 2', () => {
      const o1 = makeOrder({ merchantOrderId: 'O-SOLO', customerReference: 'multi@test.com' });
      const t1 = makeTxn({ paypalTransactionId: 'T-1', merchantReference: 'multi@test.com' });
      const t2 = makeTxn({ paypalTransactionId: 'T-2', merchantReference: 'multi@test.com' });

      const res = runDeterministicMatching([o1], [t1, t2]);
      const orderMatches = res.records.filter((r) => r.orderId === 'O-SOLO' && r.matchStatus === 'MATCHED');
      if (orderMatches.length > 0) {
        expect(orderMatches[0].transactionIds).toHaveLength(1);
      }
    });
  });
});
