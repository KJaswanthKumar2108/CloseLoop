import {
  MerchantOrder,
  PaymentTransaction,
  ReconciliationRecord,
  ComparedField,
} from '@/types/financial';
import {
  isMoneyEqual,
  subtractMoney,
  createMoney,
} from '../money';
import {
  MatchingConfiguration,
  SCORING_WEIGHTS,
} from './matchingRules';
import { buildMatchingEvidence } from './matchingEvidence';

export interface ScoredCandidate {
  order: MerchantOrder;
  transaction: PaymentTransaction;
  score: number;
  scoreBreakdown: {
    amountScore: number;
    currencyScore: number;
    timestampScore: number;
    referenceScore: number;
  };
  timeDifferenceSeconds: number;
}

/**
 * Calculates a transparent deterministic heuristic score (0 - 100).
 * Important: This is a deterministic weighting score, NOT a statistical probability.
 */
export function calculateCandidateScore(
  order: MerchantOrder,
  transaction: PaymentTransaction
): ScoredCandidate {
  let amountScore = 0;
  let currencyScore = 0;
  let timestampScore = 0;
  let referenceScore = 0;

  // Amount score
  if (isMoneyEqual(order.expectedAmount, transaction.grossAmount)) {
    amountScore = SCORING_WEIGHTS.EXACT_AMOUNT;
  }

  // Currency score
  if (order.currency === transaction.currency) {
    currencyScore = SCORING_WEIGHTS.EXACT_CURRENCY;
  }

  // Timestamp proximity
  const orderTime = new Date(order.createdAt).getTime();
  const txnTime = new Date(transaction.transactionTime).getTime();
  const diffSeconds = Math.abs(Math.round((txnTime - orderTime) / 1000));

  if (diffSeconds <= 86400) {
    // Within 24 hours
    timestampScore = SCORING_WEIGHTS.TIMESTAMP_PROXIMITY;
  } else if (diffSeconds <= 172800) {
    // Within 48 hours
    timestampScore = Math.round(SCORING_WEIGHTS.TIMESTAMP_PROXIMITY * 0.7);
  } else if (diffSeconds <= 604800) {
    // Within 7 days
    timestampScore = Math.round(SCORING_WEIGHTS.TIMESTAMP_PROXIMITY * 0.3);
  }

  // Reference similarity (token or partial substring match)
  const oRef = order.externalReference.toLowerCase();
  const tRef = (transaction.merchantReference || '').toLowerCase();
  if (tRef && (oRef.includes(tRef) || tRef.includes(oRef))) {
    referenceScore = SCORING_WEIGHTS.PARTIAL_REFERENCE_MATCH;
  }

  const score = amountScore + currencyScore + timestampScore + referenceScore;

  return {
    order,
    transaction,
    score,
    scoreBreakdown: {
      amountScore,
      currencyScore,
      timestampScore,
      referenceScore,
    },
    timeDifferenceSeconds: diffSeconds,
  };
}

/**
 * Evaluates whether multiple partial captures correspond to a single merchant order.
 */
/**
 * Evaluates whether multiple partial captures correspond to a single merchant order.
 * Enforces strict financial eligibility:
 * - Only COMPLETED captures contribute to settled gross totals.
 * - PENDING, DENIED, or REVERSED captures are identified and prevent a clean MATCHED status.
 * - Duplicate capture IDs are deduplicated and cannot contribute twice.
 * - Over-captures and under-captures are explicitly categorized.
 */
export function evaluateMultiCaptureMatch(
  order: MerchantOrder,
  transactions: PaymentTransaction[],
  config: MatchingConfiguration
): ReconciliationRecord | null {
  if (!config.allowMultiCapture || transactions.length < 2) {
    return null;
  }

  const orderId = order.merchantOrderId.trim();
  const extRef = order.externalReference.trim();

  // Find all distinct transactions that reference this order
  const seenTxnIds = new Set<string>();
  const allReferencedTxns: PaymentTransaction[] = [];

  for (const txn of transactions) {
    const tOrderId = (txn.paypalOrderId || '').trim();
    const tRef = (txn.merchantReference || '').trim();
    const tInv = (txn.invoiceId || '').trim();

    const referencesOrder =
      (tOrderId && (tOrderId === orderId || tOrderId === extRef)) ||
      (tRef && (tRef === orderId || tRef === extRef)) ||
      (tInv && (tInv === orderId || tInv === extRef));

    if (referencesOrder && !seenTxnIds.has(txn.paypalTransactionId)) {
      seenTxnIds.add(txn.paypalTransactionId);
      allReferencedTxns.push(txn);
    }
  }

  // Must have at least 2 distinct transactions referencing this order
  if (allReferencedTxns.length < 2) {
    return null;
  }

  // Check currency consistency across all referenced transactions
  const hasMixedCurrencies = allReferencedTxns.some(
    (t) => t.currency !== order.currency || t.grossAmount.currency !== order.currency
  );

  if (hasMixedCurrencies) {
    return {
      id: `rec_multi_${order.merchantOrderId}`,
      orderId: order.merchantOrderId,
      transactionIds: allReferencedTxns.map((t) => t.paypalTransactionId),
      matchStatus: 'DISCREPANCY',
      discrepancyType: 'CURRENCY_MISMATCH',
      confidence: 'EXACT_AUTHORITATIVE',
      matchingMethod: 'MULTI_CAPTURE_RULE',
      expectedAmount: order.expectedAmount,
      actualAmount: order.expectedAmount,
      varianceAmount: order.expectedAmount,
      currency: order.currency,
      evidence: buildMatchingEvidence({
        order,
        transactions: allReferencedTxns,
        matchingMethod: 'MULTI_CAPTURE_RULE',
        matchingRule: 'RULE_MULTI_CAPTURE_AGGREGATION',
        comparedFields: [
          {
            field: 'currency',
            orderValue: order.currency,
            transactionValue: allReferencedTxns.map((t) => t.currency).join(', '),
            matched: false,
          },
        ],
        reasonsForAccepting: [
          `Multi-capture transactions contain mixed currencies (${allReferencedTxns.map((t) => t.currency).join(', ')} vs ${order.currency}); currency aggregation prohibited.`,
        ],
      }),
      createdAt: new Date().toISOString(),
    };
  }

  // Segregate into eligible completed captures and ineligible transactions
  const eligibleCaptures = allReferencedTxns.filter(
    (t) => t.transactionType === 'CAPTURE' && t.transactionStatus === 'COMPLETED'
  );
  const ineligibleTxns = allReferencedTxns.filter(
    (t) => !(t.transactionType === 'CAPTURE' && t.transactionStatus === 'COMPLETED')
  );

  // If there is only 1 completed capture and ALL other transactions referencing this order
  // are AUTHORIZATION holds, this is a standard auth + single capture flow, not a multi-capture.
  // Delegate to Pass 1 exact matching so the completed capture can match the order.
  const allOtherAreAuth =
    ineligibleTxns.length > 0 &&
    ineligibleTxns.every((t) => t.transactionType === 'AUTHORIZATION');
  if (eligibleCaptures.length === 1 && allOtherAreAuth) {
    return null;
  }

  // Sum up eligible completed captures in integer minor units
  let sumMinor = 0;
  for (const txn of eligibleCaptures) {
    sumMinor += txn.grossAmount.amountMinor;
  }

  const aggregatedGross = createMoney(sumMinor, order.currency);
  const variance = subtractMoney(order.expectedAmount, aggregatedGross);
  const isExactSum = variance.amountMinor === 0;

  // Determine match status and discrepancy type
  let matchStatus: ReconciliationRecord['matchStatus'] = 'MATCHED';
  let discrepancyType: ReconciliationRecord['discrepancyType'] = 'NONE';
  const reasons: string[] = [];
  const hasRefund = allReferencedTxns.some((t) => t.transactionType === 'REFUND');

  if (hasRefund) {
    matchStatus = 'DISCREPANCY';
    const completedRefunds = allReferencedTxns.filter(
      (t) => t.transactionType === 'REFUND' && t.transactionStatus === 'COMPLETED'
    );
    const nonCompletedRefunds = allReferencedTxns.filter(
      (t) => t.transactionType === 'REFUND' && t.transactionStatus !== 'COMPLETED'
    );
    const hasPendingRefund = nonCompletedRefunds.some((t) => t.transactionStatus === 'PENDING');
    const hasDeniedRefund = nonCompletedRefunds.some(
      (t) => t.transactionStatus === 'DENIED' || t.transactionStatus === 'FAILED'
    );
    const hasReversedRefund = nonCompletedRefunds.some((t) => t.transactionStatus === 'REVERSED');

    if (completedRefunds.length === 0) {
      if (hasPendingRefund) {
        discrepancyType = 'TIMING_DELAY';
        reasons.push(
          'Associated refund transaction is in PENDING status at PayPal; settlement clearing delay.'
        );
      } else if (hasReversedRefund) {
        discrepancyType = 'DISPUTE_HOLD';
        reasons.push(
          'Associated refund transaction was REVERSED; refund was not settled.'
        );
      } else if (hasDeniedRefund) {
        discrepancyType = 'UNEXPECTED_STATUS';
        reasons.push(
          'Associated refund transaction was DENIED/FAILED by PayPal; refund was not settled.'
        );
      } else {
        discrepancyType = 'UNEXPECTED_STATUS';
        reasons.push(
          'Associated refund transaction is not in COMPLETED status; settlement credit not recognized.'
        );
      }
    } else {
      const totalRefundMinor = completedRefunds.reduce(
        (sum, t) => sum + Math.abs(t.grossAmount.amountMinor),
        0
      );

      if (totalRefundMinor >= order.expectedAmount.amountMinor) {
        discrepancyType = 'FULL_REFUND_SETTLEMENT';
        reasons.push(
          `Completed refunds totaling ${totalRefundMinor} minor units equal or exceed expected amount ${order.expectedAmount.amountMinor}; order fully refunded.`
        );
      } else {
        discrepancyType = 'PARTIAL_REFUND_MISMATCH';
        if (hasPendingRefund) {
          reasons.push(
            `Partial completed refund detected (${totalRefundMinor} minor units vs ${order.expectedAmount.amountMinor} expected); order also contains pending refund transaction(s) awaiting settlement clearing.`
          );
        } else {
          reasons.push(
            `Partial completed refund detected (${totalRefundMinor} minor units vs ${order.expectedAmount.amountMinor} expected).`
          );
        }
      }
    }
  } else if (ineligibleTxns.length > 0) {
    matchStatus = 'DISCREPANCY';
    const hasPending = ineligibleTxns.some((t) => t.transactionStatus === 'PENDING');
    const hasDenied = ineligibleTxns.some((t) => t.transactionStatus === 'DENIED');

    if (hasPending) {
      discrepancyType = 'TIMING_DELAY';
      reasons.push(
        `Multi-capture incomplete: contains ${ineligibleTxns.length} non-completed transaction(s) pending settlement.`
      );
    } else if (hasDenied) {
      discrepancyType = 'MULTI_CAPTURE_VARIANCE';
      reasons.push(
        `Multi-capture contains failed/denied capture(s); cannot confirm full payment settlement.`
      );
    } else {
      discrepancyType = 'MULTI_CAPTURE_VARIANCE';
      reasons.push(
        `Multi-capture contains ${ineligibleTxns.length} ineligible transaction(s).`
      );
    }
  } else if (!isExactSum) {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'MULTI_CAPTURE_VARIANCE';
    if (variance.amountMinor > 0) {
      reasons.push(
        `Under-capture variance: eligible captures total ${aggregatedGross.amountMinor} minor units, falling short of expected ${order.expectedAmount.amountMinor} minor units.`
      );
    } else {
      reasons.push(
        `Over-capture variance: eligible captures total ${aggregatedGross.amountMinor} minor units, exceeding expected ${order.expectedAmount.amountMinor} minor units.`
      );
    }
  } else {
    reasons.push(
      `Aggregated ${eligibleCaptures.length} distinct completed captures matching order ${order.merchantOrderId} exactly.`
    );
  }

  const comparedFields: ComparedField[] = [
    {
      field: 'eligibleCapturesCount',
      orderValue: '1 Order',
      transactionValue: `${eligibleCaptures.length} Completed Captures`,
      matched: eligibleCaptures.length >= 2,
    },
    {
      field: 'totalGrossAmount',
      orderValue: order.expectedAmount.amountMinor.toString(),
      transactionValue: aggregatedGross.amountMinor.toString(),
      matched: isExactSum,
    },
  ];

  const evidence = buildMatchingEvidence({
    order,
    transactions: allReferencedTxns,
    matchingMethod: 'MULTI_CAPTURE_RULE',
    matchingRule: 'RULE_MULTI_CAPTURE_AGGREGATION',
    comparedFields,
    reasonsForAccepting: reasons,
  });

  return {
    id: `rec_multi_${order.merchantOrderId}`,
    orderId: order.merchantOrderId,
    transactionIds: allReferencedTxns.map((t) => t.paypalTransactionId),
    matchStatus,
    discrepancyType,
    confidence: 'EXACT_AUTHORITATIVE',
    matchingMethod: 'MULTI_CAPTURE_RULE',
    expectedAmount: order.expectedAmount,
    actualAmount: aggregatedGross,
    varianceAmount: variance,
    currency: order.currency,
    evidence,
    createdAt: new Date().toISOString(),
  };
}
