import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/reconciliation/preview-persisted/route';
import {
  setupTestDatabase,
  teardownTestDatabase,
} from '@/lib/db/testHarness';
import { createImportRun, finalizeImportRun } from '@/lib/db/repositories/importRunRepository';
import { insertImportedTransaction } from '@/lib/db/repositories/paypalTransactionRepository';

describe('Phase 3C.3B: Persisted PayPal Reconciliation Integration Suite', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const sampleOrdersCsv = `order_id,amount,currency,date
ORD-1001,100.00,USD,2026-11-02T10:00:00Z
ORD-1002,50.00,USD,2026-11-02T11:00:00Z`;

  const validStartDate = '2026-11-01T00:00:00Z';
  const validEndDate = '2026-11-05T00:00:00Z';

  const makeJsonRequest = (body: Record<string, unknown>) => {
    return new NextRequest('http://localhost:3000/api/reconciliation/preview-persisted', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  };

  describe('Suite 1: Merchant Order Mutual Exclusivity & Input Validation (F-14)', () => {
    it('returns 400 MUTUALLY_EXCLUSIVE_INPUTS when both ordersCsv and orders array are supplied', async () => {
      const req = makeJsonRequest({
        startDate: validStartDate,
        endDate: validEndDate,
        ordersCsv: sampleOrdersCsv,
        orders: [
          {
            id: 'ord-1',
            merchantOrderId: 'ORD-1',
            externalReference: 'REF-1',
            expectedAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
            currency: 'USD',
            createdAt: '2026-11-02T10:00:00Z',
            updatedAt: '2026-11-02T10:00:00Z',
            orderStatus: 'CREATED',
            paymentStatus: 'PAID',
            source: 'TEST',
            metadata: {},
          },
        ],
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('MUTUALLY_EXCLUSIVE_INPUTS');
      expect(data.message).toContain("Provide either 'ordersCsv' or 'orders', not both.");
    });

    it('returns 400 MISSING_MERCHANT_ORDERS when neither ordersCsv nor orders array is supplied', async () => {
      const req = makeJsonRequest({
        startDate: validStartDate,
        endDate: validEndDate,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('MISSING_MERCHANT_ORDERS');
    });

    it('returns 400 ORDER_ROW_LIMIT_EXCEEDED when orders array exceeds 5,000 items', async () => {
      const excessiveOrders = Array.from({ length: 5001 }, (_, i) => ({
        id: `ord-${i}`,
        merchantOrderId: `ORD-${i}`,
        externalReference: `REF-${i}`,
        expectedAmount: { amountMinor: 1000, currency: 'USD', precision: 2 },
        currency: 'USD',
        createdAt: '2026-11-02T10:00:00Z',
        updatedAt: '2026-11-02T10:00:00Z',
        orderStatus: 'CREATED',
        paymentStatus: 'PAID',
        source: 'TEST',
        metadata: {},
      }));

      const req = makeJsonRequest({
        startDate: validStartDate,
        endDate: validEndDate,
        orders: excessiveOrders,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('ORDER_ROW_LIMIT_EXCEEDED');
      expect(data.message).toContain('5,001 items');
    });

    it('returns 400 VALIDATION_ERROR when startDate is after endDate', async () => {
      const req = makeJsonRequest({
        startDate: '2026-11-10T00:00:00Z',
        endDate: '2026-11-05T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(data.message).toContain('startDate must be strictly earlier than endDate');
    });

    it('returns 400 VALIDATION_ERROR when date range exceeds 31 days', async () => {
      const req = makeJsonRequest({
        startDate: '2026-10-01T00:00:00Z',
        endDate: '2026-11-15T00:00:00Z', // 45 days
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
      expect(data.message).toContain('cannot exceed 31 days');
    });
  });

  describe('Suite 2: Active & Incomplete Import Intersection Handling (F-13, F-15, F-18A)', () => {
    it('returns 409 IMPORT_RUN_IN_PROGRESS when an active RUNNING import intersects the window', async () => {
      await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.code).toBe('IMPORT_RUN_IN_PROGRESS');
      expect(data.message).toContain('Active PayPal import in progress');
    });

    it('returns 422 INCOMPLETE_IMPORT_INTERSECTION when window contains an unacknowledged PARTIAL run', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run.id, {
        pagesFetched: 1,
        recordsReceived: 10,
        recordsInserted: 10,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'PARTIAL',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.code).toBe('INCOMPLETE_IMPORT_INTERSECTION');
      expect(data.details).toHaveLength(1);
    });

    it('returns 422 INCOMPLETE_IMPORT_INTERSECTION when window contains an unacknowledged COMPLETED_WITH_WARNINGS run (F-18A)', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run.id, {
        pagesFetched: 1,
        recordsReceived: 10,
        recordsInserted: 8,
        recordsAlreadyPresent: 0,
        recordsRejected: 2,
        identityCollisionsDetected: 0,
        importStatus: 'COMPLETED_WITH_WARNINGS',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.code).toBe('INCOMPLETE_IMPORT_INTERSECTION');
    });

    it('succeeds with metadata.isPartial === true when acknowledgedPartial is true for incomplete runs', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run.id, {
        pagesFetched: 1,
        recordsReceived: 5,
        recordsInserted: 5,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'PARTIAL',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
        acknowledgedPartial: true,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.metadata.isPartial).toBe(true);
      expect(data.metadata.partialNotice).toContain('acknowledged incomplete or warning-bearing imports');
      expect(data.metadata.intersectingIncompleteRuns).toHaveLength(1);
    });

    it('succeeds without acknowledgement when an earlier incomplete run is superseded by a clean COMPLETED run covering the window (F-17A, F-18A)', async () => {
      // 1. Earlier incomplete run
      const run1 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run1.id, {
        pagesFetched: 1,
        recordsReceived: 5,
        recordsInserted: 5,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'FAILED',
        safeErrorCode: 'TIMEOUT',
      });

      // 2. Later covering clean COMPLETED run
      const run2 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run2.id, {
        pagesFetched: 2,
        recordsReceived: 20,
        recordsInserted: 20,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'COMPLETED',
        safeErrorCode: undefined,
      });

      // Request without acknowledgedPartial should succeed because run1 is genuinely superseded
      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.metadata.isPartial).toBe(false);
      expect(data.metadata.intersectingIncompleteRuns).toHaveLength(0);
    });

    it('fails when later covering run has COMPLETED_WITH_WARNINGS (cannot supersede earlier incomplete run)', async () => {
      // 1. Earlier failed run
      const run1 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run1.id, {
        pagesFetched: 1,
        recordsReceived: 5,
        recordsInserted: 5,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'FAILED',
      });

      // 2. Later run with warnings
      const run2 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run2.id, {
        pagesFetched: 2,
        recordsReceived: 20,
        recordsInserted: 18,
        recordsAlreadyPresent: 0,
        recordsRejected: 2,
        identityCollisionsDetected: 0,
        importStatus: 'COMPLETED_WITH_WARNINGS',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-02T00:00:00Z',
        endDate: '2026-11-04T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(422);
      expect(data.code).toBe('INCOMPLETE_IMPORT_INTERSECTION');
    });
  });

  describe('Suite 3: End-to-End Persisted Reconciliation & Domain Purity (F-09, F-11)', () => {
    it('executes reconciliation matching persisted transactions, leaving transactionsFileId undefined and returning full metadata envelope', async () => {
      // 1. Create a clean completed import run
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-05T00:00:00Z',
      });
      await finalizeImportRun(run.id, {
        pagesFetched: 1,
        recordsReceived: 2,
        recordsInserted: 2,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'COMPLETED',
      });

      // 2. Insert eligible capture matching ORD-1001
      await insertImportedTransaction({
        paypalTransactionId: 'TXN-CAPTURE-1001',
        fingerprint: 'fp-capture-1001',
        transactionEventCode: 'T0006',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: 10000,
        currency: 'USD',
        currencyPrecision: 2,
        transactionTime: '2026-11-02T10:05:00Z',
        paypalOrderId: 'ORD-1001',
        importRunId: run.id,
        reconciliationEligible: true,
        reconciliationEligibilityStatus: 'ELIGIBLE',
        identityCollisionStatus: 'NONE',
        rawReference: 'raw-ref-1001',
      });

      // 3. Insert eligible capture matching ORD-1002
      await insertImportedTransaction({
        paypalTransactionId: 'TXN-CAPTURE-1002',
        fingerprint: 'fp-capture-1002',
        transactionEventCode: 'T0006',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: 5000,
        currency: 'USD',
        currencyPrecision: 2,
        transactionTime: '2026-11-02T11:05:00Z',
        paypalOrderId: 'ORD-1002',
        importRunId: run.id,
        reconciliationEligible: true,
        reconciliationEligibilityStatus: 'ELIGIBLE',
        identityCollisionStatus: 'NONE',
        rawReference: 'raw-ref-1002',
      });

      const req = makeJsonRequest({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-05T00:00:00Z',
        ordersCsv: sampleOrdersCsv,
      });

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify ReconciliationRun domain purity
      expect(data.run).toBeDefined();
      expect(data.run.matchedCount).toBe(2);
      expect(data.run.totalOrders).toBe(2);
      expect(data.run.totalTransactions).toBe(2);
      expect(data.run.status).toBe('COMPLETED');

      // F-11: transactionsFileId MUST remain undefined for persisted database ledger sourcing
      expect(data.run.datasetReferences.transactionsFileId).toBeUndefined();

      // Outer metadata envelope validation
      expect(data.metadata).toBeDefined();
      expect(data.metadata.datasetOrigin).toBe('PAYPAL_DURABLE_LEDGER');
      expect(data.metadata.startDate).toBe('2026-11-01T00:00:00.000Z');
      expect(data.metadata.endDate).toBe('2026-11-05T00:00:00.000Z');
      expect(data.metadata.totalEligibleCount).toBe(2);
      expect(data.metadata.reconciledTransactionCount).toBe(2);
      expect(data.metadata.adapterRejectedCount).toBe(0);
      expect(data.metadata.ordersSource).toBe('CSV');
      expect(data.metadata.ordersCount).toBe(2);
      expect(data.metadata.isPartial).toBe(false);
    });
  });
});
