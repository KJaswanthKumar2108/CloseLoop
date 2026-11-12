import { describe, it, expect } from 'vitest';
import {
  extractCasesFromReconciliationRun,
  buildDeterministicCaseKey,
  buildLegacyCaseKey,
} from '../caseExtractor';
import {
  ReconciliationRun,
  ReconciliationRecord,
  MerchantOrder,
  PaymentTransaction,
} from '@/types/financial';

describe('Phase 3D.1: Deterministic Case Extractor Suite (Hardened per F-28)', () => {
  const sampleOrder: MerchantOrder = {
    id: 'ord-1',
    merchantOrderId: 'ORD-1001',
    externalReference: 'EXT-1001',
    expectedAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
    currency: 'USD',
    createdAt: '2026-11-01T12:00:00Z',
    updatedAt: '2026-11-01T12:00:00Z',
    orderStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    source: 'TEST',
    metadata: {},
  };

  const sampleTxn: PaymentTransaction = {
    id: 'txn-1',
    paypalTransactionId: '9XY111',
    grossAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
    feeAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
    netAmount: { amountMinor: 9675, currency: 'USD', precision: 2 },
    currency: 'USD',
    transactionType: 'CAPTURE',
    transactionStatus: 'COMPLETED',
    transactionTime: '2026-11-01T12:05:00Z',
    source: 'PAYPAL_API',
    rawReference: 'raw-1',
  };

  describe('Collision-Resistant Structured Case Identity (F-28)', () => {
    it('generates versioned SHA-256 case keys (v1_[64-hex])', () => {
      const key = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD-1001', ['9XY111']);
      expect(key).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(key.length).toBe(67);
    });

    it('remains immune to delimiter character collisions (: , ; / |)', () => {
      // With naive concatenation, "ORD:100" + "TXN" collides with "ORD" + "100:TXN"
      const keyA = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD:100', ['TXN']);
      const keyB = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD', ['100:TXN']);
      const keyC = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD/100;ABC', ['TXN|1']);

      expect(keyA).not.toBe(keyB);
      expect(keyA).not.toBe(keyC);
      expect(keyA).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(keyB).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(keyC).toMatch(/^v1_[a-f0-9]{64}$/);
    });

    it('guarantees Unicode NFC equivalence for decomposed vs precomposed characters', () => {
      // "café": decomposed (cafe + \u0301) vs precomposed (caf\u00e9)
      const decomposedOrder = 'cafe\u0301-100';
      const precomposedOrder = 'caf\u00e9-100';

      const keyDecomposed = buildDeterministicCaseKey('FEE_VARIANCE', decomposedOrder, ['TXN-1']);
      const keyPrecomposed = buildDeterministicCaseKey('FEE_VARIANCE', precomposedOrder, ['TXN-1']);

      expect(keyDecomposed).toBe(keyPrecomposed);
    });

    it('preserves meaningful case sensitivity of external order and transaction references', () => {
      const keyUpper = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD-ABC', ['TXN-XYZ']);
      const keyLower = buildDeterministicCaseKey('FEE_VARIANCE', 'ord-abc', ['txn-xyz']);

      // Distinct external identifiers must not collide
      expect(keyUpper).not.toBe(keyLower);
    });

    it('handles international Unicode and symbols safely (€, ¥, emoji, Cyrillic)', () => {
      const keyEuro = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD_€_100', ['TXN_¥_200']);
      const keyEmoji = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD_📦_100', ['TXN_💳_200']);
      const keyCyrillic = buildDeterministicCaseKey('FEE_VARIANCE', 'ЗАКАЗ_100', ['ПЛАТЕЖ_200']);

      expect(keyEuro).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(keyEmoji).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(keyCyrillic).toMatch(/^v1_[a-f0-9]{64}$/);

      // Same Unicode inputs produce deterministic identical hash
      const keyEuroRepeat = buildDeterministicCaseKey('FEE_VARIANCE', 'ORD_€_100', ['TXN_¥_200']);
      expect(keyEuro).toBe(keyEuroRepeat);
    });

    it('deduplicates duplicate transaction IDs and sorts them deterministically', () => {
      const keyUnsorted = buildDeterministicCaseKey('AMBIGUOUS', 'ORD-1', ['TXN-C', 'TXN-A', 'TXN-B', 'TXN-A']);
      const keySorted = buildDeterministicCaseKey('AMBIGUOUS', 'ORD-1', ['TXN-A', 'TXN-B', 'TXN-C']);

      expect(keyUnsorted).toBe(keySorted);
    });

    it('bounds long references safely to the exact 67-character format', () => {
      const longOrderId = 'ORD_' + 'X'.repeat(1500);
      const longTxnId = 'TXN_' + 'Y'.repeat(1500);

      const key = buildDeterministicCaseKey('AMOUNT_MISMATCH', longOrderId, [longTxnId]);
      expect(key.length).toBe(67);
      expect(key).toMatch(/^v1_[a-f0-9]{64}$/);
    });

    it('normalizes empty or whitespace references without collision', () => {
      const keyEmptyOrder = buildDeterministicCaseKey('MISSING_ORDER', '   ', ['TXN-1']);
      const keyNullOrder = buildDeterministicCaseKey('MISSING_ORDER', null, ['TXN-1']);

      expect(keyEmptyOrder).toBe(keyNullOrder);
    });

    it('provides legacy case key for backward compatibility migration', () => {
      const legacyKey = buildLegacyCaseKey('FEE_VARIANCE', 'ORD-1001', ['9XY111']);
      expect(legacyKey).toBe('FEE_VARIANCE:ORD-1001:9XY111');
    });
  });

  describe('Discrepancy Category Handling', () => {
    it('skips clean matches with discrepancyType NONE', () => {
      const cleanRecord: ReconciliationRecord = {
        id: 'rec-clean',
        orderId: 'ORD-1001',
        transactionIds: ['9XY111'],
        matchStatus: 'MATCHED',
        discrepancyType: 'NONE',
        confidence: 'EXACT_AUTHORITATIVE',
        matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
        expectedAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 0, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          orderId: 'ORD-1001',
          transactionIds: ['9XY111'],
          matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
          matchingRule: 'RULE_EXACT_ORDER_ID',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 10000,
            actualAmountMinor: 10000,
            varianceMinor: 0,
            currency: 'USD',
            isExactMatch: true,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T12:10:00Z',
      };

      const run: ReconciliationRun = {
        id: 'run-1',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 1,
        totalTransactions: 1,
        matchedCount: 1,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 0,
        exceptionCount: 0,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 1, transactionCount: 1 },
        records: [cleanRecord],
      };

      const result = extractCasesFromReconciliationRun({
        run,
        orders: [sampleOrder],
        transactions: [sampleTxn],
        merchantId: 'test_merchant_01',
      });

      expect(result.cleanMatchesSkipped).toBe(1);
      expect(result.eligibleCasesExtracted).toBe(0);
      expect(result.cases).toHaveLength(0);
    });

    it('extracts actionable case for FEE_VARIANCE discrepancy', () => {
      const feeVarianceRecord: ReconciliationRecord = {
        id: 'rec-fee',
        orderId: 'ORD-1001',
        transactionIds: ['9XY111'],
        matchStatus: 'MATCHED',
        discrepancyType: 'FEE_VARIANCE',
        confidence: 'EXACT_AUTHORITATIVE',
        matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
        expectedAmount: { amountMinor: 290, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 35, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          orderId: 'ORD-1001',
          transactionIds: ['9XY111'],
          matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
          matchingRule: 'RULE_FEE_ANALYSIS',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 290,
            actualAmountMinor: 325,
            varianceMinor: 35,
            currency: 'USD',
            isExactMatch: false,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T12:10:00Z',
      };

      const run: ReconciliationRun = {
        id: 'run-fee-1',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 1,
        totalTransactions: 1,
        matchedCount: 1,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 0,
        exceptionCount: 1,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 1, transactionCount: 1 },
        records: [feeVarianceRecord],
      };

      const result = extractCasesFromReconciliationRun({
        run,
        orders: [sampleOrder],
        transactions: [sampleTxn],
        merchantId: 'merchant_us_01',
      });

      expect(result.eligibleCasesExtracted).toBe(1);
      const extracted = result.cases[0];

      expect(extracted.caseRecord.merchantId).toBe('merchant_us_01');
      expect(extracted.caseRecord.caseKey).toMatch(/^v1_[a-f0-9]{64}$/);
      expect(extracted.caseRecord.discrepancyType).toBe('FEE_VARIANCE');
      expect(extracted.caseRecord.varianceAmountMinor).toBe(35);
      expect(extracted.caseRecord.primaryReference).toBe('ORD-1001');

      // Evidence graph items: Order (observed), PayPal Transaction (observed), Match Record (derived)
      expect(extracted.evidenceItems).toHaveLength(3);
      const types = extracted.evidenceItems.map((e) => e.evidenceType);
      expect(types).toContain('MERCHANT_ORDER');
      expect(types).toContain('PAYPAL_TRANSACTION');
      expect(types).toContain('RECONCILIATION_MATCH');

      const derivedItem = extracted.evidenceItems.find((e) => e.evidenceType === 'RECONCILIATION_MATCH');
      expect(derivedItem?.isObservedFact).toBe(false);

      const observedOrder = extracted.evidenceItems.find((e) => e.evidenceType === 'MERCHANT_ORDER');
      expect(observedOrder?.isObservedFact).toBe(true);
    });
  });

  describe('Defense-in-Depth Ineligible and Quarantined Exclusions', () => {
    it('skips AUTHORIZATION transactions from being promoted to settled capture cases', () => {
      const authTxn: PaymentTransaction = {
        ...sampleTxn,
        paypalTransactionId: '9XY_AUTH_01',
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'COMPLETED',
      };

      const authRecord: ReconciliationRecord = {
        id: 'rec-auth',
        transactionIds: ['9XY_AUTH_01'],
        matchStatus: 'UNMATCHED_TRANSACTION',
        discrepancyType: 'UNEXPECTED_STATUS',
        confidence: 'MANUAL_REVIEW_REQUIRED',
        matchingMethod: 'UNMATCHED_DEFAULT',
        expectedAmount: { amountMinor: 0, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          transactionIds: ['9XY_AUTH_01'],
          matchingMethod: 'UNMATCHED_DEFAULT',
          matchingRule: 'UNMATCHED_TXN',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 0,
            actualAmountMinor: 10000,
            varianceMinor: 10000,
            currency: 'USD',
            isExactMatch: false,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T12:10:00Z',
      };

      const run: ReconciliationRun = {
        id: 'run-auth',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 0,
        totalTransactions: 1,
        matchedCount: 0,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 1,
        exceptionCount: 1,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 0, transactionCount: 1 },
        records: [authRecord],
      };

      const result = extractCasesFromReconciliationRun({
        run,
        transactions: [authTxn],
        merchantId: 'test_merchant_01',
      });

      expect(result.eligibleCasesExtracted).toBe(0);
      expect(result.ineligibleQuarantinedSkipped).toBe(1);
    });

    it('skips non-completed REFUND transactions (PENDING, DENIED, FAILED, REVERSED)', () => {
      const pendingRefundTxn: PaymentTransaction = {
        ...sampleTxn,
        paypalTransactionId: '9XY_REFUND_PENDING',
        transactionType: 'REFUND',
        transactionStatus: 'PENDING',
      };

      const refundRecord: ReconciliationRecord = {
        id: 'rec-pending-refund',
        transactionIds: ['9XY_REFUND_PENDING'],
        matchStatus: 'UNMATCHED_TRANSACTION',
        discrepancyType: 'TIMING_DELAY',
        confidence: 'MANUAL_REVIEW_REQUIRED',
        matchingMethod: 'UNMATCHED_DEFAULT',
        expectedAmount: { amountMinor: 0, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 2500, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 2500, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          transactionIds: ['9XY_REFUND_PENDING'],
          matchingMethod: 'UNMATCHED_DEFAULT',
          matchingRule: 'UNMATCHED_TXN',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 0,
            actualAmountMinor: 2500,
            varianceMinor: 2500,
            currency: 'USD',
            isExactMatch: false,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T12:10:00Z',
      };

      const run: ReconciliationRun = {
        id: 'run-pending-refund',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 0,
        totalTransactions: 1,
        matchedCount: 0,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 1,
        exceptionCount: 1,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 0, transactionCount: 1 },
        records: [refundRecord],
      };

      const result = extractCasesFromReconciliationRun({
        run,
        transactions: [pendingRefundTxn],
        merchantId: 'test_merchant_01',
      });

      expect(result.eligibleCasesExtracted).toBe(0);
      expect(result.ineligibleQuarantinedSkipped).toBe(1);
    });

    it('fails closed and throws an error if merchantId is missing from extraction parameters', () => {
      const run: ReconciliationRun = {
        id: 'run-no-merchant',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 0,
        totalTransactions: 0,
        matchedCount: 0,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 0,
        exceptionCount: 0,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 0, transactionCount: 0 },
        records: [],
      };

      expect(() =>
        extractCasesFromReconciliationRun({
          run,
          // merchantId omitted
        })
      ).toThrow('Explicit merchantId is required');
    });

    it('strictly forces extracted case status to OPEN and version to 1', () => {
      const discrepancyRecord: ReconciliationRecord = {
        id: 'rec-disc',
        orderId: 'ORD-1001',
        transactionIds: ['9XY111'],
        matchStatus: 'MATCHED',
        discrepancyType: 'FEE_VARIANCE',
        confidence: 'EXACT_AUTHORITATIVE',
        matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
        expectedAmount: { amountMinor: 290, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 35, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          orderId: 'ORD-1001',
          transactionIds: ['9XY111'],
          matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
          matchingRule: 'RULE_FEE_ANALYSIS',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 290,
            actualAmountMinor: 325,
            varianceMinor: 35,
            currency: 'USD',
            isExactMatch: false,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T12:10:00Z',
      };

      const run: ReconciliationRun = {
        id: 'run-status-check',
        startedAt: '2026-11-01T12:00:00Z',
        completedAt: '2026-11-01T12:01:00Z',
        totalOrders: 1,
        totalTransactions: 1,
        matchedCount: 1,
        unmatchedOrderCount: 0,
        unmatchedTransactionCount: 0,
        exceptionCount: 1,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 1, transactionCount: 1 },
        records: [discrepancyRecord],
      };

      const result = extractCasesFromReconciliationRun({
        run,
        merchantId: 'test_merchant_01',
      });

      expect(result.eligibleCasesExtracted).toBe(1);
      expect(result.cases[0].caseRecord.status).toBe('OPEN');
      expect(result.cases[0].caseRecord.version).toBe(1);
    });
  });
});
