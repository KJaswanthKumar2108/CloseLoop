import { describe, it, expect } from 'vitest';
import {
  inspectMultiEntityAmbiguity,
  evaluateEvidenceFreshness,
  evaluateActionEligibility,
} from '../evaluator';
import { RESOLUTION_ACTION_CATALOG } from '../catalog';
import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';

describe('Phase 3D.3: Preconditions & Contraindications Evaluator Suite', () => {
  const createBaseCase = (): ExceptionCaseDetail => ({
    id: '00000000-0000-4000-8000-000000000001',
    merchantId: 'merchant_eval_test',
    caseKey: 'v1_eval_key',
    reconciliationRunId: 'run-1',
    discrepancyType: 'TIMING_DELAY',
    status: 'OPEN',
    version: 1,
    varianceAmount: { amountMinor: 0, currency: 'USD', precision: 2 },
    expectedAmount: { amountMinor: 5000, currency: 'USD', precision: 2 },
    actualAmount: { amountMinor: 5000, currency: 'USD', precision: 2 },
    currency: 'USD',
    primaryReference: 'TXN-SETTLE-1',
    merchantOrderId: 'ORD-SETTLE-1',
    paypalTransactionId: 'TXN-SETTLE-1',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidenceCount: 1,
    evidence: [
      {
        id: '00000000-0000-4000-8000-000000000055',
        caseId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'merchant_eval_test',
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: 'TXN-SETTLE-1',
        sourceTransactionId: null,
        reconciliationRunId: 'run-1',
        payloadSnapshot: {
          transactionId: 'TXN-SETTLE-1',
          transactionStatus: 'PENDING',
          timestamp: new Date().toISOString(),
        },
        contentHash: 'hash55'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: new Date().toISOString(),
      },
    ],
  });

  describe('Section 5A: Multi-Entity Document Ambiguity Inspection', () => {
    it('detects no ambiguity in clean single-entity evidence', () => {
      const c = createBaseCase();
      const res = inspectMultiEntityAmbiguity(c);
      expect(res.hasMultiEntityAmbiguity).toBe(false);
      expect(res.ambiguousEvidenceIds).toHaveLength(0);
    });

    it('detects ambiguity when payload contains multiple transactions array', () => {
      const c = createBaseCase();
      c.evidence[0].payloadSnapshot = {
        batchId: 'BATCH-1',
        transactions: [
          { id: 'TXN-A', amount: 100 },
          { id: 'TXN-B', amount: 200 },
        ],
      };
      const res = inspectMultiEntityAmbiguity(c);
      expect(res.hasMultiEntityAmbiguity).toBe(true);
      expect(res.ambiguousEvidenceIds).toContain(c.evidence[0].id);
    });

    it('detects ambiguity when payload contains multiple transaction ID keys', () => {
      const c = createBaseCase();
      c.evidence[0].payloadSnapshot = {
        transactionId: 'TXN-A',
        capture_id: 'CAPTURE-B',
        amountMinor: 5000,
      };
      const res = inspectMultiEntityAmbiguity(c);
      expect(res.hasMultiEntityAmbiguity).toBe(true);
    });
  });

  describe('Section 5B: Evidence Freshness Evaluation', () => {
    it('confirms fresh evidence when fingerprints and versions match', () => {
      const c = createBaseCase();
      const fprint = computeEvidenceFingerprint(c.id, c.version, c.evidence);
      const mockInv: CaseInvestigationRecord = {
        id: 'inv-1',
        caseId: c.id,
        merchantId: c.merchantId,
        caseVersion: 1,
        evidenceFingerprint: fprint,
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptVersion: '1.0',
        schemaVersion: '1.0',
        status: 'COMPLETED',
        investigationResult: null,
        createdAt: new Date().toISOString(),
      };

      const res = evaluateEvidenceFreshness(c, mockInv);
      expect(res.isEvidenceStale).toBe(false);
      expect(res.isFreshnessUnknown).toBe(false);
      expect(res.currentFingerprint).toBe(fprint);
    });

    it('detects stale evidence when case version has progressed', () => {
      const c = createBaseCase();
      c.version = 2; // case progressed
      const mockInv: CaseInvestigationRecord = {
        id: 'inv-1',
        caseId: c.id,
        merchantId: c.merchantId,
        caseVersion: 1,
        evidenceFingerprint: 'fprint-old',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptVersion: '1.0',
        schemaVersion: '1.0',
        status: 'COMPLETED',
        investigationResult: null,
        createdAt: new Date().toISOString(),
      };

      const res = evaluateEvidenceFreshness(c, mockInv);
      expect(res.isEvidenceStale).toBe(true);
      expect(res.freshnessReason).toContain('Case version progressed');
    });

    it('detects stale evidence when evidence content has changed without version increment', () => {
      const c = createBaseCase();
      const mockInv: CaseInvestigationRecord = {
        id: 'inv-1',
        caseId: c.id,
        merchantId: c.merchantId,
        caseVersion: 1,
        evidenceFingerprint: 'fprint-different',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        promptVersion: '1.0',
        schemaVersion: '1.0',
        status: 'COMPLETED',
        investigationResult: null,
        createdAt: new Date().toISOString(),
      };

      const res = evaluateEvidenceFreshness(c, mockInv);
      expect(res.isEvidenceStale).toBe(true);
      expect(res.freshnessReason).toContain('Live evidence items or content hashes differ');
    });
  });

  describe('Preconditions and Contraindications Enforcement', () => {
    it('WAIT_FOR_SETTLEMENT is eligible for recent pending transactions in TIMING_DELAY', () => {
      const c = createBaseCase();
      const freshness = { isEvidenceStale: false, isFreshnessUnknown: false, currentFingerprint: 'fp', investigationFingerprint: 'fp' };
      const multi = { hasMultiEntityAmbiguity: false, ambiguousEvidenceIds: [] };

      const res = evaluateActionEligibility(
        RESOLUTION_ACTION_CATALOG.WAIT_FOR_SETTLEMENT,
        c,
        null,
        freshness,
        multi
      );

      expect(res.isEligible).toBe(true);
      expect(res.activeContraindications).toHaveLength(0);
    });

    it('WAIT_FOR_SETTLEMENT is contraindicated when transaction status is FAILED or DENIED', () => {
      const c = createBaseCase();
      c.evidence[0].payloadSnapshot.transactionStatus = 'FAILED';
      const freshness = { isEvidenceStale: false, isFreshnessUnknown: false, currentFingerprint: 'fp', investigationFingerprint: 'fp' };
      const multi = { hasMultiEntityAmbiguity: false, ambiguousEvidenceIds: [] };

      const res = evaluateActionEligibility(
        RESOLUTION_ACTION_CATALOG.WAIT_FOR_SETTLEMENT,
        c,
        null,
        freshness,
        multi
      );

      expect(res.isEligible).toBe(false);
      expect(res.activeContraindications).toContain(
        'Transaction status is terminal (FAILED, VOIDED, DENIED).'
      );
    });

    it('INVESTIGATE_AMOUNT_VARIANCE is contraindicated when variance is zero', () => {
      const c = createBaseCase();
      c.discrepancyType = 'AMOUNT_MISMATCH';
      c.varianceAmount.amountMinor = 0; // Zero variance!
      const freshness = { isEvidenceStale: false, isFreshnessUnknown: false, currentFingerprint: 'fp', investigationFingerprint: 'fp' };
      const multi = { hasMultiEntityAmbiguity: false, ambiguousEvidenceIds: [] };

      const res = evaluateActionEligibility(
        RESOLUTION_ACTION_CATALOG.INVESTIGATE_AMOUNT_VARIANCE,
        c,
        null,
        freshness,
        multi
      );

      expect(res.isEligible).toBe(false);
      expect(res.activeContraindications).toContain('Variance amount is zero (varianceAmountMinor === 0).');
    });
  });
});
