import {
  MatchingEvidence,
  MatchingMethod,
  ComparedField,
  MerchantOrder,
  PaymentTransaction,
} from '@/types/financial';

export interface EvidenceBuilderParams {
  order?: MerchantOrder;
  transactions: PaymentTransaction[];
  matchingMethod: MatchingMethod;
  matchingRule: string;
  comparedFields?: ComparedField[];
  reasonsForAccepting: string[];
  reasonsForRejectingCandidates?: string[];
  toleranceWindowSeconds?: number;
}

export function buildMatchingEvidence(params: {
  order?: MerchantOrder;
  transactions: PaymentTransaction[];
  matchingMethod: MatchingMethod;
  matchingRule: string;
  comparedFields?: ComparedField[];
  reasonsForAccepting: string[];
  reasonsForRejectingCandidates?: string[];
  toleranceWindowSeconds?: number;
}): MatchingEvidence {
  const {
    order,
    transactions,
    matchingMethod,
    matchingRule,
    comparedFields = [],
    reasonsForAccepting,
    reasonsForRejectingCandidates = [],
    toleranceWindowSeconds = 172800,
  } = params;

  const primaryTxn = transactions[0];
  const currency = order ? order.currency : primaryTxn ? primaryTxn.currency : 'USD';

  // Calculate aggregated actual amount across all linked transactions
  let totalActualMinor = 0;
  for (const txn of transactions) {
    if (txn.currency === currency) {
      if (txn.transactionType === 'REFUND' || txn.transactionType === 'REVERSAL') {
        // Refunds reduce the net capture balance
        totalActualMinor += txn.grossAmount.amountMinor; // grossAmount for refunds is negative
      } else {
        totalActualMinor += txn.grossAmount.amountMinor;
      }
    }
  }

  const expectedMinor = order ? order.expectedAmount.amountMinor : 0;
  const varianceMinor = expectedMinor - totalActualMinor;
  const isExactMatch = varianceMinor === 0 && order !== undefined && transactions.length > 0;

  // Timestamp comparison if order and transaction exist
  let timestampComparison: MatchingEvidence['timestampComparison'] = undefined;
  if (order && primaryTxn) {
    const orderTime = new Date(order.createdAt).getTime();
    const txnTime = new Date(primaryTxn.transactionTime).getTime();
    const diffSeconds = Math.abs(Math.round((txnTime - orderTime) / 1000));
    const withinTolerance = diffSeconds <= toleranceWindowSeconds;

    timestampComparison = {
      orderTimestamp: order.createdAt,
      transactionTimestamp: primaryTxn.transactionTime,
      differenceSeconds: diffSeconds,
      toleranceWindowSeconds,
      withinTolerance,
    };
  }

  return {
    orderId: order?.merchantOrderId,
    transactionIds: transactions.map((t) => t.paypalTransactionId),
    matchingMethod,
    matchingRule,
    comparedFields,
    amountComparison: {
      expectedAmountMinor: expectedMinor,
      actualAmountMinor: totalActualMinor,
      varianceMinor,
      currency,
      isExactMatch,
    },
    currencyComparison: {
      orderCurrency: order?.currency || '',
      transactionCurrency: primaryTxn?.currency || '',
      matches: order ? (primaryTxn ? order.currency === primaryTxn.currency : false) : false,
    },
    timestampComparison,
    reasonsForAccepting,
    reasonsForRejectingCandidates,
  };
}
