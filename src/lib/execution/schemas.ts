/**
 * CloseLoop Phase 3D.5: Execution Schemas
 * Runtime validation schemas for controlled action execution and simulation requests.
 */

import { z } from 'zod';
import { ActionCatalogIdSchema } from '@/lib/resolution/schemas';
import { MANDATORY_SIMULATION_DISCLAIMER } from './types';

export const ExecutionModeSchema = z.enum(['DRY_RUN', 'PAYPAL_SANDBOX', 'LIVE']);

export const ExecutionStatusSchema = z.enum([
  'PENDING',
  'VALIDATING',
  'SIMULATED',
  'SUCCEEDED',
  'FAILED',
  'BLOCKED',
]);

export const ExecuteActionRequestSchema = z.object({
  executionMode: ExecutionModeSchema.default('DRY_RUN'),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .optional(),
  operatorConfirmation: z.boolean().default(true),
});

export const ExecutionResultSummarySchema = z.object({
  isSimulated: z.boolean(),
  disclaimer: z.string().default(MANDATORY_SIMULATION_DISCLAIMER),
  actionId: ActionCatalogIdSchema,
  actionTitle: z.string().min(1),
  executionMode: ExecutionModeSchema,
  simulatedOutcome: z.string().min(1),
  preconditionsVerified: z.array(z.string()),
  safetyAssertions: z.array(z.string()),
  simulatedLedgerImpact: z
    .object({
      accountDebited: z.string().optional(),
      accountCredited: z.string().optional(),
      amountMinor: z.number().int().optional(),
      currency: z.string().optional(),
      journalType: z.string().optional(),
      entryDescription: z.string().optional(),
    })
    .optional(),
  simulatedExternalCall: z
    .object({
      targetSystem: z.string(),
      mockEndpoint: z.string(),
      simulatedStatus: z.string(),
      note: z.string(),
    })
    .optional(),
  completedAt: z.string().datetime(),
});

export const CaseExecutionResponseSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().min(1),
  caseId: z.string().uuid(),
  approvalId: z.string().uuid(),
  recommendationId: z.string().min(1),
  actionId: z.string().min(1),
  executionMode: ExecutionModeSchema,
  idempotencyKey: z.string().min(1),
  parameterHash: z.string().length(64),
  status: ExecutionStatusSchema,
  resultSummary: ExecutionResultSummarySchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

