import {
  PaymentTransaction,
  TransactionType,
  TransactionStatus,
} from '@/types/financial';
import { parseDecimalToMoney } from '@/lib/reconciliation/money';
import { PayPalTransactionDetail } from './transactionSchemas';

/**
 * Result of normalizing a single PayPal transaction detail item.
 */
export type NormalizationResult =
  | {
      success: true;
      status: 'NORMALIZED';
      transaction: PaymentTransaction;
      rawDetail: PayPalTransactionDetail;
    }
  | {
      success: false;
      status: 'REJECTED';
      reason:
        | 'UNSUPPORTED_EVENT_CODE'
        | 'INVALID_AMOUNT'
        | 'UNSUPPORTED_CURRENCY'
        | 'MISSING_TRANSACTION_ID'
        | 'INVALID_TIMESTAMP'
        | 'UNMAPPED_STATUS';
      message: string;
      rawDetail: PayPalTransactionDetail;
    };

/**
 * Conservative Customer-Payment Reconciliation Allowlist.
 *
 * CloseLoop's PaymentTransaction domain is a customer-payment reconciliation model,
 * not a general PayPal balance ledger. Only PayPal event codes that unambiguously
 * represent customer checkout payments, customer refunds, customer payment reversals,
 * customer dispute chargebacks, or customer payment pre-authorizations are permitted
 * into the reconciliation-ready normalized collection.
 *
 * All non-customer-payment account balance movements (partner/merchant fees, balance currency
 * exchanges, inbound bank funding, bank cash withdrawals, hold releases, charge-offs)
 * are explicitly rejected to prevent ledger contamination.
 */
export const CUSTOMER_PAYMENT_EVENT_CODES: Record<string, TransactionType> = {
  // --- Checkout & Sales (CAPTURE) ---
  T0000: 'CAPTURE', // General PayPal checkout payment
  T0002: 'CAPTURE', // Subscription / recurring payment
  T0006: 'CAPTURE', // Express Checkout payment
  T0007: 'CAPTURE', // Website Payments Standard
  T0011: 'CAPTURE', // Mobile payment
  T0012: 'CAPTURE', // Virtual Terminal payment
  T0013: 'CAPTURE', // Donation payment
  T0018: 'CAPTURE', // Point of sale (PoS) payment

  // --- Customer Refunds (REFUND) ---
  T1107: 'REFUND', // Payment refund

  // --- Customer Payment Reversals (REVERSAL) ---
  T1106: 'REVERSAL', // Payment reversal

  // --- Customer Disputes & Chargebacks (DISPUTE_HOLD) ---
  T1201: 'DISPUTE_HOLD', // Chargeback debit

  // --- Customer Pre-Authorizations (AUTHORIZATION) ---
  T1300: 'AUTHORIZATION', // General authorization
  T1301: 'AUTHORIZATION', // Reauthorization
};

/**
 * Provides authoritative, descriptive rejection messages for PayPal event codes
 * excluded from the customer-payment reconciliation collection.
 */
export function getUnsupportedEventRejectionMessage(eventCode: string): string {
  const code = eventCode.toUpperCase().trim();

  if (code === 'T0001') {
    return 'Mass Pay payout disbursement (T0001) is an outbound non-order disbursement and is excluded from customer payment reconciliation.';
  }
  if (/^T01\d\d$/.test(code)) {
    return `Merchant/partner processing fee event (${code}) is an operating fee, not a customer payment capture, and is excluded from customer payment reconciliation.`;
  }
  if (code === 'T0200' || code === 'T0201') {
    return `Currency conversion balance exchange event (${code}) is an internal balance foreign exchange redenomination, not a customer fee or payment, and is excluded from customer payment reconciliation.`;
  }
  if (code === 'T0300' || code === 'T0301' || code === 'T0302' || code === 'T0303') {
    return `Account funding/bank deposit event (${code}) is an inbound merchant balance deposit, not a customer payment or outbound payout, and is excluded from customer payment reconciliation.`;
  }
  if (code === 'T0400') {
    return 'Bank withdrawal event (T0400) is an outbound merchant balance sweep to an external bank, not a customer payment authorization, and is excluded from customer payment reconciliation.';
  }
  if (code === 'T1105') {
    return 'Reversal of general account hold (T1105) is an internal balance hold release, not a customer payment reversal, and is excluded from customer payment reconciliation.';
  }
  if (code === 'T1108') {
    return 'Fee reversal (T1108) is a partner fee adjustment, not a customer payment reversal, and is excluded from customer payment reconciliation.';
  }
  if (code === 'T1202') {
    return 'Chargeback reversal/reimbursement (T1202) represents merchant reimbursement following a resolved dispute, not an active dispute hold, and is excluded from customer payment reconciliation.';
  }
  if (code === 'T1203') {
    return 'Charge-off adjustment (T1203) represents bad-debt accounting adjustment, not an active dispute hold, and is excluded from customer payment reconciliation.';
  }
  if (code === 'T1302') {
    return 'Authorization void (T1302) is an authorization cancellation and is excluded from customer payment reconciliation.';
  }

  return `Unsupported or unmapped PayPal transaction event code: "${eventCode || 'EMPTY'}".`;
}

/**
 * Maps PayPal transaction status code to CloseLoop TransactionStatus.
 * Official PayPal Reporting codes:
 * S = Successfully completed
 * P = Pending
 * D = Denied
 * V = Fully reversed
 *
 * Status "F" is NOT an official PayPal Reporting Transaction Search status and is rejected.
 */
export function mapPayPalStatus(rawStatus?: string): TransactionStatus | null {
  if (!rawStatus) return null;
  const s = rawStatus.toUpperCase().trim();
  switch (s) {
    case 'S':
    case 'COMPLETED':
    case 'SUCCESS':
    case 'CLEARED':
      return 'COMPLETED';
    case 'P':
    case 'PENDING':
    case 'IN_PROGRESS':
    case 'PROCESSING':
      return 'PENDING';
    case 'D':
    case 'DENIED':
    case 'DECLINED':
      return 'DENIED';
    case 'V':
    case 'REVERSED':
      return 'REVERSED';
    default:
      // Status 'F' (failed), 'REFUNDED' (conflating event with status), or unknown strings
      return null;
  }
}

/**
 * Validates and normalizes an RFC 3339 timestamp.
 */
function validateIsoTimestamp(timestampStr?: string): string | null {
  if (!timestampStr) return null;
  const d = new Date(timestampStr);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Normalizes a single PayPal transaction detail item into CloseLoop's PaymentTransaction domain model.
 *
 * Rules:
 * 1. Strict allowlist verification against CUSTOMER_PAYMENT_EVENT_CODES. Non-order account movements rejected.
 * 2. Official PayPal Reporting status contract (S, P, D, V only; F rejected).
 * 3. Exact integer minor-unit conversion via parseDecimalToMoney without floating point.
 * 4. Directional Consistency Gate:
 *    - CAPTURE and AUTHORIZATION must have positive amounts (> 0).
 *    - REFUND, REVERSAL, and DISPUTE_HOLD must have negative amounts (< 0).
 * 5. Deterministic composite record ID derived solely from immutable source fields.
 *    Independent of array index, page numbers, or response order.
 * 6. Preserves raw PayPal transaction ID, reference ID, reference type, and event code.
 */
export function normalizePayPalTransactionDetail(
  detail: PayPalTransactionDetail
): NormalizationResult {
  const info = detail.transaction_info;

  // 1. Transaction ID check
  const rawTxnId = info.transaction_id?.trim();
  if (!rawTxnId) {
    return {
      success: false,
      status: 'REJECTED',
      reason: 'MISSING_TRANSACTION_ID',
      message: 'Transaction item is missing required transaction_id.',
      rawDetail: detail,
    };
  }

  // 2. Event code check against strict customer-payment allowlist
  const eventCode = (info.transaction_event_code || '').toUpperCase().trim();
  const transactionType = CUSTOMER_PAYMENT_EVENT_CODES[eventCode];
  if (!transactionType) {
    return {
      success: false,
      status: 'REJECTED',
      reason: 'UNSUPPORTED_EVENT_CODE',
      message: getUnsupportedEventRejectionMessage(eventCode),
      rawDetail: detail,
    };
  }

  // 3. Status mapping (official contract: S, P, D, V)
  const transactionStatus = mapPayPalStatus(info.transaction_status);
  if (!transactionStatus) {
    const rawStatus = (info.transaction_status || '').toUpperCase().trim();
    const isF = rawStatus === 'F' || rawStatus === 'FAILED';
    return {
      success: false,
      status: 'REJECTED',
      reason: 'UNMAPPED_STATUS',
      message: isF
        ? 'Unmapped PayPal transaction status: "F". Status "F" is not an official PayPal reporting status (valid statuses: S, P, D, V).'
        : `Unmapped or unknown PayPal transaction status: "${info.transaction_status || 'EMPTY'}". Official reporting statuses are S (COMPLETED), P (PENDING), D (DENIED), and V (REVERSED).`,
      rawDetail: detail,
    };
  }

  // 4. Timestamp validation
  const rawDate = info.transaction_initiation_date || info.transaction_updated_date;
  const transactionTime = validateIsoTimestamp(rawDate);
  if (!transactionTime) {
    return {
      success: false,
      status: 'REJECTED',
      reason: 'INVALID_TIMESTAMP',
      message: `Invalid or unparseable transaction timestamp: "${rawDate || 'EMPTY'}".`,
      rawDetail: detail,
    };
  }

  // 5. Currency and Amount validation (strict minor units)
  const currency = info.transaction_amount.currency_code.toUpperCase().trim();
  let grossAmount;
  try {
    grossAmount = parseDecimalToMoney(info.transaction_amount.value, currency);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'REJECTED',
      reason: 'INVALID_AMOUNT',
      message:
        err instanceof Error
          ? err.message
          : `Failed to parse monetary gross amount: "${info.transaction_amount.value}".`,
      rawDetail: detail,
    };
  }

  // 6. Directional Consistency Gate
  // Reconciling customer payments requires unambiguous financial direction:
  // - CAPTURE: Positive merchant credit (> 0 minor units).
  // - AUTHORIZATION: Positive hold amount (> 0 minor units).
  // - REFUND, REVERSAL, DISPUTE_HOLD: Negative merchant debit (< 0 minor units).
  if (transactionType === 'CAPTURE') {
    if (grossAmount.amountMinor <= 0) {
      return {
        success: false,
        status: 'REJECTED',
        reason: 'INVALID_AMOUNT',
        message: `Directional conflict: CAPTURE transaction must have a positive gross amount (> 0). Received: ${info.transaction_amount.value} ${currency}.`,
        rawDetail: detail,
      };
    }
  } else if (transactionType === 'AUTHORIZATION') {
    if (grossAmount.amountMinor <= 0) {
      return {
        success: false,
        status: 'REJECTED',
        reason: 'INVALID_AMOUNT',
        message: `Directional conflict: AUTHORIZATION transaction must have a positive gross amount (> 0). Received: ${info.transaction_amount.value} ${currency}.`,
        rawDetail: detail,
      };
    }
  } else if (
    transactionType === 'REFUND' ||
    transactionType === 'REVERSAL' ||
    transactionType === 'DISPUTE_HOLD'
  ) {
    if (grossAmount.amountMinor >= 0) {
      return {
        success: false,
        status: 'REJECTED',
        reason: 'INVALID_AMOUNT',
        message: `Directional conflict: ${transactionType} transaction must have a negative gross amount (< 0). Received: ${info.transaction_amount.value} ${currency}.`,
        rawDetail: detail,
      };
    }
  }

  // 7. Optional Fee Amount
  let feeAmount;
  if (info.fee_amount?.value) {
    try {
      feeAmount = parseDecimalToMoney(info.fee_amount.value, currency);
    } catch {
      // Fee parsing failure does not invalidate transaction if gross is valid
    }
  }

  // 8. Optional Net Amount
  let netAmount;
  if (info.net_amount?.value) {
    try {
      netAmount = parseDecimalToMoney(info.net_amount.value, currency);
    } catch {
      // Net parsing failure
    }
  }

  // 9. Stable Identity & Reference Preservation
  // Composite record ID is constructed strictly from immutable source attributes:
  // rawTxnId, eventCode, transactionStatus, transactionTime, currency, exact amount string, and optional reference.
  // It contains ZERO dependency on page-local array index, loop order, or pagination boundaries.
  // This guarantees stable identity across repeated normalization passes, queries, and pagination slices.
  const refPart = info.paypal_reference_id
    ? `:${info.paypal_reference_id_type || 'REF'}_${info.paypal_reference_id.trim()}`
    : '';
  const compositeId = `PP_${rawTxnId}:${eventCode}:${transactionStatus}:${transactionTime}:${currency}_${info.transaction_amount.value}${refPart}`;

  const paypalCaptureId = info.paypal_reference_id || rawTxnId;
  const paypalOrderId =
    info.paypal_reference_id_type === 'ODR'
      ? info.paypal_reference_id
      : undefined;

  const invoiceId = info.invoice_id?.trim() || undefined;
  const merchantReference =
    info.custom_field?.trim() || info.invoice_id?.trim() || undefined;

  const transaction: PaymentTransaction = {
    id: compositeId,
    paypalTransactionId: rawTxnId,
    paypalOrderId,
    paypalCaptureId,
    invoiceId,
    merchantReference,
    grossAmount,
    feeAmount,
    netAmount,
    currency,
    transactionType,
    transactionStatus,
    transactionTime,
    source: 'PAYPAL_API',
    rawReference: `PAYPAL_API:${rawTxnId}:${eventCode}`,
  };

  return {
    success: true,
    status: 'NORMALIZED',
    transaction,
    rawDetail: detail,
  };
}

/**
 * Batch normalization of an array of PayPal transaction details.
 */
export function normalizePayPalBatch(
  details: PayPalTransactionDetail[]
): {
  normalized: PaymentTransaction[];
  rejected: Array<{
    reason: string;
    message: string;
    rawDetail: PayPalTransactionDetail;
  }>;
  totalInput: number;
} {
  const normalized: PaymentTransaction[] = [];
  const rejected: Array<{
    reason: string;
    message: string;
    rawDetail: PayPalTransactionDetail;
  }> = [];

  details.forEach((detail) => {
    const outcome = normalizePayPalTransactionDetail(detail);
    if (outcome.success) {
      normalized.push(outcome.transaction);
    } else {
      rejected.push({
        reason: outcome.reason,
        message: outcome.message,
        rawDetail: outcome.rawDetail,
      });
    }
  });

  return {
    normalized,
    rejected,
    totalInput: details.length,
  };
}
