import {
  MerchantOrder,
  PaymentTransaction,
  ReconciliationRecord,
  ComparedField,
} from '@/types/financial';
import { isMoneyEqual, subtractMoney } from '../money';
import { MatchingConfiguration } from './matchingRules';
import { buildMatchingEvidence } from './matchingEvidence';

export interface CompositeMatchCandidate {
  order: MerchantOrder;
  transaction: PaymentTransaction;
  timeDifferenceSeconds: number;
  hasCustomerReferenceMatch: boolean;
}

/**
 * Pass 2: Composite Matching.
 * Evaluates records based on exact amount, currency, timestamp proximity, and status.
 */
export function findCompositeMatchCandidates(
  order: MerchantOrder,
  availableTransactions: PaymentTransaction[],
  config: MatchingConfiguration
): CompositeMatchCandidate[] {
  const candidates: CompositeMatchCandidate[] = [];

  const orderTime = new Date(order.createdAt).getTime();

  for (const txn of availableTransactions) {
    // 1. Must be exact currency
    if (config.strictCurrencyMatching && order.currency !== txn.currency) {
      continue;
    }

    // 2. Must be exact amount
    if (!isMoneyEqual(order.expectedAmount, txn.grossAmount)) {
      continue;
    }

    // 3. Must be completed capture
    if (txn.transactionType !== 'CAPTURE' && txn.transactionStatus !== 'COMPLETED') {
      continue;
    }

    // 4. Must be within timestamp tolerance
    const txnTime = new Date(txn.transactionTime).getTime();
    const diffSeconds = Math.abs(Math.round((txnTime - orderTime) / 1000));
    if (diffSeconds > config.timestampToleranceSeconds) {
      continue;
    }

    // Optional customer reference check
    let customerMatch = false;
    if (order.customerReference && txn.merchantReference) {
      customerMatch =
        order.customerReference.toLowerCase().trim() ===
        txn.merchantReference.toLowerCase().trim();
    }

    candidates.push({
      order,
      transaction: txn,
      timeDifferenceSeconds: diffSeconds,
      hasCustomerReferenceMatch: customerMatch,
    });
  }

  // Sort candidates by lowest time difference
  candidates.sort((a, b) => a.timeDifferenceSeconds - b.timeDifferenceSeconds);

  return candidates;
}

export function createCompositeReconciliationRecord(
  order: MerchantOrder,
  transaction: PaymentTransaction,
  config: MatchingConfiguration,
  rejectedCandidateIds: string[] = []
): ReconciliationRecord {
  const comparedFields: ComparedField[] = [
    {
      field: 'grossAmount',
      orderValue: order.expectedAmount.amountMinor.toString(),
      transactionValue: transaction.grossAmount.amountMinor.toString(),
      matched: true,
    },
    {
      field: 'currency',
      orderValue: order.currency,
      transactionValue: transaction.currency,
      matched: true,
    },
  ];

  const evidence = buildMatchingEvidence({
    order,
    transactions: [transaction],
    matchingMethod: 'COMPOSITE_HEURISTIC',
    matchingRule: 'RULE_COMPOSITE_AMOUNT_CURRENCY_TIME',
    comparedFields,
    reasonsForAccepting: [
      'Exact monetary gross amount matched.',
      'Currency matched.',
      `Timestamp difference within configured tolerance (${config.timestampToleranceSeconds}s).`,
      'Transaction verified as completed capture.',
    ],
    reasonsForRejectingCandidates: rejectedCandidateIds.map(
      (id) => `Competing candidate ${id} had larger timestamp variance or lower heuristic score.`
    ),
    toleranceWindowSeconds: config.timestampToleranceSeconds,
  });

  return {
    id: `rec_${order.merchantOrderId}_${transaction.paypalTransactionId}`,
    orderId: order.merchantOrderId,
    transactionIds: [transaction.paypalTransactionId],
    matchStatus: 'MATCHED',
    discrepancyType: 'NONE',
    confidence: 'COMPOSITE_CONFIRMED',
    matchingMethod: 'COMPOSITE_HEURISTIC',
    expectedAmount: order.expectedAmount,
    actualAmount: transaction.grossAmount,
    varianceAmount: subtractMoney(order.expectedAmount, transaction.grossAmount),
    currency: order.currency,
    evidence,
    createdAt: new Date().toISOString(),
  };
}

