import { describe, it, expect } from 'vitest';
import { generateCaseRecommendations } from '../recommendationEngine';
import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import { MANDATORY_RESOLUTION_DISCLAIMER } from '../types';

describe('Phase 3D.3: Deterministic Recommendation Engine Suite', () => {
  const buildCaseWithDiscrepancy = (
    discrepancyType: string,
    varianceMinor: number = 2500,
    expectedMinor: number = 10000,
    actualMinor: number = 7500
  ): ExceptionCaseDetail => ({
    id: '00000000-0000-4000-8000-000000000001',
    merchantId: 'merchant_engine_test',
    caseKey: `v1_key_${discrepancyType.toLowerCase()}`,
    reconciliationRunId: 'run-1',
    discrepancyType,
    status: 'OPEN',
    version: 1,
    varianceAmount: { amountMinor: varianceMinor, currency: 'USD', precision: 2 },
    expectedAmount: { amountMinor: expectedMinor, currency: 'USD', precision: 2 },
    actualAmount: { amountMinor: actualMinor, currency: 'USD', precision: 2 },
    currency: 'USD',
    primaryReference: 'REF-101',
    merchantOrderId: 'ORD-101',
    paypalTransactionId: 'TXN-101',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidenceCount: 2,
    evidence: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        caseId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'merchant_engine_test',
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: 'ORD-101',
        sourceTransactionId: null,
        reconciliationRunId: 'run-1',
        payloadSnapshot: { orderId: 'ORD-101', amountMinor: expectedMinor },
        contentHash: 'hash11'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: new Date().toISOString(),
      },
      {
        id: '00000000-0000-4000-8000-000000000022',
        caseId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'merchant_engine_test',
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: 'TXN-101',
        sourceTransactionId: null,
        reconciliationRunId: 'run-1',
        payloadSnapshot: { transactionId: 'TXN-101', amountMinor: actualMinor },
        contentHash: 'hash22'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: new Date().toISOString(),
      },
    ],
  });

  const buildMockInvestigation = (c: ExceptionCaseDetail): CaseInvestigationRecord => ({
    id: '00000000-0000-4000-8000-000000000099',
    caseId: c.id,
    merchantId: c.merchantId,
    caseVersion: c.version,
    evidenceFingerprint: computeEvidenceFingerprint(c.id, c.version, c.evidence),
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    promptVersion: '1.0',
    schemaVersion: '1.0',
    status: 'COMPLETED',
    investigationResult: {
      schemaVersion: '1.0',
      caseId: c.id,
      merchantId: c.merchantId,
      caseVersion: c.version,
      investigatedAt: new Date().toISOString(),
      summary: {
        conciseExplanation: 'Clear explanation of discrepancy.',
        primaryDiscrepancyCategory: c.discrepancyType,
        investigationOutcome: 'Root cause verified.',
        criticalUnresolvedQuestions: [],
      },
      establishedFacts: [],
      inferences: [
        {
          inferenceId: 'inf-1',
          explanation: 'Valid root cause inference.',
          supportingEvidenceIds: ['00000000-0000-4000-8000-000000000011'],
          contradictingEvidenceIds: [],
          confidenceCategory: 'HIGH',
          confidenceRationale: 'Direct evidence match.',
          explicitUncertainty: 'None.',
        },
      ],
      missingEvidence: [],
      suggestedSteps: [],
      limitations: { unestablishedItems: [], mandatoryHumanVerificationRequired: ['Confirm facts'] },
      disclaimer: 'Advisory disclaimer',
    },
    createdAt: new Date().toISOString(),
  });

  it('selects INVESTIGATE_AMOUNT_VARIANCE for AMOUNT_MISMATCH with non-zero variance', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH', 2500, 10000, 7500);
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(result.recommendations[0].actionId).toBe('INVESTIGATE_AMOUNT_VARIANCE');
    expect(result.recommendations[0].isPrimary).toBe(true);
    expect(result.recommendations[0].visualState).toBe('RECOMMENDED');
  });

  it('selects REVIEW_REFUND_STATUS for PARTIAL_REFUND_MISMATCH', () => {
    const c = buildCaseWithDiscrepancy('PARTIAL_REFUND_MISMATCH', 2500, 10000, 7500);
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].actionId).toBe('REVIEW_REFUND_STATUS');
    expect(result.recommendations[0].isPrimary).toBe(true);
  });

  it('selects WAIT_FOR_SETTLEMENT for TIMING_DELAY', () => {
    const c = buildCaseWithDiscrepancy('TIMING_DELAY', 0, 5000, 5000);
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].actionId).toBe('WAIT_FOR_SETTLEMENT');
    expect(result.recommendations[0].riskLevel).toBe('LOW');
  });

  it('selects VERIFY_PAYMENT_REFERENCE for CONFLICTING_REFERENCES', () => {
    const c = buildCaseWithDiscrepancy('CONFLICTING_REFERENCES', 0, 5000, 5000);
    c.paypalTransactionId = null; // missing ref
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].actionId).toBe('VERIFY_PAYMENT_REFERENCE');
  });

  it('selects REQUEST_MERCHANT_DOCUMENTATION for MISSING_ORDER_IN_MERCHANT', () => {
    const c = buildCaseWithDiscrepancy('MISSING_ORDER_IN_MERCHANT', 5000, 0, 5000);
    c.merchantOrderId = null;
    c.evidence = [c.evidence[1]]; // Only PayPal evidence exists
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].actionId).toBe('REQUEST_MERCHANT_DOCUMENTATION');
  });

  it('selects REVIEW_DUPLICATE_PAYMENT for DUPLICATE_PAYMENT', () => {
    const c = buildCaseWithDiscrepancy('DUPLICATE_PAYMENT', 0, 5000, 10000);
    // Add second PayPal transaction
    c.evidence.push({
      ...c.evidence[1],
      id: '00000000-0000-4000-8000-000000000033',
      sourceRecordId: 'TXN-DUPLICATE-2',
    });
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].actionId).toBe('REVIEW_DUPLICATE_PAYMENT');
    expect(result.recommendations[0].riskLevel).toBe('HIGH');
  });

  it('handles stale investigation by elevating uncertainty and flagging EVIDENCE_STALE', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH');
    c.version = 2; // version progressed
    const inv = buildMockInvestigation(c);
    inv.caseVersion = 1; // old investigation

    const result = generateCaseRecommendations(c, inv);
    expect(result.isEvidenceStale).toBe(true);
    expect(result.recommendations[0].visualState).toBe('EVIDENCE_STALE');
    expect(result.recommendations[0].actionId).toBe('REVIEW_CASE_EVIDENCE');
  });

  it('handles multi-entity evidence ambiguity by demoting automated claims and flagging MANUAL_REVIEW_REQUIRED', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH');
    c.evidence[1].payloadSnapshot = {
      batchId: 'BATCH-MULTI',
      transactions: [{ id: 'TXN-A', amount: 50 }, { id: 'TXN-B', amount: 25 }],
    };
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].visualState).toBe('MANUAL_REVIEW_REQUIRED');
    expect(result.recommendations[0].actionId).toBe('REVIEW_CASE_EVIDENCE');
    expect(result.recommendations[0].missingInformation).toContain(
      'Line-item breakdown for multi-entity evidence document'
    );
  });

  it('handles missing investigation cleanly without failing', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH');
    const result = generateCaseRecommendations(c, null);

    expect(result.hasInvestigation).toBe(false);
    expect(result.investigationStatus).toBeNull();
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].uncertainty.factors.some((f) => f.factor === 'MISSING_AI_INVESTIGATION')).toBe(true);
  });

  it('strictly preserves supporting evidence IDs', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH');
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.recommendations[0].supportingEvidenceIds).toEqual([
      '00000000-0000-4000-8000-000000000011',
      '00000000-0000-4000-8000-000000000022',
    ]);
  });

  it('includes mandatory advisory disclaimer and performs zero financial mutations', () => {
    const c = buildCaseWithDiscrepancy('AMOUNT_MISMATCH');
    const inv = buildMockInvestigation(c);
    const result = generateCaseRecommendations(c, inv);

    expect(result.disclaimer).toBe(MANDATORY_RESOLUTION_DISCLAIMER);
    expect(result.recommendations[0].disclaimer).toBe(MANDATORY_RESOLUTION_DISCLAIMER);
    expect(result.recommendations[0].requiresHumanReview).toBe(true);
  });
});
