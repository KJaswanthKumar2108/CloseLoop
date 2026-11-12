/**
 * CloseLoop Phase 3D.3: Declarative Resolution Action Catalog
 * Stable, deterministic operator recommendations for payment exceptions.
 * AI cannot invent action IDs or executable instructions.
 */

import { ActionCatalogId, ActionCatalogEntry } from './types';

export const RESOLUTION_ACTION_CATALOG: Record<ActionCatalogId, ActionCatalogEntry> = {
  VERIFY_PAYMENT_REFERENCE: {
    actionId: 'VERIFY_PAYMENT_REFERENCE',
    title: 'Verify Payment Reference',
    description:
      'Inspect and reconcile conflicting or missing merchant order IDs and PayPal transaction references.',
    supportedDiscrepancies: [
      'CONFLICTING_REFERENCES',
      'MISSING_METADATA',
      'MISSING_PAYMENT',
      'MISSING_ORDER_IN_MERCHANT',
    ],
    preconditions: [
      'Case contains missing, ambiguous, or conflicting reference identifiers (orderId or transactionId)',
      'At least one payment or order evidence item is available for cross-referencing',
    ],
    contraindications: [
      'Both orderId and transactionId are cleanly matched and authoritatively verified',
    ],
    requiredEvidenceTypes: ['MERCHANT_ORDER', 'PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Resolve reference ambiguity in merchant OMS or PayPal to establish unambiguous payment attribution.',
    riskLevel: 'LOW',
    requiresHumanReview: true,
  },

  WAIT_FOR_SETTLEMENT: {
    actionId: 'WAIT_FOR_SETTLEMENT',
    title: 'Wait for Settlement Confirmation',
    description:
      'Monitor transaction settlement lifecycle when timing delay or batch clearing is in progress.',
    supportedDiscrepancies: ['TIMING_DELAY', 'UNEXPECTED_STATUS', 'MISSING_PAYMENT'],
    preconditions: [
      'Exception involves pending capture, clearing interval, or cross-border settlement delay',
      'Transaction age is within standard clearing window (<= 7 days)',
    ],
    contraindications: [
      'Transaction age exceeds clearing threshold (> 7 days)',
      'Transaction status is terminal (FAILED, VOIDED, DENIED, or CANCELLED)',
    ],
    requiredEvidenceTypes: ['PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Order funds clear automatically upon PayPal ACH/card batch settlement completion.',
    riskLevel: 'LOW',
    requiresHumanReview: true,
  },

  REQUEST_MERCHANT_DOCUMENTATION: {
    actionId: 'REQUEST_MERCHANT_DOCUMENTATION',
    title: 'Request Supporting Documentation',
    description:
      'Obtain missing order receipts, fulfillment slips, or invoice proof from merchant OMS/ERP.',
    supportedDiscrepancies: [
      'MISSING_ORDER_IN_MERCHANT',
      'MISSING_METADATA',
      'MISSING_PAYMENT',
      'UNMATCHED_TRANSACTION',
    ],
    preconditions: [
      'PayPal capture observed in ledger but corresponding merchant order record is missing or incomplete',
    ],
    contraindications: [
      'Merchant order record is already attached and fully populated in evidence graph',
    ],
    requiredEvidenceTypes: ['PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Retrieve order documentation from merchant to link PayPal capture into financial ledger.',
    riskLevel: 'LOW',
    requiresHumanReview: true,
  },

  REVIEW_REFUND_STATUS: {
    actionId: 'REVIEW_REFUND_STATUS',
    title: 'Review Refund Status',
    description:
      'Analyze partial or full refund ledger events explaining negative balance or reduced settlement.',
    supportedDiscrepancies: [
      'PARTIAL_REFUND_MISMATCH',
      'FULL_REFUND_SETTLEMENT',
      'AMOUNT_MISMATCH',
    ],
    preconditions: [
      'Exception discrepancy indicates refund activity or evidence payload contains refund references',
    ],
    contraindications: [
      'Zero refund records exist and variance is positive uncaptured gross revenue',
    ],
    requiredEvidenceTypes: ['PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Confirm whether variance represents an authorized customer refund vs uncaptured funds.',
    riskLevel: 'MEDIUM',
    requiresHumanReview: true,
  },

  INVESTIGATE_AMOUNT_VARIANCE: {
    actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
    title: 'Investigate Amount Difference',
    description:
      'Investigate gross payment discrepancy or fee schedule divergence between order and capture.',
    supportedDiscrepancies: [
      'AMOUNT_MISMATCH',
      'FEE_VARIANCE',
      'CURRENCY_MISMATCH',
      'MULTI_CAPTURE_VARIANCE',
      'EXCHANGE_RATE_SLIPPAGE',
    ],
    preconditions: [
      'Both expected and actual amounts are observed in evidence',
      'Variance amount is non-zero (varianceAmountMinor > 0)',
    ],
    contraindications: [
      'Variance amount is zero (varianceAmountMinor === 0)',
      'Discrepancy is fully accounted for by verified refund records',
    ],
    requiredEvidenceTypes: ['MERCHANT_ORDER', 'PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Determine whether discrepancy originates from merchant pricing error, fee tier adjustment, or FX conversion.',
    riskLevel: 'MEDIUM',
    requiresHumanReview: true,
  },

  REVIEW_DUPLICATE_PAYMENT: {
    actionId: 'REVIEW_DUPLICATE_PAYMENT',
    title: 'Investigate Potential Duplicate',
    description:
      'Examine multiple PayPal transaction captures linked to the same order reference or identical amount.',
    supportedDiscrepancies: [
      'DUPLICATE_PAYMENT',
      'AMBIGUOUS_MATCH',
      'CONFLICTING_REFERENCES',
      'COLLISION_RECORD',
    ],
    preconditions: [
      'Multiple PayPal transactions associated with case or collision record observed in evidence',
    ],
    contraindications: [
      'Only a single distinct transaction exists and zero duplicate candidates identified',
    ],
    requiredEvidenceTypes: ['PAYPAL_TRANSACTION'],
    expectedOperatorOutcome:
      'Identify duplicate customer payments requiring operator resolution or authorized refund processing.',
    riskLevel: 'HIGH',
    requiresHumanReview: true,
  },

  ESCALATE_FOR_MANUAL_REVIEW: {
    actionId: 'ESCALATE_FOR_MANUAL_REVIEW',
    title: 'Escalate to Manual Review',
    description:
      'Escalate complex, high-uncertainty, or high-variance exceptions to a senior financial supervisor.',
    supportedDiscrepancies: ['*'], // Universal action
    preconditions: [
      'High uncertainty score (>= 50), conflicting evidence, or high dollar variance',
      'Or multi-entity document-level ambiguity detected',
    ],
    contraindications: [
      'Exception has low uncertainty (<= 25), clear automated explanation, and zero conflicting evidence',
    ],
    requiredEvidenceTypes: [],
    expectedOperatorOutcome:
      'Comprehensive manual ledger audit and exception sign-off by an authorized financial controller.',
    riskLevel: 'HIGH',
    requiresHumanReview: true,
  },

  REVIEW_CASE_EVIDENCE: {
    actionId: 'REVIEW_CASE_EVIDENCE',
    title: 'Review Supporting Evidence',
    description:
      'Re-examine evidence items due to stale investigation snapshot, missing AI analysis, or document-level ambiguity.',
    supportedDiscrepancies: ['*'], // Universal action
    preconditions: [
      'Investigation is missing, investigation snapshot is stale, evidence fingerprint drifted, or multi-entity ambiguity detected',
    ],
    contraindications: [
      'Investigation is fresh, confidence is HIGH, zero ambiguity detected, and evidence is completely verified',
    ],
    requiredEvidenceTypes: [],
    expectedOperatorOutcome:
      'Operator verifies fresh evidence graph and re-triggers AI copilot analysis if needed.',
    riskLevel: 'LOW',
    requiresHumanReview: true,
  },
};

/**
 * Retrieves a catalog entry by its action ID.
 * Throws an error if an invalid or unsupported action ID is requested.
 */
export function getActionCatalogEntry(actionId: string): ActionCatalogEntry {
  const entry = RESOLUTION_ACTION_CATALOG[actionId as ActionCatalogId];
  if (!entry) {
    throw new Error(`Unsupported or unknown resolution action catalog ID: '${actionId}'`);
  }
  return entry;
}

/**
 * Returns all available action catalog entries.
 */
export function getAllActionCatalogEntries(): ActionCatalogEntry[] {
  return Object.values(RESOLUTION_ACTION_CATALOG);
}

