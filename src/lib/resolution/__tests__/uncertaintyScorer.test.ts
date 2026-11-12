import { describe, it, expect } from 'vitest';
import { calculateUncertaintyScore } from '../uncertaintyScorer';
import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';

describe('Phase 3D.3: Explainable Uncertainty Scorer Suite', () => {
  const createMockCase = (overrides?: Partial<ExceptionCaseDetail>): ExceptionCaseDetail => ({
    id: '00000000-0000-4000-8000-000000000001',
    merchantId: 'merchant_test_uncertainty',
    caseKey: 'v1_test_key',
    reconciliationRunId: 'run-1',
    discrepancyType: 'AMOUNT_MISMATCH',
    status: 'OPEN',
    version: 1,
    varianceAmount: { amountMinor: 2500, currency: 'USD', precision: 2 },
    expectedAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
    actualAmount: { amountMinor: 7500, currency: 'USD', precision: 2 },
    currency: 'USD',
    primaryReference: 'ORD-101',
    merchantOrderId: 'ORD-101',
    paypalTransactionId: 'TXN-202',
    notes: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    evidenceCount: 2,
    evidence: [
      {
        id: '00000000-0000-4000-8000-000000000010',
        caseId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'merchant_test_uncertainty',
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: 'ORD-101',
        sourceTransactionId: null,
        reconciliationRunId: 'run-1',
        payloadSnapshot: { orderId: 'ORD-101', grossAmountMinor: 10000 },
        contentHash: 'hash10'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: new Date().toISOString(),
      },
      {
        id: '00000000-0000-4000-8000-000000000020',
        caseId: '00000000-0000-4000-8000-000000000001',
        merchantId: 'merchant_test_uncertainty',
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: 'TXN-202',
        sourceTransactionId: null,
        reconciliationRunId: 'run-1',
        payloadSnapshot: { transactionId: 'TXN-202', amountMinor: 7500 },
        contentHash: 'hash20'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: new Date().toISOString(),
      },
    ],
    ...overrides,
  });

  const createMockInvestigation = (
    confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH'
  ): CaseInvestigationRecord => ({
    id: '00000000-0000-4000-8000-000000000099',
    caseId: '00000000-0000-4000-8000-000000000001',
    merchantId: 'merchant_test_uncertainty',
    caseVersion: 1,
    evidenceFingerprint: 'fprint99',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    promptVersion: '1.0',
    schemaVersion: '1.0',
    status: 'COMPLETED',
    investigationResult: {
      schemaVersion: '1.0',
      caseId: '00000000-0000-4000-8000-000000000001',
      merchantId: 'merchant_test_uncertainty',
      caseVersion: 1,
      investigatedAt: new Date().toISOString(),
      summary: {
        conciseExplanation: 'Clear discrepancy rationale.',
        primaryDiscrepancyCategory: 'AMOUNT_MISMATCH',
        investigationOutcome: 'Identified root cause.',
        criticalUnresolvedQuestions: [],
      },
      establishedFacts: [],
      inferences: [
        {
          inferenceId: 'inf-1',
          explanation: 'Clear inference',
          supportingEvidenceIds: ['00000000-0000-4000-8000-000000000010'],
          contradictingEvidenceIds: [],
          confidenceCategory: confidence,
          confidenceRationale: 'Direct match',
          explicitUncertainty: 'None',
        },
      ],
      missingEvidence: [],
      suggestedSteps: [],
      limitations: { unestablishedItems: [], mandatoryHumanVerificationRequired: ['Verify'] },
      disclaimer: 'Advisory disclaimer',
    },
    createdAt: new Date().toISOString(),
  });

  it('computes LOW uncertainty for complete evidence and confident investigation', () => {
    const res = calculateUncertaintyScore({
      caseDetail: createMockCase(),
      latestInvestigation: createMockInvestigation('HIGH'),
      isEvidenceStale: false,
      isFreshnessUnknown: false,
      hasMultiEntityAmbiguity: false,
      hasAmbiguousAttribution: false,
    });

    expect(res.score).toBeLessThanOrEqual(25);
    expect(res.level).toBe('LOW');
    expect(res.isSuppressedOrDemoted).toBe(false);
  });

  it('elevates uncertainty score when evidence is stale or unknown freshness', () => {
    const resStale = calculateUncertaintyScore({
      caseDetail: createMockCase(),
      latestInvestigation: createMockInvestigation('HIGH'),
      isEvidenceStale: true,
      isFreshnessUnknown: false,
      hasMultiEntityAmbiguity: false,
      hasAmbiguousAttribution: false,
    });

    expect(resStale.score).toBeGreaterThanOrEqual(30);
    expect(resStale.factors.some((f) => f.factor === 'STALE_INVESTIGATION_SNAPSHOT')).toBe(true);
    expect(resStale.isSuppressedOrDemoted).toBe(true);

    const resUnknown = calculateUncertaintyScore({
      caseDetail: createMockCase(),
      latestInvestigation: createMockInvestigation('HIGH'),
      isEvidenceStale: false,
      isFreshnessUnknown: true,
      hasMultiEntityAmbiguity: false,
      hasAmbiguousAttribution: false,
    });

    expect(resUnknown.factors.some((f) => f.factor === 'UNKNOWN_EVIDENCE_FRESHNESS')).toBe(true);
    expect(resUnknown.isSuppressedOrDemoted).toBe(true);
  });

  it('elevates uncertainty when multi-entity document ambiguity is present', () => {
    const res = calculateUncertaintyScore({
      caseDetail: createMockCase(),
      latestInvestigation: createMockInvestigation('HIGH'),
      isEvidenceStale: false,
      isFreshnessUnknown: false,
      hasMultiEntityAmbiguity: true,
      hasAmbiguousAttribution: false,
    });

    expect(res.factors.some((f) => f.factor === 'MULTI_ENTITY_DOCUMENT_AMBIGUITY')).toBe(true);
    expect(res.isSuppressedOrDemoted).toBe(true);
  });

  it('elevates uncertainty when investigation is missing', () => {
    const res = calculateUncertaintyScore({
      caseDetail: createMockCase(),
      latestInvestigation: null,
      isEvidenceStale: false,
      isFreshnessUnknown: false,
      hasMultiEntityAmbiguity: false,
      hasAmbiguousAttribution: false,
    });

    expect(res.factors.some((f) => f.factor === 'MISSING_AI_INVESTIGATION')).toBe(true);
  });

  it('bounds score between 0 and 100 under compounding risk factors', () => {
    const resWorstCase = calculateUncertaintyScore({
      caseDetail: createMockCase({
        merchantOrderId: null,
        paypalTransactionId: null,
        evidence: [],
        evidenceCount: 0,
        varianceAmount: { amountMinor: 9999999, currency: 'USD', precision: 2 },
      }),
      latestInvestigation: null,
      isEvidenceStale: true,
      isFreshnessUnknown: true,
      hasMultiEntityAmbiguity: true,
      hasAmbiguousAttribution: true,
    });

    expect(resWorstCase.score).toBe(100);
    expect(resWorstCase.level).toBe('VERY_HIGH');
    expect(resWorstCase.isSuppressedOrDemoted).toBe(true);
    expect(resWorstCase.factors.length).toBeGreaterThan(4);
  });
});
