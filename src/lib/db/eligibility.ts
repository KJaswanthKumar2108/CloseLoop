import { TransactionType, TransactionStatus } from '@/types/financial';
import {
  ReconciliationEligibilityStatus,
  IdentityCollisionStatus,
} from './types';

/**
 * Result of evaluating reconciliation eligibility.
 */
export interface ReconciliationEligibilityEvaluation {
  isEligible: boolean;
  status: ReconciliationEligibilityStatus;
  reason: string;
}

/**
 * Evaluates whether a PayPal transaction record is eligible to enter
 * CloseLoop's active customer-order reconciliation pipeline.
 *
 * Enforces strict financial accounting boundaries:
 * 1. Ambiguous collisions: Immediately quarantined (never eligible).
 * 2. CAPTURE: Eligible only when COMPLETED with positive gross amount (> 0).
 * 3. REFUND: Eligible only when COMPLETED (Phase 2A settlement gate).
 * 4. REVERSAL: Separately preserved; ineligible for standard order matching.
 * 5. DISPUTE_HOLD: Ineligible (preserved as active dispute balance hold).
 * 6. AUTHORIZATION: Ineligible (preserved as pre-authorization hold).
 * 7. Non-completed (PENDING, DENIED, REVERSED): Ineligible.
 */
export function determineReconciliationEligibility(params: {
  transactionType: TransactionType;
  transactionStatus: TransactionStatus;
  grossAmountMinor: number;
  collisionStatus: IdentityCollisionStatus;
  hasParentReference?: boolean;
}): ReconciliationEligibilityEvaluation {
  const { transactionType, transactionStatus, grossAmountMinor, collisionStatus, hasParentReference } = params;

  // 1. Quarantined collisions are never eligible
  if (collisionStatus !== 'NONE') {
    return {
      isEligible: false,
      status: 'QUARANTINED_COLLISION',
      reason: 'Transaction is quarantined due to ambiguous reporting identity collision.',
    };
  }

  // 2. Authorizations: Never eligible for completed capture matching
  if (transactionType === 'AUTHORIZATION') {
    return {
      isEligible: false,
      status: 'INELIGIBLE_AUTHORIZATION',
      reason: 'Authorization hold is not settled customer revenue.',
    };
  }

  // 3. Dispute holds: Preserved separately
  if (transactionType === 'DISPUTE_HOLD') {
    return {
      isEligible: false,
      status: 'INELIGIBLE_HOLD',
      reason: 'Dispute hold represents frozen funds under dispute, not settled order revenue.',
    };
  }

  // 4. Payment reversals: Preserved separately
  if (transactionType === 'REVERSAL') {
    return {
      isEligible: false,
      status: 'INELIGIBLE_NON_SETTLED',
      reason: 'Payment reversal is preserved as a reversal event and not treated as standard order capture.',
    };
  }

  // 5. Customer Refunds: Follow Phase 2A settlement gate (only COMPLETED refunds contribute)
  if (transactionType === 'REFUND') {
    if (transactionStatus !== 'COMPLETED') {
      return {
        isEligible: false,
        status: 'INELIGIBLE_NON_SETTLED',
        reason: `Refund transaction is in status ${transactionStatus}; awaiting final settlement clearing.`,
      };
    }

    if (grossAmountMinor >= 0) {
      return {
        isEligible: false,
        status: 'INELIGIBLE_NON_SETTLED',
        reason: 'Refund transaction gross amount must be negative (< 0).',
      };
    }

    if (!hasParentReference) {
      return {
        isEligible: false,
        status: 'INELIGIBLE_HOLD',
        reason: 'Refund transaction has no verified parent order or capture reference; cannot be matched to a merchant order.',
      };
    }

    return {
      isEligible: true,
      status: 'ELIGIBLE',
      reason: 'Completed refund is eligible for customer order refund reconciliation.',
    };
  }

  // 6. Customer Captures (Sales Orders): Must be COMPLETED with positive amount
  if (transactionType === 'CAPTURE') {
    if (transactionStatus !== 'COMPLETED') {
      return {
        isEligible: false,
        status: 'INELIGIBLE_NON_SETTLED',
        reason: `Capture transaction is in status ${transactionStatus}; not settled.`,
      };
    }

    if (grossAmountMinor <= 0) {
      return {
        isEligible: false,
        status: 'INELIGIBLE_NON_SETTLED',
        reason: 'Capture transaction amount must be positive to reconcile against customer orders.',
      };
    }

    return {
      isEligible: true,
      status: 'ELIGIBLE',
      reason: 'Completed capture with positive settlement amount is eligible for order reconciliation.',
    };
  }

  // Fallback for any other type
  return {
    isEligible: false,
    status: 'INELIGIBLE_NON_SETTLED',
    reason: `Transaction type ${transactionType} is not eligible for customer payment reconciliation.`,
  };
}

