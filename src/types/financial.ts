/**
 * Core Financial Domain Types
 * Strict minor unit representation to prevent floating-point inaccuracies.
 */

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'CAD'
  | 'AUD'
  | 'JPY'
  | 'CHF'
  | 'SGD'
  | 'NZD'
  | 'HKD'
  | 'SEK'
  | 'NOK'
  | 'BHD'
  | 'KWD'
  | 'OMR'
  | 'JOD'
  | 'TND'
  | (string & {});

export interface Money {
  /**
   * The integer amount in the minor unit of the currency.
   * e.g., 1050 for $10.50 USD, 500 for ¥500 JPY, 12500 for 12.500 BHD.
   */
  amountMinor: number;
  /** ISO 4217 Currency Code */
  currency: string;
  /** Decimal precision: 2 for USD/EUR, 0 for JPY, 3 for BHD */
  precision: number;
}

export type OrderStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'FULFILLED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PaymentStatus =
  | 'UNPAID'
  | 'AUTHORIZED'
  | 'PAID'
  | 'PARTIALLY_PAID'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'FAILED';

export interface MerchantOrder {
  id: string;
  merchantOrderId: string;
  externalReference: string;
  expectedAmount: Money;
  currency: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  customerReference?: string; // PII-masked in UI
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  source: string;
  metadata: Record<string, unknown>;
}

export type TransactionType =
  | 'CAPTURE'
  | 'AUTHORIZATION'
  | 'REFUND'
  | 'REVERSAL'
  | 'VOID'
  | 'FEE'
  | 'DISPUTE_HOLD'
  | 'PAYOUT';

export type TransactionStatus =
  | 'COMPLETED'
  | 'PENDING'
  | 'DENIED'
  | 'REVERSED'
  | 'REFUNDED'
  | 'VOIDED'
  | 'FAILED';

export interface PaymentTransaction {
  id: string;
  paypalTransactionId: string;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  invoiceId?: string;
  merchantReference?: string;
  grossAmount: Money;
  feeAmount?: Money;
  netAmount?: Money;
  currency: string;
  transactionType: TransactionType;
  transactionStatus: TransactionStatus;
  transactionTime: string; // ISO 8601
  source: 'PAYPAL_EXPORT' | 'PAYPAL_API' | 'SANDBOX_FIXTURE';
  rawReference: string; // Safe reference to original imported record/row
}

export type MatchStatus =
  | 'UNPROCESSED'
  | 'MATCHED'
  | 'DISCREPANCY'
  | 'UNMATCHED_ORDER'
  | 'UNMATCHED_TRANSACTION'
  | 'AMBIGUOUS';

export type DiscrepancyType =
  | 'NONE'
  | 'FEE_VARIANCE'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'PARTIAL_REFUND_MISMATCH'
  | 'FULL_REFUND_SETTLEMENT'
  | 'EXCHANGE_RATE_SLIPPAGE'
  | 'TIMING_DELAY'
  | 'DISPUTE_HOLD'
  | 'MULTI_CAPTURE_VARIANCE'
  | 'MISSING_PAYMENT'
  | 'MISSING_METADATA'
  | 'CONFLICTING_REFERENCES'
  | 'UNEXPECTED_STATUS';

export type MatchConfidence =
  | 'EXACT_AUTHORITATIVE'
  | 'COMPOSITE_CONFIRMED'
  | 'HIGH_CONFIDENCE_CANDIDATE'
  | 'LOW_CONFIDENCE_CANDIDATE'
  | 'MANUAL_REVIEW_REQUIRED';

export type MatchingMethod =
  | 'AUTHORITATIVE_IDENTIFIER'
  | 'COMPOSITE_HEURISTIC'
  | 'MULTI_CAPTURE_RULE'
  | 'UNMATCHED_DEFAULT';

export interface ComparedField {
  field: string;
  orderValue: string;
  transactionValue: string;
  matched: boolean;
}

export interface MatchingEvidence {
  orderId?: string;
  transactionIds: string[];
  matchingMethod: MatchingMethod;
  matchingRule: string;
  comparedFields: ComparedField[];
  amountComparison: {
    expectedAmountMinor: number;
    actualAmountMinor: number;
    varianceMinor: number;
    currency: string;
    isExactMatch: boolean;
  };
  currencyComparison: {
    orderCurrency: string;
    transactionCurrency: string;
    matches: boolean;
  };
  timestampComparison?: {
    orderTimestamp: string;
    transactionTimestamp: string;
    differenceSeconds: number;
    toleranceWindowSeconds: number;
    withinTolerance: boolean;
  };
  reasonsForAccepting: string[];
  reasonsForRejectingCandidates: string[];
}

export interface ReconciliationRecord {
  id: string;
  orderId?: string;
  transactionIds: string[];
  matchStatus: MatchStatus;
  discrepancyType: DiscrepancyType;
  confidence: MatchConfidence;
  matchingMethod: MatchingMethod;
  expectedAmount: Money;
  actualAmount: Money;
  varianceAmount: Money;
  currency: string;
  evidence: MatchingEvidence;
  createdAt: string; // ISO 8601
}

export interface ReconciliationRun {
  id: string;
  startedAt: string;
  completedAt: string;
  totalOrders: number;
  totalTransactions: number;
  matchedCount: number;
  unmatchedOrderCount: number;
  unmatchedTransactionCount: number;
  exceptionCount: number;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  datasetReferences: {
    ordersFileId?: string;
    transactionsFileId?: string;
    orderCount: number;
    transactionCount: number;
  };
  records: ReconciliationRecord[];
}

// Backwards compatibility with Phase 1 types
export interface NormalizedTransaction {
  id: string;
  source: 'PAYPAL' | 'MERCHANT_LEDGER';
  externalId: string;
  orderId?: string;
  invoiceId?: string;
  grossAmount: Money;
  feeAmount?: Money;
  netAmount?: Money;
  status: string;
  timestamp: string;
  payerEmailMasked?: string;
  description?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface ReconciliationBatch {
  id: string;
  batchName: string;
  periodStart: string;
  periodEnd: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalTransactionsCount: number;
  matchedCount: number;
  discrepancyCount: number;
  unmatchedCount: number;
  createdAt: string;
  completedAt?: string;
}
