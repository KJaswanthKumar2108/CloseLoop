/**
 * CloseLoop Phase 3D.4: Approval Schemas
 * Runtime validation schemas for approval requests, decisions, and audit models.
 */

import { z } from 'zod';
import { ActionCatalogIdSchema } from '@/lib/resolution/schemas';

export const ApprovalStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
]);

export const ApprovalEventTypeSchema = z.enum([
  'APPROVAL_REQUESTED',
  'APPROVAL_GRANTED',
  'APPROVAL_REJECTED',
  'APPROVAL_EXPIRED',
  'APPROVAL_INVALIDATED',
  'APPROVAL_STALE',
]);

export const CreateApprovalRequestSchema = z.object({
  recommendationId: z.string().min(1, 'recommendationId is required'),
  actionId: ActionCatalogIdSchema,
  actionParameters: z.record(z.string(), z.unknown()).default({}),
  caseVersion: z.number().int().min(1, 'caseVersion must be >= 1'),
  evidenceFingerprint: z
    .string()
    .length(64, 'evidenceFingerprint must be a 64-character SHA-256 hex string'),
  expiresInHours: z.number().int().min(1).max(168).default(48),
});

export const DecideApprovalRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z
    .string()
    .min(5, 'Decision reason must be at least 5 characters')
    .max(1000, 'Decision reason must not exceed 1000 characters'),
});

export const CaseApprovalResponseSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().min(1),
  caseId: z.string().uuid(),
  recommendationId: z.string().min(1),
  actionId: z.string().min(1),
  actionParameters: z.record(z.string(), z.unknown()),
  caseVersion: z.number().int().min(1),
  evidenceFingerprint: z.string().length(64),
  canonicalBindingHash: z.string().length(64),
  status: ApprovalStatusSchema,
  requestedBy: z.string().min(1),
  decidedBy: z.string().nullable(),
  decisionReason: z.string().nullable(),
  decisionTimestamp: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  displayLabel: z.string().optional(),
  disclaimer: z.string(),
});

export const ApprovalAuditEventResponseSchema = z.object({
  id: z.string().uuid(),
  merchantId: z.string().min(1),
  caseId: z.string().uuid(),
  approvalId: z.string().uuid(),
  actorId: z.string().min(1),
  eventType: ApprovalEventTypeSchema,
  canonicalPayload: z.record(z.string(), z.unknown()),
  previousEventHash: z.string().length(64),
  eventHash: z.string().length(64),
  createdAt: z.string().datetime(),
});

export const HashChainVerificationSchema = z.object({
  isValid: z.boolean(),
  totalEvents: z.number().int().min(0),
  invalidEventIndex: z.number().int().optional(),
  invalidEventId: z.string().uuid().optional(),
  expectedHash: z.string().optional(),
  actualHash: z.string().optional(),
  failureReason: z.string().optional(),
});
