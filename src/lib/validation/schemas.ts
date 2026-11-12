import { z } from 'zod';

export const MoneySchema = z.object({
  amountMinor: z.number().int().refine((val) => Math.abs(val) <= Number.MAX_SAFE_INTEGER, {
    message: 'Amount exceeds safe integer range',
  }),
  currency: z.string().min(3).max(3).toUpperCase(),
  precision: z.number().int().min(0).max(4),
});

export const OrderStatusSchema = z.enum([
  'CREATED',
  'CONFIRMED',
  'FULFILLED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);

export const PaymentStatusSchema = z.enum([
  'UNPAID',
  'AUTHORIZED',
  'PAID',
  'PARTIALLY_PAID',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'FAILED',
]);

export const MerchantOrderSchema = z.object({
  id: z.string().min(1),
  merchantOrderId: z.string().min(1),
  externalReference: z.string().min(1),
  expectedAmount: MoneySchema,
  currency: z.string().min(3).max(3).toUpperCase(),
  createdAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  updatedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  customerReference: z.string().optional(),
  orderStatus: OrderStatusSchema,
  paymentStatus: PaymentStatusSchema,
  source: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const TransactionTypeSchema = z.enum([
  'CAPTURE',
  'AUTHORIZATION',
  'REFUND',
  'REVERSAL',
  'VOID',
  'FEE',
  'DISPUTE_HOLD',
  'PAYOUT',
]);

export const TransactionStatusSchema = z.enum([
  'COMPLETED',
  'PENDING',
  'DENIED',
  'REVERSED',
  'REFUNDED',
  'VOIDED',
  'FAILED',
]);

export const PaymentTransactionSchema = z.object({
  id: z.string().min(1),
  paypalTransactionId: z.string().min(1),
  paypalOrderId: z.string().optional(),
  paypalCaptureId: z.string().optional(),
  invoiceId: z.string().optional(),
  merchantReference: z.string().optional(),
  grossAmount: MoneySchema,
  feeAmount: MoneySchema.optional(),
  netAmount: MoneySchema.optional(),
  currency: z.string().min(3).max(3).toUpperCase(),
  transactionType: TransactionTypeSchema,
  transactionStatus: TransactionStatusSchema,
  transactionTime: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)),
  source: z.enum(['PAYPAL_EXPORT', 'PAYPAL_API', 'SANDBOX_FIXTURE']),
  rawReference: z.string().min(1),
});

export const MatchStatusSchema = z.enum([
  'UNPROCESSED',
  'MATCHED',
  'DISCREPANCY',
  'UNMATCHED_ORDER',
  'UNMATCHED_TRANSACTION',
  'AMBIGUOUS',
]);

export const DiscrepancyTypeSchema = z.enum([
  'NONE',
  'FEE_VARIANCE',
  'AMOUNT_MISMATCH',
  'CURRENCY_MISMATCH',
  'PARTIAL_REFUND_MISMATCH',
  'FULL_REFUND_SETTLEMENT',
  'EXCHANGE_RATE_SLIPPAGE',
  'TIMING_DELAY',
  'DISPUTE_HOLD',
  'MULTI_CAPTURE_VARIANCE',
  'MISSING_PAYMENT',
  'MISSING_METADATA',
  'CONFLICTING_REFERENCES',
  'UNEXPECTED_STATUS',
]);

export const MatchConfidenceSchema = z.enum([
  'EXACT_AUTHORITATIVE',
  'COMPOSITE_CONFIRMED',
  'HIGH_CONFIDENCE_CANDIDATE',
  'LOW_CONFIDENCE_CANDIDATE',
  'MANUAL_REVIEW_REQUIRED',
]);

export const MatchingMethodSchema = z.enum([
  'AUTHORITATIVE_IDENTIFIER',
  'COMPOSITE_HEURISTIC',
  'MULTI_CAPTURE_RULE',
  'UNMATCHED_DEFAULT',
]);

export const ComparedFieldSchema = z.object({
  field: z.string(),
  orderValue: z.string(),
  transactionValue: z.string(),
  matched: z.boolean(),
});

export const MatchingEvidenceSchema = z.object({
  orderId: z.string().optional(),
  transactionIds: z.array(z.string()),
  matchingMethod: MatchingMethodSchema,
  matchingRule: z.string(),
  comparedFields: z.array(ComparedFieldSchema),
  amountComparison: z.object({
    expectedAmountMinor: z.number().int(),
    actualAmountMinor: z.number().int(),
    varianceMinor: z.number().int(),
    currency: z.string(),
    isExactMatch: z.boolean(),
  }),
  currencyComparison: z.object({
    orderCurrency: z.string(),
    transactionCurrency: z.string(),
    matches: z.boolean(),
  }),
  timestampComparison: z
    .object({
      orderTimestamp: z.string(),
      transactionTimestamp: z.string(),
      differenceSeconds: z.number(),
      toleranceWindowSeconds: z.number(),
      withinTolerance: z.boolean(),
    })
    .optional(),
  reasonsForAccepting: z.array(z.string()),
  reasonsForRejectingCandidates: z.array(z.string()),
});

export const ReconciliationRecordSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().optional(),
  transactionIds: z.array(z.string()),
  matchStatus: MatchStatusSchema,
  discrepancyType: DiscrepancyTypeSchema,
  confidence: MatchConfidenceSchema,
  matchingMethod: MatchingMethodSchema,
  expectedAmount: MoneySchema,
  actualAmount: MoneySchema,
  varianceAmount: MoneySchema,
  currency: z.string().min(3).max(3).toUpperCase(),
  evidence: MatchingEvidenceSchema,
  createdAt: z.string(),
});

export const ReconciliationRunSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  totalOrders: z.number().int().nonnegative(),
  totalTransactions: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  unmatchedOrderCount: z.number().int().nonnegative(),
  unmatchedTransactionCount: z.number().int().nonnegative(),
  exceptionCount: z.number().int().nonnegative(),
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  datasetReferences: z.object({
    ordersFileId: z.string().optional(),
    transactionsFileId: z.string().optional(),
    orderCount: z.number().int().nonnegative(),
    transactionCount: z.number().int().nonnegative(),
  }),
  records: z.array(ReconciliationRecordSchema),
});

export const ApprovalReviewSchema = z.object({
  actionId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  reviewedBy: z.string().min(1),
  rejectionReason: z.string().optional(),
});

export const ReconciliationFilterSchema = z.object({
  batchId: z.string().optional(),
  status: z.enum(['ALL', 'MATCHED', 'DISCREPANCY', 'UNMATCHED']).optional(),
  currency: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(100).default(50),
});
