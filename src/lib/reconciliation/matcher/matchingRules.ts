import { MerchantOrder, PaymentTransaction } from '@/types/financial';

/**
 * Matching Rules and Threshold Configuration
 * All rules and tolerances are deterministic, explicit, and configurable.
 */

export interface MatchingConfiguration {
  /**
   * Maximum acceptable time window (in seconds) between order creation and payment capture
   * for composite matching. Default: 48 hours (172,800 seconds).
   */
  timestampToleranceSeconds: number;

  /**
   * Minimum temporal separation (in seconds) required between competing candidates
   * to confirm an assignment without manual review.
   * Justification: In online payment checkout flows, network latency and IPN/webhook delivery
   * jitter typically range between 1 and 180 seconds. Two transactions of identical amount
   * settling within 300 seconds (5 minutes) of each other without explicit order references
   * are materially indistinguishable. When competing candidates have timestamp deltas within
   * this threshold, the engine marks the record as AMBIGUOUS and routes to manual review.
   * Default: 300 seconds (5 minutes).
   */
  ambiguityToleranceSeconds: number;

  /**
   * Maximum acceptable time window (in seconds) for subsequent captures in multi-capture orders.
   * Default: 7 days (604,800 seconds).
   */
  multiCaptureWindowSeconds: number;

  /**
   * Whether to support multiple partial captures against a single merchant order.
   * Default: true.
   */
  allowMultiCapture: boolean;

  /**
   * Minimum deterministic score (0 - 100) for a record to be considered a candidate.
   * Note: Candidate scores represent deterministic heuristic weights, NEVER statistical probabilities.
   */
  candidateScoreThreshold: number;

  /**
   * Strict currency matching. When true, never matches records with different currencies.
   * Default: true.
   */
  strictCurrencyMatching: boolean;
}

export const DEFAULT_MATCHING_CONFIG: MatchingConfiguration = {
  timestampToleranceSeconds: 172800, // 48 hours
  ambiguityToleranceSeconds: 300,    // 5 minutes
  multiCaptureWindowSeconds: 604800, // 7 days
  allowMultiCapture: true,
  candidateScoreThreshold: 60,
  strictCurrencyMatching: true,
};

/**
 * Weights used in candidate scoring (deterministic heuristics, sum to 100 max).
 */
export const SCORING_WEIGHTS = {
  EXACT_AMOUNT: 45,
  EXACT_CURRENCY: 25,
  TIMESTAMP_PROXIMITY: 15,
  PARTIAL_REFERENCE_MATCH: 15,
} as const;

/**
 * Determines whether a composite candidate has sufficient identity corroboration.
 * Under Remediation B, a composite match based only on amount, currency, and timestamp
 * must NEVER be automatically confirmed when no corroborating customer or order identity
 * metadata exists.
 *
 * Supported identity fields inspected:
 * 1. Customer email/reference match:
 *    - order.customerReference matches txn.merchantReference (e.g. customer email).
 * 2. Order/invoice reference match:
 *    - order.externalReference matches or is contained in txn.merchantReference, txn.invoiceId, or txn.rawReference.
 *    - order.merchantOrderId matches or is contained in txn.merchantReference, txn.invoiceId, or txn.rawReference.
 */
export function hasIdentityCorroboration(
  order: MerchantOrder,
  txn: PaymentTransaction
): boolean {
  const oCust = (order.customerReference || '').toLowerCase().trim();
  const oExt = (order.externalReference || '').toLowerCase().trim();
  const oId = (order.merchantOrderId || '').toLowerCase().trim();

  const tRef = (txn.merchantReference || '').toLowerCase().trim();
  const tInv = (txn.invoiceId || '').toLowerCase().trim();
  const tOrderId = (txn.paypalOrderId || '').toLowerCase().trim();
  const tRaw = (txn.rawReference || '').toLowerCase().trim();

  // 1. Direct customer reference match (e.g. customer email or name)
  if (oCust && tRef && oCust === tRef) {
    return true;
  }
  if (oCust && tRaw && tRaw.includes(oCust)) {
    return true;
  }

  // 2. Order ID or External Reference matching transaction references
  if (oExt) {
    if (tRef && (tRef === oExt || tRef.includes(oExt) || oExt.includes(tRef))) return true;
    if (tInv && (tInv === oExt || tInv.includes(oExt) || oExt.includes(tInv))) return true;
    if (tOrderId && (tOrderId === oExt || tOrderId.includes(oExt))) return true;
    if (tRaw && tRaw.includes(oExt)) return true;
  }

  if (oId) {
    if (tRef && (tRef === oId || tRef.includes(oId) || oId.includes(tRef))) return true;
    if (tInv && (tInv === oId || tInv.includes(oId) || oId.includes(tInv))) return true;
    if (tOrderId && (tOrderId === oId || tOrderId.includes(oId))) return true;
    if (tRaw && tRaw.includes(oId)) return true;
  }

  return false;
}
