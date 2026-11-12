import {
  MerchantOrder,
  PaymentTransaction,
  ReconciliationRecord,
  ComparedField,
} from '@/types/financial';
import { isMoneyEqual, subtractMoney } from '../money';
import { buildMatchingEvidence } from './matchingEvidence';

export interface ExactMatchResult {
  matchedRecord: ReconciliationRecord;
  matchedOrder: MerchantOrder;
  matchedTransaction: PaymentTransaction;
}

/**
 * Normalizes identifier for exact, whitespace-trimmed comparison.
 */
function cleanId(id?: string): string {
  return id ? id.trim() : '';
}

/**
 * Pass 1: Authoritative Identifier Matching.
 * Evaluates whether a transaction and an order share an explicit, authoritative identifier link:
 * - paypalOrderId === merchantOrderId OR externalReference
 * - paypalCaptureId === externalReference OR merchantOrderId
 * - merchantReference === merchantOrderId OR externalReference
 * - invoiceId === externalReference OR merchantOrderId
 *
 * Enforces strict financial checks:
 * - Cross-validates all present identifiers and flags conflicts (e.g. paypalOrderId pointing to Order A
 *   while merchantReference points to Order B).
 * - Authorizations are NEVER classified as completed captures, even if status is COMPLETED.
 * - Distinguishes 100% full refunds from partial refunds.
 * - Reversals and dispute holds are correctly categorized.
 */
export function evaluateAuthoritativeIdentifierMatch(
  order: MerchantOrder,
  transaction: PaymentTransaction
): ExactMatchResult | null {
  const comparedFields: ComparedField[] = [];

  const orderId = cleanId(order.merchantOrderId);
  const extRef = cleanId(order.externalReference);

  const txnOrderId = cleanId(transaction.paypalOrderId);
  const txnCaptureId = cleanId(transaction.paypalCaptureId);
  const txnInvoiceId = cleanId(transaction.invoiceId);
  const txnRef = cleanId(transaction.merchantReference);

  const matchingRules: string[] = [];
  const conflictingFields: string[] = [];

  // 1. Check paypalOrderId
  if (txnOrderId) {
    const matches = txnOrderId === orderId || txnOrderId === extRef;
    if (matches) {
      matchingRules.push('RULE_AUTH_PAYPAL_ORDER_ID');
      comparedFields.push({
        field: 'paypalOrderId',
        orderValue: txnOrderId === orderId ? orderId : extRef,
        transactionValue: txnOrderId,
        matched: true,
      });
    } else {
      conflictingFields.push(`paypalOrderId ("${txnOrderId}")`);
    }
  }

  // 2. Check captureId
  if (txnCaptureId) {
    const matches = txnCaptureId === extRef || txnCaptureId === orderId;
    if (matches) {
      matchingRules.push('RULE_AUTH_CAPTURE_ID');
      comparedFields.push({
        field: 'paypalCaptureId',
        orderValue: txnCaptureId === extRef ? extRef : orderId,
        transactionValue: txnCaptureId,
        matched: true,
      });
    } else {
      conflictingFields.push(`paypalCaptureId ("${txnCaptureId}")`);
    }
  }

  // 3. Check merchantReference
  if (txnRef) {
    const matches = txnRef === orderId || txnRef === extRef;
    if (matches) {
      matchingRules.push('RULE_AUTH_MERCHANT_REFERENCE');
      comparedFields.push({
        field: 'merchantReference',
        orderValue: txnRef === orderId ? orderId : extRef,
        transactionValue: txnRef,
        matched: true,
      });
    } else {
      conflictingFields.push(`merchantReference ("${txnRef}")`);
    }
  }

  // 4. Check invoiceId
  if (txnInvoiceId) {
    const matches = txnInvoiceId === extRef || txnInvoiceId === orderId;
    if (matches) {
      matchingRules.push('RULE_AUTH_INVOICE_ID');
      comparedFields.push({
        field: 'invoiceId',
        orderValue: txnInvoiceId === extRef ? extRef : orderId,
        transactionValue: txnInvoiceId,
        matched: true,
      });
    } else {
      conflictingFields.push(`invoiceId ("${txnInvoiceId}")`);
    }
  }

  // If no identifiers matched, this order and transaction have no authoritative link
  if (matchingRules.length === 0) {
    return null;
  }

  const primaryMatchRule = matchingRules.join(' + ');
  const hasConflictingIdentifiers = conflictingFields.length > 0;

  // Verify currency consistency
  const currencyMatches = order.currency === transaction.currency;
  comparedFields.push({
    field: 'currency',
    orderValue: order.currency,
    transactionValue: transaction.currency,
    matched: currencyMatches,
  });

  const reasonsForAccepting: string[] = [
    `Authoritative identifier match established via ${primaryMatchRule}.`,
  ];

  if (!currencyMatches) {
    const evidence = buildMatchingEvidence({
      order,
      transactions: [transaction],
      matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
      matchingRule: `${primaryMatchRule}_CURRENCY_MISMATCH`,
      comparedFields,
      reasonsForAccepting: [
        ...reasonsForAccepting,
        `Currency mismatch: Order is in ${order.currency}, but transaction settled in ${transaction.currency}.`,
      ],
    });

    return {
      matchedRecord: {
        id: `rec_${order.merchantOrderId}_${transaction.paypalTransactionId}`,
        orderId: order.merchantOrderId,
        transactionIds: [transaction.paypalTransactionId],
        matchStatus: 'DISCREPANCY',
        discrepancyType: 'CURRENCY_MISMATCH',
        confidence: 'EXACT_AUTHORITATIVE',
        matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
        expectedAmount: order.expectedAmount,
        actualAmount: transaction.grossAmount,
        varianceAmount: order.expectedAmount,
        currency: order.currency,
        evidence,
        createdAt: new Date().toISOString(),
      },
      matchedOrder: order,
      matchedTransaction: transaction,
    };
  }

  // Same currency: evaluate amounts
  const amountMatches = isMoneyEqual(order.expectedAmount, transaction.grossAmount);
  const variance = subtractMoney(order.expectedAmount, transaction.grossAmount);

  comparedFields.push({
    field: 'grossAmount',
    orderValue: order.expectedAmount.amountMinor.toString(),
    transactionValue: transaction.grossAmount.amountMinor.toString(),
    matched: amountMatches,
  });

  // Evaluate status and discrepancy types
  let matchStatus: ReconciliationRecord['matchStatus'] = 'MATCHED';
  let discrepancyType: ReconciliationRecord['discrepancyType'] = 'NONE';
  let confidence: ReconciliationRecord['confidence'] = 'EXACT_AUTHORITATIVE';

  // Conflict detection: If transaction contains contradictory identifiers, require manual review
  if (hasConflictingIdentifiers) {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'CONFLICTING_REFERENCES';
    confidence = 'MANUAL_REVIEW_REQUIRED';
    reasonsForAccepting.push(
      `Conflict detected: Matched via ${primaryMatchRule}, but transaction also contains conflicting identifier(s): ${conflictingFields.join(', ')}.`
    );
  }
  // Check authorization hold (even if status is COMPLETED)
  else if (transaction.transactionType === 'AUTHORIZATION') {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'TIMING_DELAY';
    reasonsForAccepting.push(
      'Transaction is an uncaptured authorization hold; not recognized as completed settlement.'
    );
  }
  // Check pending settlement status
  else if (transaction.transactionStatus === 'PENDING') {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'TIMING_DELAY';
    reasonsForAccepting.push(
      'Transaction is in PENDING status at PayPal. Settlement clearing delay.'
    );
  }
  // Check dispute holds or reversals
  else if (
    transaction.transactionStatus === 'REVERSED' ||
    transaction.transactionType === 'REVERSAL' ||
    transaction.transactionType === 'DISPUTE_HOLD'
  ) {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'DISPUTE_HOLD';
    reasonsForAccepting.push(
      'Transaction has been reversed or is held under PayPal customer dispute.'
    );
  }
  // Check denied or failed status
  else if (
    transaction.transactionStatus === 'DENIED' ||
    transaction.transactionStatus === 'FAILED'
  ) {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'UNEXPECTED_STATUS';
    reasonsForAccepting.push(
      'Transaction failed or was denied at PayPal; cannot confirm settlement.'
    );
  }
  // Check completed refunds (distinguishing full vs partial)
  else if (transaction.transactionType === 'REFUND') {
    matchStatus = 'DISCREPANCY';
    const absRefundMinor = Math.abs(transaction.grossAmount.amountMinor);
    const isFullRefund = absRefundMinor >= order.expectedAmount.amountMinor;

    if (isFullRefund) {
      discrepancyType = 'FULL_REFUND_SETTLEMENT';
      reasonsForAccepting.push(
        `Linked transaction is a 100% full refund/cancellation of order ${order.merchantOrderId}.`
      );
    } else {
      discrepancyType = 'PARTIAL_REFUND_MISMATCH';
      reasonsForAccepting.push(
        `Linked transaction is a partial refund of ${absRefundMinor} minor units against order amount ${order.expectedAmount.amountMinor}.`
      );
    }
  }
  // Check gross amount variance
  else if (!amountMatches) {
    matchStatus = 'DISCREPANCY';
    discrepancyType = 'AMOUNT_MISMATCH';
    reasonsForAccepting.push(
      `Amount mismatch: expected ${order.expectedAmount.amountMinor} minor units, actual gross is ${transaction.grossAmount.amountMinor} minor units.`
    );
  } else {
    reasonsForAccepting.push('Exact monetary amount and currency verified.');
  }

  const evidence = buildMatchingEvidence({
    order,
    transactions: [transaction],
    matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
    matchingRule: primaryMatchRule,
    comparedFields,
    reasonsForAccepting,
  });

  return {
    matchedRecord: {
      id: `rec_${order.merchantOrderId}_${transaction.paypalTransactionId}`,
      orderId: order.merchantOrderId,
      transactionIds: [transaction.paypalTransactionId],
      matchStatus,
      discrepancyType,
      confidence,
      matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
      expectedAmount: order.expectedAmount,
      actualAmount: transaction.grossAmount,
      varianceAmount: variance,
      currency: order.currency,
      evidence,
      createdAt: new Date().toISOString(),
    },
    matchedOrder: order,
    matchedTransaction: transaction,
  };
}
