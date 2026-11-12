/**
 * CloseLoop Phase 3D.3: Deterministic Resolution Recommendation Engine
 * Combines verified exception cases, immutable evidence graphs, and AI investigation hypotheses
 * into actionable, explainable recommendations for merchant operators.
 *
 * Deterministic engine is the sole authority for action eligibility and risk levels.
 * AI cannot invent action IDs, override preconditions, or execute financial mutations.
 */

import crypto from 'crypto';
import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';
import {
  EvaluatedRecommendation,
  CaseRecommendationsResult,
  RecommendationVisualState,
  MANDATORY_RESOLUTION_DISCLAIMER,
} from './types';
import { RESOLUTION_ACTION_CATALOG, getAllActionCatalogEntries } from './catalog';
import {
  inspectMultiEntityAmbiguity,
  evaluateEvidenceFreshness,
  evaluateActionEligibility,
} from './evaluator';
import { calculateUncertaintyScore } from './uncertaintyScorer';
import { CaseRecommendationsResultSchema } from './schemas';

/**
 * Generates an operator-readable explanation for a specific eligible recommendation.
 */
function buildOperatorExplanation(
  actionId: string,
  caseDetail: ExceptionCaseDetail,
  latestInvestigation: CaseInvestigationRecord | null,
  discrepancyType: string,
  preconditionsSatisfied: string[],
  uncertaintyScore: number
): string {
  const varianceFormatted = `$${(caseDetail.varianceAmount.amountMinor / 100).toFixed(2)} ${caseDetail.currency}`;
  const invSummary = latestInvestigation?.investigationResult?.summary?.conciseExplanation;

  switch (actionId) {
    case 'VERIFY_PAYMENT_REFERENCE':
      return `Exception reflects an unlinked or ambiguous reference for primary identifier '${caseDetail.primaryReference}'. ` +
        `Reconciliation requires cross-referencing merchant order ID and PayPal transaction ID before settlement. ` +
        (invSummary ? `Investigation finding: ${invSummary}` : 'Verify payment metadata in merchant OMS.');

    case 'WAIT_FOR_SETTLEMENT':
      return `Transaction appears to be processing within normal PayPal batch clearing intervals. ` +
        `Current status indicates a settlement timing delay rather than a permanent loss of funds. ` +
        `Allow the standard 24–72h clearing window to elapse before initiating manual intervention.`;

    case 'REQUEST_MERCHANT_DOCUMENTATION':
      return `A PayPal capture was recorded in ledger without a corresponding merchant order or customer receipt. ` +
        `Request supporting invoice or fulfillment documentation from merchant OMS to confirm order legitimacy.`;

    case 'REVIEW_REFUND_STATUS':
      return `Discrepancy of ${varianceFormatted} matches refund activity or net settlement deduction. ` +
        `Review the PayPal dispute and refund history to verify whether an authorized partial or full refund explains the balance.`;

    case 'INVESTIGATE_AMOUNT_VARIANCE':
      return `Observed variance of ${varianceFormatted} between expected order total and actual PayPal capture. ` +
        (invSummary ? `Investigation finding: ${invSummary}. ` : '') +
        `Inspect itemized checkout charges, merchant processing fee schedules, or sales tax calculations to resolve difference.`;

    case 'REVIEW_DUPLICATE_PAYMENT':
      return `Multiple PayPal captures or collision records were identified for reference '${caseDetail.primaryReference}'. ` +
        `Investigate potential duplicate customer charges before taking any refund action to prevent inadvertent underpayment.`;

    case 'REVIEW_CASE_EVIDENCE':
      return `Supporting evidence graph requires operator review due to ${
        preconditionsSatisfied.length > 0 ? preconditionsSatisfied.join('; ') : 'stale or incomplete investigation analysis'
      }. Verify live transaction facts before determining next steps.`;

    case 'ESCALATE_FOR_MANUAL_REVIEW':
    default:
      return `Exception complexity (uncertainty score: ${uncertaintyScore}/100) or high dollar variance (${varianceFormatted}) ` +
        `warrants escalation to a senior financial controller for manual ledger adjustment and review.`;
  }
}

/**
 * Determines the visual state badge for a recommendation based on uncertainty and evidence freshness.
 */
function resolveVisualState(
  isPrimary: boolean,
  uncertaintyScore: number,
  isEvidenceStale: boolean,
  hasMultiEntityAmbiguity: boolean
): RecommendationVisualState {
  if (isEvidenceStale) {
    return 'EVIDENCE_STALE';
  }
  if (hasMultiEntityAmbiguity) {
    return 'MANUAL_REVIEW_REQUIRED';
  }
  if (uncertaintyScore >= 75) {
    return 'HIGH_UNCERTAINTY';
  }
  if (uncertaintyScore >= 50) {
    return 'REQUIRES_VERIFICATION';
  }
  return isPrimary ? 'RECOMMENDED' : 'REQUIRES_VERIFICATION';
}

/**
 * Main deterministic recommendation engine.
 * Generates ranked, validated, and explainable recommendations for a payment exception case.
 */
export function generateCaseRecommendations(
  caseDetail: ExceptionCaseDetail,
  latestInvestigation: CaseInvestigationRecord | null
): CaseRecommendationsResult {
  // 1. Inspect Section 5A Multi-Entity Ambiguity
  const multiEntity = inspectMultiEntityAmbiguity(caseDetail);

  // 2. Inspect Section 5B Evidence Freshness & Fingerprint Drift
  const freshness = evaluateEvidenceFreshness(caseDetail, latestInvestigation);

  // 3. Calculate Explainable Uncertainty Score (0-100)
  const uncertainty = calculateUncertaintyScore({
    caseDetail,
    latestInvestigation,
    isEvidenceStale: freshness.isEvidenceStale,
    isFreshnessUnknown: freshness.isFreshnessUnknown,
    hasMultiEntityAmbiguity: multiEntity.hasMultiEntityAmbiguity,
    hasAmbiguousAttribution: caseDetail.discrepancyType === 'AMBIGUOUS_MATCH',
  });

  // 4. Evaluate Eligibility across all Action Catalog Entries
  const allActions = getAllActionCatalogEntries();
  const eligibleActions = allActions.map((action) => ({
    entry: action,
    evaluation: evaluateActionEligibility(
      action,
      caseDetail,
      latestInvestigation,
      freshness,
      multiEntity
    ),
  })).filter((a) => a.evaluation.isEligible);

  // If no action is eligible through specific rules, fallback to ESCALATE_FOR_MANUAL_REVIEW or REVIEW_CASE_EVIDENCE
  if (eligibleActions.length === 0) {
    const fallbackId = freshness.isEvidenceStale || !latestInvestigation
      ? 'REVIEW_CASE_EVIDENCE'
      : 'ESCALATE_FOR_MANUAL_REVIEW';
    const fallbackEntry = RESOLUTION_ACTION_CATALOG[fallbackId];
    eligibleActions.push({
      entry: fallbackEntry,
      evaluation: {
        actionId: fallbackId,
        isEligible: true,
        preconditionsSatisfied: ['Universal fallback selected because specific action preconditions were not met.'],
        unmetPreconditions: [],
        contraindicationsChecked: ['Verified standard operational rules did not yield clean single-path recommendation.'],
        activeContraindications: [],
        missingEvidenceTypes: [],
      },
    });
  }

  // 5. Rank Eligible Recommendations
  // Priority order:
  // - If multi-entity ambiguity or stale evidence: prioritize REVIEW_CASE_EVIDENCE / ESCALATE_FOR_MANUAL_REVIEW
  // - Otherwise: prioritize specific discrepancy resolutions matching the case category
  const getDiscrepancyAffinity = (actionId: string, disc: string): number => {
    const d = disc.toUpperCase();
    if (multiEntity.hasMultiEntityAmbiguity || freshness.isEvidenceStale) {
      if (actionId === 'REVIEW_CASE_EVIDENCE') return 200;
      if (actionId === 'ESCALATE_FOR_MANUAL_REVIEW') return 150;
    }
    if (d === 'AMOUNT_MISMATCH' || d === 'FEE_VARIANCE' || d === 'CURRENCY_MISMATCH' || d === 'MULTI_CAPTURE_VARIANCE') {
      if (actionId === 'INVESTIGATE_AMOUNT_VARIANCE') return 100;
    }
    if (d === 'PARTIAL_REFUND_MISMATCH' || d === 'FULL_REFUND_SETTLEMENT') {
      if (actionId === 'REVIEW_REFUND_STATUS') return 100;
    }
    if (d === 'TIMING_DELAY' || d === 'UNEXPECTED_STATUS') {
      if (actionId === 'WAIT_FOR_SETTLEMENT') return 100;
    }
    if (d === 'CONFLICTING_REFERENCES' || d === 'MISSING_METADATA') {
      if (actionId === 'VERIFY_PAYMENT_REFERENCE') return 100;
    }
    if (d === 'MISSING_ORDER_IN_MERCHANT' || d === 'UNMATCHED_TRANSACTION') {
      if (actionId === 'REQUEST_MERCHANT_DOCUMENTATION') return 100;
    }
    if (d === 'DUPLICATE_PAYMENT' || d === 'COLLISION_RECORD') {
      if (actionId === 'REVIEW_DUPLICATE_PAYMENT') return 100;
    }
    if (actionId === 'ESCALATE_FOR_MANUAL_REVIEW') return 10;
    if (actionId === 'REVIEW_CASE_EVIDENCE') return 5;
    return 50;
  };

  eligibleActions.sort((a, b) => {
    const affinityA = getDiscrepancyAffinity(a.entry.actionId, caseDetail.discrepancyType);
    const affinityB = getDiscrepancyAffinity(b.entry.actionId, caseDetail.discrepancyType);
    return affinityB - affinityA;
  });

  // Collect supporting evidence IDs across case
  const supportingEvidenceIds = (caseDetail.evidence || []).map((e) => e.id);

  // 6. Build Evaluated Recommendations
  const evaluatedRecommendations: EvaluatedRecommendation[] = eligibleActions.map((item, index) => {
    const isPrimary = index === 0;
    const action = item.entry;
    const evalResult = item.evaluation;

    // Deterministic UUID for recommendation
    const idSeed = `${caseDetail.id}:${action.actionId}:${caseDetail.version}:${index}`;
    const recId = crypto.createHash('sha256').update(idSeed).digest('hex').slice(0, 32);

    const explanation = buildOperatorExplanation(
      action.actionId,
      caseDetail,
      latestInvestigation,
      caseDetail.discrepancyType,
      evalResult.preconditionsSatisfied,
      uncertainty.score
    );

    const visualState = resolveVisualState(
      isPrimary,
      uncertainty.score,
      freshness.isEvidenceStale,
      multiEntity.hasMultiEntityAmbiguity
    );

    const missingInformation: string[] = [];
    if (!caseDetail.merchantOrderId) missingInformation.push('Merchant Order ID');
    if (!caseDetail.paypalTransactionId) missingInformation.push('PayPal Transaction ID');
    if (evalResult.missingEvidenceTypes.length > 0) {
      missingInformation.push(...evalResult.missingEvidenceTypes);
    }
    if (multiEntity.hasMultiEntityAmbiguity) {
      missingInformation.push('Line-item breakdown for multi-entity evidence document');
    }

    return {
      id: recId,
      caseId: caseDetail.id,
      merchantId: caseDetail.merchantId,
      caseVersion: caseDetail.version,
      evidenceFingerprint: freshness.currentFingerprint,
      actionId: action.actionId,
      title: action.title,
      description: action.description,
      explanation,
      preconditionsSatisfied: evalResult.preconditionsSatisfied,
      contraindicationsChecked: evalResult.contraindicationsChecked,
      missingInformation,
      supportingEvidenceIds,
      uncertainty,
      riskLevel: action.riskLevel,
      requiresHumanReview: true, // Always true for financial safety
      isPrimary,
      visualState,
      createdAt: new Date().toISOString(),
      disclaimer: MANDATORY_RESOLUTION_DISCLAIMER,
    };
  });

  const result: CaseRecommendationsResult = {
    caseId: caseDetail.id,
    merchantId: caseDetail.merchantId,
    caseVersion: caseDetail.version,
    evidenceFingerprint: freshness.currentFingerprint,
    isEvidenceStale: freshness.isEvidenceStale,
    hasInvestigation: Boolean(latestInvestigation),
    investigationStatus: latestInvestigation ? latestInvestigation.status : null,
    recommendations: evaluatedRecommendations,
    evaluatedAt: new Date().toISOString(),
    disclaimer: MANDATORY_RESOLUTION_DISCLAIMER,
  };

  // Validate output against Zod schema to guarantee contract compliance
  return CaseRecommendationsResultSchema.parse(result);
}
