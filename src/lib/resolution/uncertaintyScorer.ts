/**
 * CloseLoop Phase 3D.3: Explainable Uncertainty Scorer
 * Deterministic, transparent uncertainty model (0-100) with granular factor attribution.
 * Never treats AI confidence as statistical probability or ground truth.
 */

import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';
import {
  UncertaintyAssessment,
  UncertaintyFactor,
  UncertaintyLevel,
} from './types';

export interface UncertaintyScorerInputs {
  caseDetail: ExceptionCaseDetail;
  latestInvestigation: CaseInvestigationRecord | null;
  isEvidenceStale: boolean;
  isFreshnessUnknown: boolean;
  hasMultiEntityAmbiguity: boolean;
  hasAmbiguousAttribution: boolean;
}

/**
 * Calculates a deterministic uncertainty score between 0 and 100 based on verifiable evidence facts.
 */
export function calculateUncertaintyScore(inputs: UncertaintyScorerInputs): UncertaintyAssessment {
  const {
    caseDetail,
    latestInvestigation,
    isEvidenceStale,
    isFreshnessUnknown,
    hasMultiEntityAmbiguity,
    hasAmbiguousAttribution,
  } = inputs;

  const factors: UncertaintyFactor[] = [];
  let score = 0;

  // 1. Evidence Completeness Assessment
  const evidenceItems = caseDetail.evidence || [];
  const hasOrderEvidence = evidenceItems.some(
    (e) => e.evidenceType === 'MERCHANT_ORDER' || e.sourceRecordId.startsWith('ORD-')
  );
  const hasPaypalEvidence = evidenceItems.some(
    (e) => e.evidenceType === 'PAYPAL_TRANSACTION' || e.sourceRecordId.startsWith('TXN-')
  );

  if (evidenceItems.length === 0) {
    factors.push({
      factor: 'EMPTY_EVIDENCE_GRAPH',
      scoreContribution: 35,
      reason: 'No verified evidence items are attached to this exception case.',
    });
    score += 35;
  } else if (!hasOrderEvidence && !hasPaypalEvidence) {
    factors.push({
      factor: 'INCOMPLETE_CORE_EVIDENCE',
      scoreContribution: 25,
      reason: 'Evidence graph is missing both merchant order and PayPal ledger snapshots.',
    });
    score += 25;
  } else if (!hasOrderEvidence || !hasPaypalEvidence) {
    // Only missing one side (typical for un-matched records)
    factors.push({
      factor: 'UNILATERAL_EVIDENCE',
      scoreContribution: 15,
      reason: 'Evidence graph contains records from only one side of the transaction pair.',
    });
    score += 15;
  }

  // 2. Reference Attribution Integrity
  if (!caseDetail.merchantOrderId && !caseDetail.paypalTransactionId) {
    factors.push({
      factor: 'MISSING_ALL_PRIMARY_REFERENCES',
      scoreContribution: 25,
      reason: 'Neither merchantOrderId nor paypalTransactionId could be resolved for this case.',
    });
    score += 25;
  } else if (!caseDetail.merchantOrderId || !caseDetail.paypalTransactionId) {
    factors.push({
      factor: 'UNPAIRED_REFERENCE',
      scoreContribution: 10,
      reason: 'Case contains an order reference or PayPal reference, but not both.',
    });
    score += 10;
  }

  // 3. Multi-Entity Document-Level Ambiguity (Section 5A)
  if (hasMultiEntityAmbiguity) {
    factors.push({
      factor: 'MULTI_ENTITY_DOCUMENT_AMBIGUITY',
      scoreContribution: 30,
      reason:
        'Evidence payload contains multiple financial entities or pooled amounts; exact attribution requires manual review.',
    });
    score += 30;
  }

  // 4. Ambiguous Attribution (Reconciliation Collisions / Ambiguous Matches)
  if (hasAmbiguousAttribution || caseDetail.discrepancyType === 'AMBIGUOUS_MATCH') {
    factors.push({
      factor: 'AMBIGUOUS_TRANSACTION_ATTRIBUTION',
      scoreContribution: 25,
      reason: 'Reconciliation identified multiple competing candidate transactions for this record.',
    });
    score += 25;
  }

  // 5. Evidence Freshness & Snapshot Staleness (Section 5B)
  if (isEvidenceStale) {
    factors.push({
      factor: 'STALE_INVESTIGATION_SNAPSHOT',
      scoreContribution: 30,
      reason:
        'Investigation snapshot was generated against a prior case version or drifted evidence fingerprint.',
    });
    score += 30;
  } else if (isFreshnessUnknown) {
    factors.push({
      factor: 'UNKNOWN_EVIDENCE_FRESHNESS',
      scoreContribution: 25,
      reason:
        'Current evidence fingerprint cannot be verified against the persisted investigation snapshot.',
    });
    score += 25;
  }

  // 6. Investigation Copilot Assessment
  if (!latestInvestigation) {
    factors.push({
      factor: 'MISSING_AI_INVESTIGATION',
      scoreContribution: 20,
      reason: 'No completed AI investigation has analyzed this case to establish root cause.',
    });
    score += 20;
  } else {
    // Inspect AI inference confidence categories
    const inferences = latestInvestigation.investigationResult?.inferences || [];
    const hasLowConfidenceInference = inferences.some((i) => i.confidenceCategory === 'LOW');
    const hasMediumConfidenceInference = inferences.some((i) => i.confidenceCategory === 'MEDIUM');

    if (hasLowConfidenceInference) {
      factors.push({
        factor: 'LOW_INVESTIGATION_CONFIDENCE',
        scoreContribution: 15,
        reason: 'AI investigation explicitly stated low confidence on one or more root-cause inferences.',
      });
      score += 15;
    } else if (hasMediumConfidenceInference) {
      factors.push({
        factor: 'MODERATE_INVESTIGATION_CONFIDENCE',
        scoreContribution: 5,
        reason: 'AI investigation inferences are qualified with moderate confidence rationale.',
      });
      score += 5;
    }
  }

  // 7. Discrepancy Magnitude
  if (caseDetail.varianceAmount.amountMinor > 50000) {
    // > $500.00
    factors.push({
      factor: 'HIGH_VALUE_VARIANCE',
      scoreContribution: 15,
      reason: `Large variance amount of $${(caseDetail.varianceAmount.amountMinor / 100).toFixed(2)} elevates financial risk.`,
    });
    score += 15;
  }

  // Cap score at 100
  const boundedScore = Math.min(100, Math.max(0, score));

  // Determine Uncertainty Level
  let level: UncertaintyLevel;
  if (boundedScore <= 25) {
    level = 'LOW';
  } else if (boundedScore <= 50) {
    level = 'MODERATE';
  } else if (boundedScore <= 75) {
    level = 'HIGH';
  } else {
    level = 'VERY_HIGH';
  }

  // Safety rule: If uncertainty is high or very high, or evidence is stale/ambiguous, flag suppression/demotion
  const isSuppressedOrDemoted =
    boundedScore >= 50 || isEvidenceStale || isFreshnessUnknown || hasMultiEntityAmbiguity;

  let suppressionReason: string | undefined;
  if (isSuppressedOrDemoted) {
    if (isEvidenceStale) {
      suppressionReason = 'Stale evidence snapshot requires operator verification before action.';
    } else if (hasMultiEntityAmbiguity) {
      suppressionReason = 'Multi-entity document payload requires human verification of line-item amounts.';
    } else if (boundedScore >= 75) {
      suppressionReason = 'Very high uncertainty suppresses automated resolution in favor of manual review.';
    } else {
      suppressionReason = 'Elevated uncertainty requires mandatory operator verification.';
    }
  }

  return {
    score: boundedScore,
    level,
    factors,
    isSuppressedOrDemoted,
    suppressionReason,
  };
}
