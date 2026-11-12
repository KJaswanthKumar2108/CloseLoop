/**
 * CloseLoop Phase 3D.1: Exception Intelligence Validation Schemas
 * Zod schemas for API route validation, query parameters, and entity parsing.
 */

import { z } from 'zod';
import { MerchantOrderSchema } from '@/lib/validation/schemas';

export const ExceptionCaseStatusSchema = z.enum([
  'OPEN',
  'INVESTIGATING',
  'PENDING_APPROVAL',
  'RESOLVED',
  'CLOSED_DISMISSED',
  'ESCALATED',
]);

export const EvidenceTypeSchema = z.enum([
  'MERCHANT_ORDER',
  'PAYPAL_TRANSACTION',
  'RECONCILIATION_MATCH',
  'REJECTED_RECORD',
  'COLLISION_RECORD',
]);

export const EvidenceSourceSystemSchema = z.enum([
  'MERCHANT_CSV',
  'MERCHANT_API',
  'PAYPAL_DURABLE_LEDGER',
  'RECONCILIATION_ENGINE',
]);

export const UUIDSchema = z.string().uuid({
  message: 'Invalid UUID format',
});

export const TenantIdSchema = z
  .string()
  .min(1, 'Tenant ID must not be empty')
  .max(100, 'Tenant ID cannot exceed 100 characters')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Tenant ID must contain only alphanumeric characters, underscores, or dashes');

/**
 * Money schema for integer minor units.
 */
export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().length(3),
  precision: z.number().int().min(0).max(4),
});

/**
 * Reconciliation Record Schema (subset required for case extraction).
 */
export const ReconciliationRecordInputSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().optional(),
  transactionIds: z.array(z.string()),
  matchStatus: z.string(),
  discrepancyType: z.string(),
  confidence: z.string(),
  matchingMethod: z.string(),
  expectedAmount: MoneySchema,
  actualAmount: MoneySchema,
  varianceAmount: MoneySchema,
  currency: z.string().length(3),
  evidence: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

/**
 * Reconciliation Run Input Schema for POST /api/exceptions/cases
 */
export const ReconciliationRunInputSchema = z.object({
  id: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string(),
  totalOrders: z.number().int().nonnegative(),
  totalTransactions: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  unmatchedOrderCount: z.number().int().nonnegative(),
  unmatchedTransactionCount: z.number().int().nonnegative(),
  exceptionCount: z.number().int().nonnegative(),
  status: z.string(),
  datasetReferences: z.record(z.string(), z.unknown()).optional(),
  records: z.array(ReconciliationRecordInputSchema),
});

/**
 * Schema for POST /api/exceptions/cases
 */
export const CreateCasesRequestSchema = z.object({
  merchantId: TenantIdSchema.optional(),
  reconciliationRun: ReconciliationRunInputSchema,
  orders: z.array(MerchantOrderSchema).max(5000).optional(),
  transactions: z.array(z.record(z.string(), z.unknown())).max(5000).optional(),
});

/**
 * Schema for GET /api/exceptions/cases query parameters
 */
export const ListCasesQuerySchema = z.object({
  status: ExceptionCaseStatusSchema.optional(),
  discrepancyType: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

