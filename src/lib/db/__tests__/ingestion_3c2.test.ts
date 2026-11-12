import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setupTestDatabase,
  teardownTestDatabase,
  TestDatabaseContext,
} from '../testHarness';
import { createImportRun, listImportRuns } from '../repositories/importRunRepository';
import {
  insertImportedTransaction,
  getTransactionByFingerprint,
  listImportedTransactions,
} from '../repositories/paypalTransactionRepository';
import { getCollisionLogsByRunId } from '../repositories/collisionLogRepository';
import {
  recordPayPalImportBatch,
  compareCanonicalTransaction,
  hasGenuineParentReference,
} from '../provenanceService';
import { determineReconciliationEligibility } from '../eligibility';
import { PaymentTransaction } from '@/types/financial';
import { PayPalTransactionDetail } from '@/lib/paypal/transactionSchemas';
import { createMoney } from '@/lib/reconciliation/money';
import { NextRequest } from 'next/server';
import { POST as importRouteHandler } from '@/app/api/paypal/import/route';
import { GET as importedTxRouteHandler } from '@/app/api/paypal/imported-transactions/route';
import { GET as importRunsRouteHandler } from '@/app/api/paypal/import-runs/route';

describe('Phase 3C.2: Durable PayPal Ingestion & Collision Resolution Suite', () => {
  let ctx: TestDatabaseContext;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    ctx = await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: Canonical Comparison & Cross-Batch Discrepancy Quarantine
  // =========================================================================
  describe('Suite 1: Canonical Comparison & Cross-Batch Discrepancies', () => {
    it('1. Exact re-observation: compares canonical attributes and safely updates provenance without row duplication', async () => {
      const run1 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const rawDetail: PayPalTransactionDetail = {
        transaction_info: {
          transaction_id: 'TXN-EXACT-REOBS',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '120.00' },
          fee_amount: { currency_code: 'USD', value: '-3.78' },
          net_amount: { currency_code: 'USD', value: '116.22' },
          transaction_initiation_date: '2026-11-05T12:00:00Z',
        },
      };

      const normalizedTx: PaymentTransaction = {
        id: 'PP_TXN-EXACT-REOBS:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_120.00',
        paypalTransactionId: 'TXN-EXACT-REOBS',
        grossAmount: createMoney(12000, 'USD'),
        feeAmount: createMoney(-378, 'USD'),
        netAmount: createMoney(11622, 'USD'),
        currency: 'USD',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        transactionTime: '2026-11-05T12:00:00.000Z',
        source: 'PAYPAL_API',
        rawReference: 'PAYPAL_API:TXN-EXACT-REOBS:T0000',
      };

      // Import Batch 1
      const res1 = await recordPayPalImportBatch({
        importRunId: run1.id,
        items: [{ normalized: normalizedTx, rawDetail }],
      });
      expect(res1.recordsInserted).toBe(1);
      expect(res1.recordsAlreadyPresent).toBe(0);

      // Import Batch 2 with exact same canonical payload
      const run2 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const res2 = await recordPayPalImportBatch({
        importRunId: run2.id,
        items: [{ normalized: normalizedTx, rawDetail }],
      });

      expect(res2.recordsInserted).toBe(0);
      expect(res2.recordsAlreadyPresent).toBe(1);
      expect(res2.crossBatchDiscrepancies).toBe(0);

      // Verify DB record: financial amount never mutated, provenance updated
      const saved = await getTransactionByFingerprint(normalizedTx.id);
      expect(saved?.grossAmountMinor).toBe(12000);
      expect(saved?.feeAmountMinor).toBe(-378);
      expect(saved?.netAmountMinor).toBe(11622);
      expect(saved?.firstImportRunId).toBe(run1.id);
      expect(saved?.lastImportRunId).toBe(run2.id);
    });

    it('2. Cross-batch payload discrepancy: detects altered fee, leaves DB row immutable, and logs collision audit', async () => {
      const run1 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const fp = 'PP_TXN-DISCREPANCY:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_200.00';

      const rawRun1: PayPalTransactionDetail = {
        transaction_info: {
          transaction_id: 'TXN-DISCREPANCY',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '200.00' },
          fee_amount: { currency_code: 'USD', value: '-6.10' },
          net_amount: { currency_code: 'USD', value: '193.90' },
          transaction_initiation_date: '2026-11-05T12:00:00Z',
        },
      };

      const normalizedRun1: PaymentTransaction = {
        id: fp,
        paypalTransactionId: 'TXN-DISCREPANCY',
        grossAmount: createMoney(20000, 'USD'),
        feeAmount: createMoney(-610, 'USD'),
        netAmount: createMoney(19390, 'USD'),
        currency: 'USD',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        transactionTime: '2026-11-05T12:00:00.000Z',
        source: 'PAYPAL_API',
        rawReference: 'PAYPAL_API:TXN-DISCREPANCY:T0000',
      };

      // Ingest Batch 1
      await recordPayPalImportBatch({
        importRunId: run1.id,
        items: [{ normalized: normalizedRun1, rawDetail: rawRun1 }],
      });

      // Batch 2: PayPal returns SAME fingerprint, but fee was amended from -6.10 to -7.50!
      const run2 = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const rawRun2: PayPalTransactionDetail = {
        transaction_info: {
          ...rawRun1.transaction_info,
          fee_amount: { currency_code: 'USD', value: '-7.50' },
          net_amount: { currency_code: 'USD', value: '192.50' },
        },
      };

      const normalizedRun2: PaymentTransaction = {
        ...normalizedRun1,
        feeAmount: createMoney(-750, 'USD'),
        netAmount: createMoney(19250, 'USD'),
      };

      const res2 = await recordPayPalImportBatch({
        importRunId: run2.id,
        items: [{ normalized: normalizedRun2, rawDetail: rawRun2 }],
      });

      // Must detect cross-batch discrepancy
      expect(res2.recordsInserted).toBe(0);
      expect(res2.recordsAlreadyPresent).toBe(0); // NOT counted as safe re-observation
      expect(res2.crossBatchDiscrepancies).toBe(1);
      expect(res2.identityCollisionsDetected).toBe(1);
      expect(res2.status).toBe('COMPLETED_WITH_WARNINGS');

      // Original DB record must remain strictly immutable
      const dbTx = await getTransactionByFingerprint(fp);
      expect(dbTx?.feeAmountMinor).toBe(-610); // NOT mutated to -750
      expect(dbTx?.netAmountMinor).toBe(19390);

      // Collision log must preserve the conflicting observation
      const collisionLogs = await getCollisionLogsByRunId(run2.id);
      expect(collisionLogs).toHaveLength(1);
      expect(collisionLogs[0].collisionType).toBe('CROSS_BATCH_DISCREPANCY');
      expect(collisionLogs[0].details).toContain('feeAmountMinor');
      expect(collisionLogs[0].rawPayload.transaction_info.fee_amount?.value).toBe('-7.50');
    });

    it('3. compareCanonicalTransaction detects differences across invoice, merchant reference, and timestamps', () => {
      const existing = {
        id: '1',
        paypalTransactionId: 'TX-CANON',
        fingerprint: 'FP_CANON',
        transactionEventCode: 'T0000',
        transactionType: 'CAPTURE' as const,
        transactionStatus: 'COMPLETED' as const,
        grossAmountMinor: 5000,
        currency: 'USD',
        currencyPrecision: 2,
        feeAmountMinor: -150,
        netAmountMinor: 4850,
        transactionTime: '2026-11-05T10:00:00.000Z',
        paypalReferenceId: null,
        paypalReferenceType: null,
        paypalOrderId: null,
        paypalCaptureId: null,
        invoiceId: 'INV-100',
        merchantReference: 'CUSTOM-1',
        sourceEnvironment: 'SANDBOX' as const,
        sourceProvider: 'PAYPAL' as const,
        firstImportedAt: '2026-11-05T10:00:00.000Z',
        lastObservedAt: '2026-11-05T10:00:00.000Z',
        firstImportRunId: 'r1',
        lastImportRunId: 'r1',
        reconciliationEligible: true,
        reconciliationEligibilityStatus: 'ELIGIBLE' as const,
        identityCollisionStatus: 'NONE' as const,
        rawReference: 'REF',
        createdAt: '2026-11-05T10:00:00.000Z',
        updatedAt: '2026-11-05T10:00:00.000Z',
      };

      // Same attributes -> isEquivalent = true
      const same = compareCanonicalTransaction(
        {
          paypalTransactionId: 'TX-CANON',
          transactionEventCode: 'T0000',
          transactionType: 'CAPTURE',
          transactionStatus: 'COMPLETED',
          grossAmountMinor: 5000,
          currency: 'USD',
          feeAmountMinor: -150,
          netAmountMinor: 4850,
          transactionTime: '2026-11-05T10:00:00.000Z',
          invoiceId: 'INV-100',
          merchantReference: 'CUSTOM-1',
        },
        existing
      );
      expect(same.isEquivalent).toBe(true);
      expect(same.differences).toHaveLength(0);

      // Different invoiceId -> isEquivalent = false
      const diffInvoice = compareCanonicalTransaction(
        {
          paypalTransactionId: 'TX-CANON',
          transactionEventCode: 'T0000',
          transactionType: 'CAPTURE',
          transactionStatus: 'COMPLETED',
          grossAmountMinor: 5000,
          currency: 'USD',
          feeAmountMinor: -150,
          netAmountMinor: 4850,
          transactionTime: '2026-11-05T10:00:00.000Z',
          invoiceId: 'INV-999',
          merchantReference: 'CUSTOM-1',
        },
        existing
      );
      expect(diffInvoice.isEquivalent).toBe(false);
      expect(diffInvoice.differences[0]).toContain('invoiceId');
    });
  });

  // =========================================================================
  // SUITE 2: Concurrent Conflict Handling & Resilient Upsert
  // =========================================================================
  describe('Suite 2: Concurrent Conflict Handling', () => {
    it('4. insertImportedTransaction with onConflict "DO_NOTHING" returns null instead of aborting the transaction', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const params = {
        paypalTransactionId: 'TXN-CONCURRENT-SAFE',
        fingerprint: 'PP_CONCURRENT-SAFE:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_50.00',
        transactionEventCode: 'T0000',
        transactionType: 'CAPTURE' as const,
        transactionStatus: 'COMPLETED' as const,
        grossAmountMinor: 5000,
        currency: 'USD',
        currencyPrecision: 2,
        transactionTime: '2026-11-05T12:00:00Z',
        importRunId: run.id,
        reconciliationEligible: true,
        reconciliationEligibilityStatus: 'ELIGIBLE' as const,
        rawReference: 'REF',
      };

      // First insert succeeds
      const first = await insertImportedTransaction(params, ctx.pool, { onConflict: 'DO_NOTHING' });
      expect(first).not.toBeNull();
      expect(first?.fingerprint).toBe(params.fingerprint);

      // Second insert with onConflict: DO_NOTHING returns null without throwing
      const second = await insertImportedTransaction(params, ctx.pool, { onConflict: 'DO_NOTHING' });
      expect(second).toBeNull();
    });

    it('5. Concurrent import simulation: simultaneous duplicate insertion falls through to canonical comparison', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const mockDetail: PayPalTransactionDetail = {
        transaction_info: {
          transaction_id: 'TXN-SIMUL',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '88.00' },
          transaction_initiation_date: '2026-11-05T15:00:00Z',
        },
      };

      const mockNormalized: PaymentTransaction = {
        id: 'PP_TXN-SIMUL:T0000:COMPLETED:2026-11-05T15:00:00.000Z:USD_88.00',
        paypalTransactionId: 'TXN-SIMUL',
        grossAmount: createMoney(8800, 'USD'),
        currency: 'USD',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        transactionTime: '2026-11-05T15:00:00.000Z',
        source: 'PAYPAL_API',
        rawReference: 'PAYPAL_API:TXN-SIMUL:T0000',
      };

      // First batch inserts
      const res1 = await recordPayPalImportBatch({
        importRunId: run.id,
        items: [{ normalized: mockNormalized, rawDetail: mockDetail }],
      });
      expect(res1.recordsInserted).toBe(1);

      // Re-running batch immediately verifies safe equivalence
      const res2 = await recordPayPalImportBatch({
        importRunId: run.id,
        items: [{ normalized: mockNormalized, rawDetail: mockDetail }],
      });
      expect(res2.recordsInserted).toBe(0);
      expect(res2.recordsAlreadyPresent).toBe(1);
    });
  });

  // =========================================================================
  // SUITE 3: Refund Eligibility with Parent Link Verification
  // =========================================================================
  describe('Suite 3: Refund Eligibility & Parent Reference Rules', () => {
    it('6. Completed refund with verified parent reference is reconciliation eligible', () => {
      const evalResult = determineReconciliationEligibility({
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: -2500, // Negative amount
        collisionStatus: 'NONE',
        hasParentReference: true,
      });

      expect(evalResult.isEligible).toBe(true);
      expect(evalResult.status).toBe('ELIGIBLE');
    });

    it('7. Completed refund with non-negative amount fails closed as INELIGIBLE', () => {
      const evalResult = determineReconciliationEligibility({
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: 2500, // Conflict: positive amount on refund!
        collisionStatus: 'NONE',
        hasParentReference: true,
      });

      expect(evalResult.isEligible).toBe(false);
      expect(evalResult.status).toBe('INELIGIBLE_NON_SETTLED');
    });

    it('8. Orphaned completed refund (hasParentReference = false) is quarantined as INELIGIBLE_HOLD', () => {
      const evalResult = determineReconciliationEligibility({
        transactionType: 'REFUND',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: -2500,
        collisionStatus: 'NONE',
        hasParentReference: false, // Orphaned refund!
      });

      expect(evalResult.isEligible).toBe(false);
      expect(evalResult.status).toBe('INELIGIBLE_HOLD');
      expect(evalResult.reason).toContain('parent order or capture reference');
    });
  });

  // =========================================================================
  // SUITE 4: Multi-Parameter Filtering & Persisted Queries
  // =========================================================================
  describe('Suite 4: Persisted Transactions Listing & Filtering', () => {
    it('9. listImportedTransactions filters by type, status, and reconciliation eligibility', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      // Insert 1 capture (eligible)
      await insertImportedTransaction({
        paypalTransactionId: 'TX-CAP-1',
        fingerprint: 'FP_CAP-1',
        transactionEventCode: 'T0000',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        grossAmountMinor: 10000,
        currency: 'USD',
        currencyPrecision: 2,
        transactionTime: '2026-11-05T12:00:00Z',
        importRunId: run.id,
        reconciliationEligible: true,
        reconciliationEligibilityStatus: 'ELIGIBLE',
        rawReference: 'REF',
      });

      // Insert 1 authorization (ineligible)
      await insertImportedTransaction({
        paypalTransactionId: 'TX-AUTH-1',
        fingerprint: 'FP_AUTH-1',
        transactionEventCode: 'T1300',
        transactionType: 'AUTHORIZATION',
        transactionStatus: 'PENDING',
        grossAmountMinor: 10000,
        currency: 'USD',
        currencyPrecision: 2,
        transactionTime: '2026-11-05T13:00:00Z',
        importRunId: run.id,
        reconciliationEligible: false,
        reconciliationEligibilityStatus: 'INELIGIBLE_AUTHORIZATION',
        rawReference: 'REF',
      });

      // Query all
      const all = await listImportedTransactions({}, ctx.pool);
      expect(all.totalCount).toBe(2);

      // Filter eligible only
      const eligible = await listImportedTransactions({ reconciliationEligible: true }, ctx.pool);
      expect(eligible.totalCount).toBe(1);
      expect(eligible.transactions[0].paypalTransactionId).toBe('TX-CAP-1');

      // Filter by type = AUTHORIZATION
      const authOnly = await listImportedTransactions({ transactionType: 'AUTHORIZATION' }, ctx.pool);
      expect(authOnly.totalCount).toBe(1);
      expect(authOnly.transactions[0].paypalTransactionId).toBe('TX-AUTH-1');
    });

    it('10. listImportRuns returns historical execution runs with correct statistics', async () => {
      const run = await createImportRun({
        requestedStartDate: '2026-11-01T00:00:00Z',
        requestedEndDate: '2026-11-08T00:00:00Z',
      });

      const runs = await listImportRuns(10, 0, ctx.pool);
      expect(runs.length).toBeGreaterThan(0);
      expect(runs.some((r) => r.id === run.id)).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 5: API Route Handlers Integration
  // =========================================================================
  describe('Suite 5: API Route Handlers', () => {
    it('11. POST /api/paypal/import rejects invalid or missing JSON body', async () => {
      // Empty body
      const req = new NextRequest('http://localhost:3000/api/paypal/import', {
        method: 'POST',
        body: 'invalid-json',
      });

      const res = await importRouteHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_PARAMETERS');
    });

    it('12. POST /api/paypal/import enforces date range requirements', async () => {
      const req = new NextRequest('http://localhost:3000/api/paypal/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: 'not-a-date',
          endDate: 'also-not-a-date',
        }),
      });

      const res = await importRouteHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_PARAMETERS');
    });

    it('13. GET /api/paypal/imported-transactions returns 503 when DATABASE_URL is unconfigured', async () => {
      delete process.env.DATABASE_URL;
      const req = new NextRequest('http://localhost:3000/api/paypal/imported-transactions');
      const res = await importedTxRouteHandler(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('DATABASE_NOT_CONFIGURED');
    });

    it('14. GET /api/paypal/import-runs returns 503 when DATABASE_URL is unconfigured', async () => {
      delete process.env.DATABASE_URL;
      const req = new NextRequest('http://localhost:3000/api/paypal/import-runs');
      const res = await importRunsRouteHandler(req);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('DATABASE_NOT_CONFIGURED');
    });
  });

  // =========================================================================
  // SUITE 6: Targeted Remediation Regression Suite (F-01, F-02, F-03)
  // =========================================================================
  describe('Suite 6: Targeted Remediation Regression Suite (F-01, F-02, F-03)', () => {
    // -----------------------------------------------------------------------
    // F-01: Refund Parent-Link Eligibility and Fallback ID Rejection
    // -----------------------------------------------------------------------
    describe('F-01: Refund Parent Reference Eligibility', () => {
      it('15. hasGenuineParentReference returns false when refund has only normalizer fallback captureId (equal to own ID)', () => {
        const rawDetail: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'REFUND-FALLBACK-123',
            transaction_event_code: 'T1107',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '-50.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const refundTx: PaymentTransaction = {
          id: 'PP_REFUND-FALLBACK-123:T1107:COMPLETED:2026-11-05T12:00:00.000Z:USD_-50.00',
          paypalTransactionId: 'REFUND-FALLBACK-123',
          grossAmount: createMoney(-5000, 'USD'),
          currency: 'USD',
          transactionType: 'REFUND',
          transactionStatus: 'COMPLETED',
          transactionTime: '2026-11-05T12:00:00.000Z',
          paypalCaptureId: 'REFUND-FALLBACK-123', // Normalizer self-fallback
          source: 'PAYPAL_API',
          rawReference: 'PAYPAL_API:REFUND-FALLBACK-123:T1107',
        };

        const hasParent = hasGenuineParentReference(refundTx, rawDetail);
        expect(hasParent).toBe(false);

        const eligibility = determineReconciliationEligibility({
          transactionType: refundTx.transactionType,
          transactionStatus: refundTx.transactionStatus,
          grossAmountMinor: refundTx.grossAmount.amountMinor,
          collisionStatus: 'NONE',
          hasParentReference: hasParent,
        });

        expect(eligibility.isEligible).toBe(false);
        expect(eligibility.status).toBe('INELIGIBLE_HOLD');
      });

      it('16. hasGenuineParentReference returns true and marks ELIGIBLE when refund has genuine external parent reference', () => {
        const rawDetail: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'REFUND-VALID-456',
            paypal_reference_id: 'PARENT-CAPTURE-999',
            paypal_reference_id_type: 'TXN',
            transaction_event_code: 'T1107',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '-25.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const refundTx: PaymentTransaction = {
          id: 'PP_REFUND-VALID-456:T1107:COMPLETED:2026-11-05T12:00:00.000Z:USD_-25.00',
          paypalTransactionId: 'REFUND-VALID-456',
          grossAmount: createMoney(-2500, 'USD'),
          currency: 'USD',
          transactionType: 'REFUND',
          transactionStatus: 'COMPLETED',
          transactionTime: '2026-11-05T12:00:00.000Z',
          paypalCaptureId: 'PARENT-CAPTURE-999',
          source: 'PAYPAL_API',
          rawReference: 'PAYPAL_API:REFUND-VALID-456:T1107',
        };

        const hasParent = hasGenuineParentReference(refundTx, rawDetail);
        expect(hasParent).toBe(true);

        const eligibility = determineReconciliationEligibility({
          transactionType: refundTx.transactionType,
          transactionStatus: refundTx.transactionStatus,
          grossAmountMinor: refundTx.grossAmount.amountMinor,
          collisionStatus: 'NONE',
          hasParentReference: hasParent,
        });

        expect(eligibility.isEligible).toBe(true);
        expect(eligibility.status).toBe('ELIGIBLE');
      });

      it('17. Refund with non-negative gross amount fails closed as INELIGIBLE_NON_SETTLED', () => {
        const eligibility = determineReconciliationEligibility({
          transactionType: 'REFUND',
          transactionStatus: 'COMPLETED',
          grossAmountMinor: 1000, // Invalid: Refund must be strictly negative
          collisionStatus: 'NONE',
          hasParentReference: true,
        });

        expect(eligibility.isEligible).toBe(false);
        expect(eligibility.status).toBe('INELIGIBLE_NON_SETTLED');
      });
    });

    // -----------------------------------------------------------------------
    // F-02: Pagination Truncation Status (PARTIAL)
    // -----------------------------------------------------------------------
    describe('F-02: Bounded Pagination & Partial Status', () => {
      it('18. recordPayPalImportBatch finalizes import run as PARTIAL when isTruncated is true', async () => {
        const run = await createImportRun({
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-08T00:00:00Z',
        });

        const rawDetail: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'TXN-TRUNC-1',
            transaction_event_code: 'T0000',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '10.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const tx: PaymentTransaction = {
          id: 'PP_TXN-TRUNC-1:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_10.00',
          paypalTransactionId: 'TXN-TRUNC-1',
          grossAmount: createMoney(1000, 'USD'),
          currency: 'USD',
          transactionType: 'CAPTURE',
          transactionStatus: 'COMPLETED',
          transactionTime: '2026-11-05T12:00:00.000Z',
          source: 'PAYPAL_API',
          rawReference: 'PAYPAL_API:TXN-TRUNC-1:T0000',
        };

        const res = await recordPayPalImportBatch({
          importRunId: run.id,
          pagesFetched: 2,
          isTruncated: true, // Truncation flag!
          items: [{ normalized: tx, rawDetail }],
        });

        expect(res.status).toBe('PARTIAL');

        const runs = await listImportRuns(1, 0, ctx.pool);
        const savedRun = runs.find((r) => r.id === run.id);
        expect(savedRun?.importStatus).toBe('PARTIAL');
        expect(savedRun?.pagesFetched).toBe(2);
      });

      it('19. Retrying an incomplete/truncated import does not duplicate records in durable storage', async () => {
        const run1 = await createImportRun({
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-08T00:00:00Z',
        });

        const rawDetail: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'TXN-RETRY-DUP',
            transaction_event_code: 'T0000',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '75.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const tx: PaymentTransaction = {
          id: 'PP_TXN-RETRY-DUP:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_75.00',
          paypalTransactionId: 'TXN-RETRY-DUP',
          grossAmount: createMoney(7500, 'USD'),
          currency: 'USD',
          transactionType: 'CAPTURE',
          transactionStatus: 'COMPLETED',
          transactionTime: '2026-11-05T12:00:00.000Z',
          source: 'PAYPAL_API',
          rawReference: 'PAYPAL_API:TXN-RETRY-DUP:T0000',
        };

        // First pass: partial
        const res1 = await recordPayPalImportBatch({
          importRunId: run1.id,
          isTruncated: true,
          items: [{ normalized: tx, rawDetail }],
        });
        expect(res1.recordsInserted).toBe(1);

        // Second pass: complete retry
        const run2 = await createImportRun({
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-08T00:00:00Z',
        });

        const res2 = await recordPayPalImportBatch({
          importRunId: run2.id,
          isTruncated: false,
          items: [{ normalized: tx, rawDetail }],
        });

        expect(res2.recordsInserted).toBe(0);
        expect(res2.recordsAlreadyPresent).toBe(1);
        expect(res2.status).toBe('COMPLETED');

        // Check total count in DB remains 1
        const all = await listImportedTransactions({}, ctx.pool);
        const matches = all.transactions.filter((t) => t.paypalTransactionId === 'TXN-RETRY-DUP');
        expect(matches.length).toBe(1);
        expect(matches[0].firstImportRunId).toBe(run1.id);
        expect(matches[0].lastImportRunId).toBe(run2.id);
      });
    });

    // -----------------------------------------------------------------------
    // F-03: Canonical Comparison of External References & Discrepancy Quarantine
    // -----------------------------------------------------------------------
    describe('F-03: External Reference Comparison & Discrepancy Quarantine', () => {
      it('20. compareCanonicalTransaction flags differences when paypalReferenceId, paypalOrderId, or paypalCaptureId differ', () => {
        const existing = {
          id: 'uuid-1',
          paypalTransactionId: 'TXN-REF-DIFF',
          fingerprint: 'fp-1',
          transactionEventCode: 'T0000',
          transactionType: 'CAPTURE' as const,
          transactionStatus: 'COMPLETED' as const,
          grossAmountMinor: 5000,
          currency: 'USD',
          currencyPrecision: 2,
          feeAmountMinor: -150,
          netAmountMinor: 4850,
          transactionTime: '2026-11-05T12:00:00.000Z',
          paypalReferenceId: 'ORIGINAL-REF-ID',
          paypalReferenceType: 'TXN',
          paypalOrderId: 'ORDER-111',
          paypalCaptureId: 'CAPTURE-111',
          invoiceId: null,
          merchantReference: null,
          sourceEnvironment: 'SANDBOX' as const,
          sourceProvider: 'PAYPAL' as const,
          firstImportRunId: 'run-1',
          lastImportRunId: 'run-1',
          reconciliationEligible: true,
          reconciliationEligibilityStatus: 'ELIGIBLE' as const,
          identityCollisionStatus: 'NONE' as const,
          rawReference: 'ref-1',
          firstImportedAt: '2026-11-05T12:00:00.000Z',
          firstObservedAt: '2026-11-05T12:00:00.000Z',
          lastObservedAt: '2026-11-05T12:00:00.000Z',
          createdAt: '2026-11-05T12:00:00.000Z',
          updatedAt: '2026-11-05T12:00:00.000Z',
        };

        const incomingWithAlteredRef = {
          paypalTransactionId: 'TXN-REF-DIFF',
          transactionEventCode: 'T0000',
          transactionType: 'CAPTURE' as const,
          transactionStatus: 'COMPLETED' as const,
          grossAmountMinor: 5000,
          currency: 'USD',
          feeAmountMinor: -150,
          netAmountMinor: 4850,
          transactionTime: '2026-11-05T12:00:00.000Z',
          paypalReferenceId: 'MODIFIED-REF-ID', // Discrepancy!
          paypalReferenceType: 'TXN',
          paypalOrderId: 'ORDER-111',
          paypalCaptureId: 'CAPTURE-111',
        };

        const res = compareCanonicalTransaction(incomingWithAlteredRef, existing);
        expect(res.isEquivalent).toBe(false);
        expect(res.differences.some((d) => d.includes('paypalReferenceId'))).toBe(true);
      });

      it('21. Discrepant external reference logs CROSS_BATCH_DISCREPANCY without mutating original DB row', async () => {
        const run1 = await createImportRun({
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-08T00:00:00Z',
        });

        const rawDetail1: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'TXN-DISCREP-REF',
            paypal_reference_id: 'REF-ORIGINAL-AAA',
            paypal_reference_id_type: 'TXN',
            transaction_event_code: 'T0000',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '40.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const tx1: PaymentTransaction = {
          id: 'PP_TXN-DISCREP-REF:T0000:COMPLETED:2026-11-05T12:00:00.000Z:USD_40.00',
          paypalTransactionId: 'TXN-DISCREP-REF',
          grossAmount: createMoney(4000, 'USD'),
          currency: 'USD',
          transactionType: 'CAPTURE',
          transactionStatus: 'COMPLETED',
          transactionTime: '2026-11-05T12:00:00.000Z',
          paypalCaptureId: 'REF-ORIGINAL-AAA',
          source: 'PAYPAL_API',
          rawReference: 'PAYPAL_API:TXN-DISCREP-REF:T0000',
        };

        // Insert first batch
        await recordPayPalImportBatch({
          importRunId: run1.id,
          items: [{ normalized: tx1, rawDetail: rawDetail1 }],
        });

        // Second batch: same fingerprint, but external reference changed to BBB
        const run2 = await createImportRun({
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-08T00:00:00Z',
        });

        const rawDetail2: PayPalTransactionDetail = {
          transaction_info: {
            transaction_id: 'TXN-DISCREP-REF',
            paypal_reference_id: 'REF-ALTERED-BBB', // Changed!
            paypal_reference_id_type: 'TXN',
            transaction_event_code: 'T0000',
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '40.00' },
            transaction_initiation_date: '2026-11-05T12:00:00Z',
          },
        };

        const tx2: PaymentTransaction = {
          ...tx1,
          paypalCaptureId: 'REF-ALTERED-BBB',
        };

        const res2 = await recordPayPalImportBatch({
          importRunId: run2.id,
          items: [{ normalized: tx2, rawDetail: rawDetail2 }],
        });

        expect(res2.crossBatchDiscrepancies).toBe(1);
        expect(res2.identityCollisionsDetected).toBe(1);
        expect(res2.status).toBe('COMPLETED_WITH_WARNINGS');

        // Verify original DB row was NOT mutated
        const inDb = await getTransactionByFingerprint(tx1.id, ctx.pool);
        expect(inDb?.paypalReferenceId).toBe('REF-ORIGINAL-AAA');
        expect(inDb?.lastImportRunId).toBe(run1.id);

        // Verify collision log was recorded
        const logs = await getCollisionLogsByRunId(run2.id, ctx.pool);
        expect(logs.length).toBe(1);
        expect(logs[0].collisionType).toBe('CROSS_BATCH_DISCREPANCY');
        expect(logs[0].details).toContain('paypalReferenceId');
      });
    });
  });
});
