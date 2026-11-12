/**
 * CloseLoop Phase 3D.3: Preconditions & Contraindications Evaluator
 * Deterministic rules engine evaluating evidence integrity, preconditions, and contraindications.
 */

import { ExceptionCaseDetail } from '@/lib/exceptions/types';
import { CaseInvestigationRecord } from '@/lib/ai/investigationRepository';
import { ActionCatalogEntry } from './types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';

export interface MultiEntityInspectionResult {
  hasMultiEntityAmbiguity: boolean;
  ambiguityReason?: string;
  ambiguousEvidenceIds: string[];
}

export interface FreshnessEvaluationResult {
  isEvidenceStale: boolean;
  isFreshnessUnknown: boolean;
  currentFingerprint: string | null;
  investigationFingerprint: string | null;
  freshnessReason?: string;
}

export interface ActionEligibilityResult {
  actionId: string;
  isEligible: boolean;
  preconditionsSatisfied: string[];
  unmetPreconditions: string[];
  contraindicationsChecked: string[];
  activeContraindications: string[];
  missingEvidenceTypes: string[];
  disqualificationReason?: string;
}

/**
 * Section 5A: Inspects evidence items for multi-entity document-level payload ambiguity.
 */
export function inspectMultiEntityAmbiguity(
  caseDetail: ExceptionCaseDetail
): MultiEntityInspectionResult {
  const ambiguousIds: string[] = [];
  let reason: string | undefined;

  for (const item of caseDetail.evidence || []) {
    const payload = item.payloadSnapshot;
    if (!payload || typeof payload !== 'object') continue;

    // Check 1: Explicit array of transactions/captures/refunds inside payload
    if (
      (Array.isArray(payload.transactions) && payload.transactions.length > 1) ||
      (Array.isArray(payload.captures) && payload.captures.length > 1) ||
      (Array.isArray(payload.refunds) && payload.refunds.length > 1) ||
      (Array.isArray(payload.items) && payload.items.length > 1)
    ) {
      ambiguousIds.push(item.id);
      reason = `Evidence item '${item.id}' (${item.evidenceType}) contains multiple transaction/sub-entity objects in payload.`;
      break;
    }

    // Check 2: Payload contains multiple distinct transaction identifiers
    const keys = Object.keys(payload);
    const txnIdKeys = keys.filter(
      (k) =>
        /(transaction_?id|txn_?id|capture_?id)/i.test(k) &&
        typeof payload[k] === 'string' &&
        payload[k].trim() !== ''
    );
    if (txnIdKeys.length > 1) {
      ambiguousIds.push(item.id);
      reason = `Evidence item '${item.id}' contains multiple transaction references [${txnIdKeys.join(', ')}] in a single payload.`;
      break;
    }
  }

  return {
    hasMultiEntityAmbiguity: ambiguousIds.length > 0,
    ambiguityReason: reason,
    ambiguousEvidenceIds: ambiguousIds,
  };
}

/**
 * Section 5B: Evaluates evidence freshness comparing live fingerprint with investigation snapshot.
 */
export function evaluateEvidenceFreshness(
  caseDetail: ExceptionCaseDetail,
  latestInvestigation: CaseInvestigationRecord | null
): FreshnessEvaluationResult {
  let currentFingerprint: string | null = null;
  try {
    currentFingerprint = computeEvidenceFingerprint(
      caseDetail.id,
      caseDetail.version,
      caseDetail.evidence || []
    );
  } catch {
    currentFingerprint = null;
  }

  if (!latestInvestigation) {
    return {
      isEvidenceStale: false,
      isFreshnessUnknown: false,
      currentFingerprint,
      investigationFingerprint: null,
      freshnessReason: 'No prior investigation has been performed on this case.',
    };
  }

  const investigationFingerprint = latestInvestigation.evidenceFingerprint;

  if (!currentFingerprint || !investigationFingerprint) {
    return {
      isEvidenceStale: true,
      isFreshnessUnknown: true,
      currentFingerprint,
      investigationFingerprint,
      freshnessReason: 'Evidence fingerprint is missing or cannot be deterministically computed.',
    };
  }

  // Check version drift
  if (latestInvestigation.caseVersion !== caseDetail.version) {
    return {
      isEvidenceStale: true,
      isFreshnessUnknown: false,
      currentFingerprint,
      investigationFingerprint,
      freshnessReason: `Case version progressed from v${latestInvestigation.caseVersion} to v${caseDetail.version} since investigation was persisted.`,
    };
  }

  // Check fingerprint drift
  if (currentFingerprint !== investigationFingerprint) {
    return {
      isEvidenceStale: true,
      isFreshnessUnknown: false,
      currentFingerprint,
      investigationFingerprint,
      freshnessReason:
        'Live evidence items or content hashes differ from the snapshot analyzed during investigation.',
    };
  }

  // Check if investigation was already marked stale at persistence
  if (latestInvestigation.isStale || latestInvestigation.status === 'STALE_SNAPSHOT') {
    return {
      isEvidenceStale: true,
      isFreshnessUnknown: false,
      currentFingerprint,
      investigationFingerprint,
      freshnessReason: 'Investigation record was marked stale during persistence.',
    };
  }

  return {
    isEvidenceStale: false,
    isFreshnessUnknown: false,
    currentFingerprint,
    investigationFingerprint,
  };
}

/**
 * Evaluates whether an action catalog entry is eligible for a given case and evidence context.
 */
export function evaluateActionEligibility(
  action: ActionCatalogEntry,
  caseDetail: ExceptionCaseDetail,
  latestInvestigation: CaseInvestigationRecord | null,
  freshness: FreshnessEvaluationResult,
  multiEntity: MultiEntityInspectionResult
): ActionEligibilityResult {
  const preconditionsSatisfied: string[] = [];
  const unmetPreconditions: string[] = [];
  const contraindicationsChecked: string[] = [];
  const activeContraindications: string[] = [];
  const missingEvidenceTypes: string[] = [];

  const evidenceItems = caseDetail.evidence || [];
  const availableEvidenceTypes = new Set(evidenceItems.map((e) => e.evidenceType));

  // 1. Evidence Type Requirements
  for (const reqType of action.requiredEvidenceTypes) {
    if (!availableEvidenceTypes.has(reqType)) {
      missingEvidenceTypes.push(reqType);
    }
  }

  // 2. Discrepancy Category Support
  const discrepancy = (caseDetail.discrepancyType || '').toUpperCase();
  const isCategorySupported =
    action.supportedDiscrepancies.includes('*') ||
    action.supportedDiscrepancies.some((d) => d.toUpperCase() === discrepancy);

  if (!isCategorySupported) {
    unmetPreconditions.push(
      `Discrepancy '${discrepancy}' is not among supported categories [${action.supportedDiscrepancies.join(', ')}]`
    );
  }

  // 3. Action-Specific Precondition & Contraindication Rules
  switch (action.actionId) {
    case 'VERIFY_PAYMENT_REFERENCE': {
      const hasMissingOrConflictingRef =
        !caseDetail.merchantOrderId ||
        !caseDetail.paypalTransactionId ||
        discrepancy === 'CONFLICTING_REFERENCES' ||
        discrepancy === 'MISSING_METADATA';

      if (hasMissingOrConflictingRef) {
        preconditionsSatisfied.push('Case contains missing, ambiguous, or conflicting reference identifiers.');
      } else {
        unmetPreconditions.push('Both merchantOrderId and paypalTransactionId are cleanly populated.');
      }

      const hasEvidenceToCrossCheck = evidenceItems.length > 0;
      if (hasEvidenceToCrossCheck) {
        preconditionsSatisfied.push('At least one evidence item is available for cross-referencing.');
      } else {
        unmetPreconditions.push('No evidence items available to cross-reference.');
      }

      // Contraindication: Both references are clean and matching verified
      if (caseDetail.merchantOrderId && caseDetail.paypalTransactionId && discrepancy === 'NONE') {
        activeContraindications.push('Both order and transaction references are authoritatively verified.');
      } else {
        contraindicationsChecked.push('Confirmed reference ambiguity remains active.');
      }
      break;
    }

    case 'WAIT_FOR_SETTLEMENT': {
      const isSettlementDiscrepancy =
        discrepancy === 'TIMING_DELAY' ||
        discrepancy === 'UNEXPECTED_STATUS' ||
        discrepancy === 'MISSING_PAYMENT';

      if (isSettlementDiscrepancy) {
        preconditionsSatisfied.push('Exception involves settlement timing or clearing interval.');
      } else {
        unmetPreconditions.push(`Discrepancy '${discrepancy}' is not a settlement timing delay.`);
      }

      // Check transaction age
      const paypalEvidence = evidenceItems.find(
        (e) => e.evidenceType === 'PAYPAL_TRANSACTION' || e.sourceRecordId.startsWith('TXN-')
      );
      let isWithinWindow = true;
      let isTerminalStatus = false;

      if (paypalEvidence) {
        const capturedAtStr =
          (paypalEvidence.payloadSnapshot?.timestamp as string) ||
          (paypalEvidence.payloadSnapshot?.capturedAt as string) ||
          paypalEvidence.capturedAt;
        if (capturedAtStr) {
          const ageHours = (Date.now() - new Date(capturedAtStr).getTime()) / (1000 * 60 * 60);
          if (ageHours > 7 * 24) {
            isWithinWindow = false;
          }
        }
        const status = String(
          paypalEvidence.payloadSnapshot?.transactionStatus ||
            paypalEvidence.payloadSnapshot?.status ||
            ''
        ).toUpperCase();
        if (['FAILED', 'VOIDED', 'DENIED', 'CANCELLED'].includes(status)) {
          isTerminalStatus = true;
        }
      }

      if (isWithinWindow) {
        preconditionsSatisfied.push('Transaction age is within standard clearing window (<= 7 days).');
      } else {
        unmetPreconditions.push('Transaction age exceeds 7-day clearing window.');
      }

      // Contraindications
      if (!isWithinWindow) {
        activeContraindications.push('Transaction age exceeds clearing threshold (> 7 days).');
      }
      if (isTerminalStatus) {
        activeContraindications.push('Transaction status is terminal (FAILED, VOIDED, DENIED).');
      }
      if (isWithinWindow && !isTerminalStatus) {
        contraindicationsChecked.push('Confirmed transaction is not terminal and within clearing window.');
      }
      break;
    }

    case 'REQUEST_MERCHANT_DOCUMENTATION': {
      const isMissingMerchantSide =
        !caseDetail.merchantOrderId ||
        discrepancy === 'MISSING_ORDER_IN_MERCHANT' ||
        discrepancy === 'UNMATCHED_TRANSACTION' ||
        !evidenceItems.some((e) => e.evidenceType === 'MERCHANT_ORDER');

      if (isMissingMerchantSide) {
        preconditionsSatisfied.push('PayPal capture observed in ledger but merchant order proof is missing.');
      } else {
        unmetPreconditions.push('Merchant order record is already attached.');
      }

      // Contraindication: Merchant order is already fully attached
      const hasFullOrder = evidenceItems.some(
        (e) => e.evidenceType === 'MERCHANT_ORDER' && e.payloadSnapshot && Object.keys(e.payloadSnapshot).length > 2
      );
      if (hasFullOrder) {
        activeContraindications.push('Merchant order record is already attached and fully populated in evidence.');
      } else {
        contraindicationsChecked.push('Confirmed merchant order record is missing or incomplete.');
      }
      break;
    }

    case 'REVIEW_REFUND_STATUS': {
      const isRefundDiscrepancy =
        discrepancy === 'PARTIAL_REFUND_MISMATCH' ||
        discrepancy === 'FULL_REFUND_SETTLEMENT';

      const hasRefundEvidence = evidenceItems.some(
        (e) =>
          e.sourceRecordId.startsWith('REFUND-') ||
          (e.payloadSnapshot && Boolean(e.payloadSnapshot.refundId || e.payloadSnapshot.relatedRefundAmountMinor))
      );

      if (isRefundDiscrepancy || hasRefundEvidence) {
        preconditionsSatisfied.push('Exception involves refund activity or refund references in evidence.');
      } else {
        unmetPreconditions.push('No refund discrepancy or refund references identified.');
      }

      // Contraindication: Zero refund records and positive uncaptured variance
      if (!isRefundDiscrepancy && !hasRefundEvidence) {
        activeContraindications.push('Zero refund records exist and discrepancy is not a refund settlement category.');
      } else {
        contraindicationsChecked.push('Confirmed potential refund explanation is applicable.');
      }
      break;
    }

    case 'INVESTIGATE_AMOUNT_VARIANCE': {
      const hasVariance = caseDetail.varianceAmount.amountMinor > 0;
      if (hasVariance) {
        preconditionsSatisfied.push(`Variance amount is non-zero ($${(caseDetail.varianceAmount.amountMinor / 100).toFixed(2)}).`);
      } else {
        unmetPreconditions.push('Variance amount is zero.');
      }

      const hasBothAmounts =
        caseDetail.expectedAmount?.amountMinor !== undefined && caseDetail.actualAmount?.amountMinor !== undefined;
      if (hasBothAmounts) {
        preconditionsSatisfied.push('Both expected and actual amounts are observed in evidence.');
      } else {
        unmetPreconditions.push('Missing expected or actual amount values.');
      }

      // Contraindication: Zero variance
      if (!hasVariance) {
        activeContraindications.push('Variance amount is zero (varianceAmountMinor === 0).');
      } else {
        contraindicationsChecked.push('Confirmed non-zero variance requires investigation.');
      }
      break;
    }

    case 'REVIEW_DUPLICATE_PAYMENT': {
      const isDuplicateDiscrepancy =
        discrepancy === 'DUPLICATE_PAYMENT' ||
        discrepancy === 'AMBIGUOUS_MATCH' ||
        discrepancy === 'COLLISION_RECORD';

      const txnEvidenceCount = evidenceItems.filter(
        (e) => e.evidenceType === 'PAYPAL_TRANSACTION' || e.sourceRecordId.startsWith('TXN-')
      ).length;

      if (isDuplicateDiscrepancy || txnEvidenceCount > 1) {
        preconditionsSatisfied.push('Multiple transactions or duplicate candidate collision observed in evidence.');
      } else {
        unmetPreconditions.push('No duplicate candidates or multiple transactions observed.');
      }

      // Contraindication: Single distinct transaction and zero duplicates
      if (!isDuplicateDiscrepancy && txnEvidenceCount <= 1) {
        activeContraindications.push('Only a single distinct transaction exists and zero duplicate candidates identified.');
      } else {
        contraindicationsChecked.push('Confirmed multiple candidate transactions or collision records present.');
      }
      break;
    }

    case 'ESCALATE_FOR_MANUAL_REVIEW': {
      // Universal action for high uncertainty or complexity
      const shouldEscalate =
        multiEntity.hasMultiEntityAmbiguity ||
        caseDetail.varianceAmount.amountMinor > 50000 ||
        discrepancy === 'AMBIGUOUS_MATCH' ||
        freshness.isEvidenceStale;

      if (shouldEscalate) {
        preconditionsSatisfied.push('High uncertainty, multi-entity ambiguity, or high variance justifies supervisor escalation.');
      } else {
        unmetPreconditions.push('Exception has clear parameters suitable for standard operational review.');
      }

      // Contraindication: Low uncertainty, zero ambiguity, clear automated case
      if (
        !multiEntity.hasMultiEntityAmbiguity &&
        caseDetail.varianceAmount.amountMinor <= 5000 &&
        !freshness.isEvidenceStale &&
        latestInvestigation &&
        !latestInvestigation.isStale
      ) {
        activeContraindications.push('Exception has low uncertainty and clear automated explanation.');
      } else {
        contraindicationsChecked.push('Confirmed complex factors warranting escalation consideration.');
      }
      break;
    }

    case 'REVIEW_CASE_EVIDENCE': {
      // Universal action when evidence requires review
      const needsEvidenceReview =
        !latestInvestigation ||
        freshness.isEvidenceStale ||
        freshness.isFreshnessUnknown ||
        multiEntity.hasMultiEntityAmbiguity;

      if (needsEvidenceReview) {
        preconditionsSatisfied.push('Investigation snapshot is stale, missing, or multi-entity ambiguity detected.');
      } else {
        unmetPreconditions.push('Investigation is fresh, complete, and free from document-level ambiguity.');
      }

      // Contraindication: Investigation is completely fresh, confident, and unambiguous
      if (
        latestInvestigation &&
        !freshness.isEvidenceStale &&
        !freshness.isFreshnessUnknown &&
        !multiEntity.hasMultiEntityAmbiguity &&
        latestInvestigation.investigationResult?.inferences.some((i) => i.confidenceCategory === 'HIGH')
      ) {
        activeContraindications.push('Investigation is fresh, confidence is HIGH, and evidence is completely verified.');
      } else {
        contraindicationsChecked.push('Confirmed evidence verification is necessary.');
      }
      break;
    }
  }

  const isEligible =
    unmetPreconditions.length === 0 &&
    activeContraindications.length === 0 &&
    missingEvidenceTypes.length === 0;

  let disqualificationReason: string | undefined;
  if (!isEligible) {
    if (activeContraindications.length > 0) {
      disqualificationReason = `Contraindicated: ${activeContraindications[0]}`;
    } else if (unmetPreconditions.length > 0) {
      disqualificationReason = `Unmet precondition: ${unmetPreconditions[0]}`;
    } else if (missingEvidenceTypes.length > 0) {
      disqualificationReason = `Missing required evidence: [${missingEvidenceTypes.join(', ')}]`;
    }
  }

  return {
    actionId: action.actionId,
    isEligible,
    preconditionsSatisfied,
    unmetPreconditions,
    contraindicationsChecked,
    activeContraindications,
    missingEvidenceTypes,
    disqualificationReason,
  };
}
