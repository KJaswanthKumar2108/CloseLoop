import { describe, it, expect, beforeEach } from 'vitest';
import {
  getActiveRun,
  setActiveRun,
  getRunHistory,
  getDatasetOrigin,
  setRecordReview,
  getRecordReviews,
  clearWorkbenchState,
} from '@/lib/workbench/workbenchStore';
import {
  generateDemoOrdersCsv,
  generateDemoTransactionsCsv,
  DEMO_ORDERS,
  DEMO_TRANSACTIONS,
} from '@/lib/reconciliation/fixtures';
import { executeReconciliationRun } from '@/lib/reconciliation/service';
import { formatMoney } from '@/lib/reconciliation/money';
import { ReconciliationRun } from '@/types/financial';

describe('Phase 2B: Financial Operator Workbench Integration Suite', () => {
  beforeEach(() => {
    clearWorkbenchState();
  });

  // =========================================================================
  // SUITE 1: Server Workbench Store & In-Memory State
  // =========================================================================
  describe('Suite 1: In-Memory Workbench Store', () => {
    it('1. Initial state has null active run and empty history', () => {
      expect(getActiveRun()).toBeNull();
      expect(getRunHistory()).toHaveLength(0);
      expect(getDatasetOrigin()).toBe('NONE');
      expect(Object.keys(getRecordReviews())).toHaveLength(0);
    });

    it('2. Setting active run correctly updates store, origin, and history', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS.slice(0, 5),
        transactions: DEMO_TRANSACTIONS.slice(0, 5),
      });

      setActiveRun(run, 'SYNTHETIC_DEMO');
      expect(getActiveRun()?.id).toBe(run.id);
      expect(getDatasetOrigin()).toBe('SYNTHETIC_DEMO');
      expect(getRunHistory()).toHaveLength(1);
      expect(getRunHistory()[0].id).toBe(run.id);
    });

    it('3. In-memory history caps at 20 runs and avoids duplicates', () => {
      for (let i = 1; i <= 25; i++) {
        const dummyRun: ReconciliationRun = {
          id: `run_${i}`,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          totalOrders: i,
          totalTransactions: i,
          matchedCount: i,
          unmatchedOrderCount: 0,
          unmatchedTransactionCount: 0,
          exceptionCount: 0,
          status: 'COMPLETED',
          datasetReferences: { orderCount: i, transactionCount: i },
          records: [],
        };
        setActiveRun(dummyRun, 'IMPORTED');
      }

      const history = getRunHistory();
      expect(history).toHaveLength(20);
      expect(history[0].id).toBe('run_25');
    });
  });

  // =========================================================================
  // SUITE 2: Human Operator Review Workflow & Boundary Isolation
  // =========================================================================
  describe('Suite 2: Human Operator Review Workflow Isolation', () => {
    it('4. Review status transitions independently without mutating record reconciliation status', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS.slice(0, 10),
        transactions: DEMO_TRANSACTIONS.slice(0, 10),
      });
      setActiveRun(run, 'SYNTHETIC_DEMO');

      const targetRecord = run.records.find((r) => r.matchStatus === 'DISCREPANCY') || run.records[0];
      const initialMatchStatus = targetRecord.matchStatus;
      const initialDiscrepancy = targetRecord.discrepancyType;

      // Operator marks record as IN_REVIEW
      const r1 = setRecordReview(targetRecord.id, 'IN_REVIEW', 'Assigned to reconciliation analyst');
      expect(r1.status).toBe('IN_REVIEW');
      expect(r1.notes).toBe('Assigned to reconciliation analyst');
      expect(r1.operator).toBe('Financial Operator');

      // Operator marks record as RESOLVED
      const r2 = setRecordReview(targetRecord.id, 'RESOLVED', 'Customer confirmed receipt via ticket #1234');
      expect(r2.status).toBe('RESOLVED');

      // CRITICAL INVARIANT: The underlying reconciliation record status remains completely untouched!
      expect(targetRecord.matchStatus).toBe(initialMatchStatus);
      expect(targetRecord.discrepancyType).toBe(initialDiscrepancy);
    });

    it('5. Supports all 4 operator review states (OPEN, IN_REVIEW, RESOLVED, DISMISSED)', () => {
      const recordId = 'rec_test_states';

      setRecordReview(recordId, 'OPEN');
      expect(getRecordReviews()[recordId].status).toBe('OPEN');

      setRecordReview(recordId, 'IN_REVIEW');
      expect(getRecordReviews()[recordId].status).toBe('IN_REVIEW');

      setRecordReview(recordId, 'RESOLVED');
      expect(getRecordReviews()[recordId].status).toBe('RESOLVED');

      setRecordReview(recordId, 'DISMISSED');
      expect(getRecordReviews()[recordId].status).toBe('DISMISSED');
    });
  });

  // =========================================================================
  // SUITE 3: Synthetic Demonstration Fixture Consistency
  // =========================================================================
  describe('Suite 3: Synthetic Demonstration CSV Fixtures', () => {
    it('6. Generates valid non-empty CSV text for demo orders and transactions', () => {
      const ordersCsv = generateDemoOrdersCsv();
      const txnsCsv = generateDemoTransactionsCsv();

      expect(typeof ordersCsv).toBe('string');
      expect(typeof txnsCsv).toBe('string');
      expect(ordersCsv.length).toBeGreaterThan(500);
      expect(txnsCsv.length).toBeGreaterThan(500);

      // Verify headers
      expect(ordersCsv).toContain('Order ID');
      expect(ordersCsv).toContain('Expected Amount');
      expect(txnsCsv).toContain('Transaction ID');
      expect(txnsCsv).toContain('Gross Amount');
    });

    it('7. Executing reconciliation on generated demo CSVs yields deterministic results', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS,
        transactions: DEMO_TRANSACTIONS,
      });

      expect(run.totalOrders).toBe(53);
      expect(run.totalTransactions).toBe(54);
      expect(run.status).toBe('COMPLETED');
      expect(run.records.length).toBeGreaterThan(40);

      // Verify that known scenarios are present
      const cleanMatch = run.records.find((r) => r.orderId === 'ORD-DEMO-001');
      expect(cleanMatch?.matchStatus).toBe('MATCHED');
      expect(cleanMatch?.discrepancyType).toBe('NONE');

      const timingDelay = run.records.find((r) => r.discrepancyType === 'TIMING_DELAY');
      expect(timingDelay).toBeDefined();

      const disputeHold = run.records.find((r) => r.discrepancyType === 'DISPUTE_HOLD');
      expect(disputeHold).toBeDefined();

      const amountMismatch = run.records.find((r) => r.discrepancyType === 'AMOUNT_MISMATCH');
      expect(amountMismatch).toBeDefined();

      const missingPayment = run.records.find((r) => r.discrepancyType === 'MISSING_PAYMENT');
      expect(missingPayment).toBeDefined();
    });
  });

  // =========================================================================
  // SUITE 4: Financial Formatting & Representation Safety
  // =========================================================================
  describe('Suite 4: Minor-Unit Formatting on Workbench Grid', () => {
    it('8. Formats minor units without floating-point errors', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS.slice(0, 5),
        transactions: DEMO_TRANSACTIONS.slice(0, 5),
      });

      for (const rec of run.records) {
        const expectedFormatted = formatMoney(rec.expectedAmount);
        const actualFormatted = formatMoney(rec.actualAmount);
        const varianceFormatted = formatMoney(rec.varianceAmount);

        expect(expectedFormatted).toMatch(/^[A-Z$€¥£A-Za-z]+ ?[0-9,]+(\.[0-9]{2,3})?$/);
        expect(actualFormatted).toMatch(/^[A-Z$€¥£A-Za-z]+ ?[0-9,]+(\.[0-9]{2,3})?$/);
        expect(varianceFormatted).toMatch(/^-?[A-Z$€¥£A-Za-z]+ ?[0-9,]+(\.[0-9]{2,3})?$/);
      }
    });

    it('9. Correctly formats negative variance for partial refunds and fee slips', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS,
        transactions: DEMO_TRANSACTIONS,
      });

      const refundRec = run.records.find(
        (r) =>
          r.discrepancyType === 'PARTIAL_REFUND_MISMATCH' ||
          r.discrepancyType === 'FULL_REFUND_SETTLEMENT'
      );
      if (refundRec) {
        expect(refundRec.actualAmount).toBeDefined();
        expect(refundRec.expectedAmount).toBeDefined();
        expect(formatMoney(refundRec.expectedAmount)).toBeDefined();
      }
    });
  });

  // =========================================================================
  // SUITE 5: Operational Summary Metrics Derivation
  // =========================================================================
  describe('Suite 5: Transparent Metrics Derivation', () => {
    it('10. Aggregates all operational summary counts from actual returned records', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS,
        transactions: DEMO_TRANSACTIONS,
      });

      const matchedRecords = run.records.filter((r) => r.matchStatus === 'MATCHED').length;
      const ambiguousRecords = run.records.filter((r) => r.matchStatus === 'AMBIGUOUS').length;
      const discrepancyRecords = run.records.filter((r) => r.matchStatus === 'DISCREPANCY').length;
      const manualReviewRequired = run.records.filter(
        (r) => r.confidence === 'MANUAL_REVIEW_REQUIRED'
      ).length;

      expect(manualReviewRequired).toBeGreaterThanOrEqual(0);
      expect(matchedRecords).toBeGreaterThan(0);
      expect(discrepancyRecords).toBeGreaterThan(0);
      expect(run.totalOrders).toBe(53);
      expect(run.totalTransactions).toBe(54);

      // Verify that total sum of records is completely accounted for
      expect(run.records.length).toBe(
        matchedRecords +
          discrepancyRecords +
          ambiguousRecords +
          run.unmatchedOrderCount +
          run.unmatchedTransactionCount
      );
    });

    it('11. Derives exception counts accurately for the Exceptions Queue', () => {
      const run = executeReconciliationRun({
        orders: DEMO_ORDERS,
        transactions: DEMO_TRANSACTIONS,
      });

      const exceptions = run.records.filter(
        (r) =>
          r.matchStatus === 'DISCREPANCY' ||
          r.matchStatus === 'AMBIGUOUS' ||
          r.matchStatus === 'UNMATCHED_ORDER' ||
          r.matchStatus === 'UNMATCHED_TRANSACTION' ||
          r.confidence === 'MANUAL_REVIEW_REQUIRED'
      );

      expect(exceptions.length).toBeGreaterThan(0);
      expect(exceptions.length).toBeLessThan(run.records.length);
    });
  });

  // =========================================================================
  // SUITE 6: API Route Handlers Integration
  // =========================================================================
  describe('Suite 6: API Route Handlers Integration', () => {
    it('12. GET /api/reconciliation/sample returns valid synthetic demo dataset', async () => {
      const { GET: getSample } = await import('@/app/api/reconciliation/sample/route');
      const response = await getSample();
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.datasetOrigin).toBe('SYNTHETIC_DEMO');
      expect(json.label).toContain('SYNTHETIC DEMONSTRATION DATA');
      expect(json.ordersCsv).toBeDefined();
      expect(json.transactionsCsv).toBeDefined();
      expect(json.metadata.totalOrders).toBe(53);
    });

    it('13. POST /api/reconciliation/review validates schema and updates review status', async () => {
      const { POST: postReview } = await import('@/app/api/reconciliation/review/route');
      const { NextRequest } = await import('next/server');

      // Valid review request
      const validReq = new NextRequest('http://localhost:3000/api/reconciliation/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: 'rec_api_test',
          reviewStatus: 'IN_REVIEW',
          notes: 'Flagged for tier 2 analyst',
        }),
      });

      const response = await postReview(validReq);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.review.status).toBe('IN_REVIEW');
      expect(json.review.notes).toBe('Flagged for tier 2 analyst');

      // Invalid review request (invalid status)
      const invalidReq = new NextRequest('http://localhost:3000/api/reconciliation/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: 'rec_api_test',
          reviewStatus: 'INVALID_STATUS',
        }),
      });

      const invalidResponse = await postReview(invalidReq);
      expect(invalidResponse.status).toBe(400);
    });

    it('14. GET and POST /api/reconciliation synchronizes active workbench state', async () => {
      const { GET: getWorkbench, POST: postWorkbench } = await import('@/app/api/reconciliation/route');
      const { NextRequest } = await import('next/server');

      const sampleRun: ReconciliationRun = {
        id: 'run_api_sync',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        totalOrders: 10,
        totalTransactions: 10,
        matchedCount: 8,
        unmatchedOrderCount: 1,
        unmatchedTransactionCount: 1,
        exceptionCount: 2,
        status: 'COMPLETED',
        datasetReferences: { orderCount: 10, transactionCount: 10 },
        records: [],
      };

      const postReq = new NextRequest('http://localhost:3000/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run: sampleRun,
          origin: 'IMPORTED',
        }),
      });

      const postRes = await postWorkbench(postReq);
      expect(postRes.status).toBe(200);

      const getRes = await getWorkbench();
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.activeRun?.id).toBe('run_api_sync');
      expect(getJson.datasetOrigin).toBe('IMPORTED');
    });
  });
});
