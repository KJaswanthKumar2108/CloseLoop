/**
 * CloseLoop Phase 3D.3: Resolution Validation Schemas
 * Zod schemas for validating action catalog IDs, recommendations, uncertainty scores, and API responses.
 */

import { z } from 'zod';
import { MANDATORY_RESOLUTION_DISCLAIMER } from './types';

export const ActionCatalogIdSchema = z.enum([
  'VERIFY_PAYMENT_REFERENCE',
  'WAIT_FOR_SETTLEMENT',
  'REQUEST_MERCHANT_DOCUMENTATION',
  'REVIEW_REFUND_STATUS',
  'INVESTIGATE_AMOUNT_VARIANCE',
  'REVIEW_DUPLICATE_PAYMENT',
  'ESCALATE_FOR_MANUAL_REVIEW',
  'REVIEW_CASE_EVIDENCE',
]);

export const ResolutionRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const UncertaintyLevelSchema = z.enum(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']);

export const RecommendationVisualStateSchema = z.enum([
  'RECOMMENDED',
  'REQUIRES_VERIFICATION',
  'HIGH_UNCERTAINTY',
  'EVIDENCE_STALE',
  'MANUAL_REVIEW_REQUIRED',
]);

export const UncertaintyFactorSchema = z.object({
  factor: z.string().min(1),
  scoreContribution: z.number().int().min(0).max(100),
  reason: z.string().min(1),
});

export const UncertaintyAssessmentSchema = z.object({
  score: z.number().int().min(0).max(100),
  level: UncertaintyLevelSchema,
  factors: z.array(UncertaintyFactorSchema),
  isSuppressedOrDemoted: z.boolean(),
  suppressionReason: z.string().optional(),
});

export const EvaluatedRecommendationSchema = z.object({
  id: z.string().min(1),
  caseId: z.string().uuid(),
  merchantId: z.string().min(1),
  caseVersion: z.number().int().min(1),
  evidenceFingerprint: z.string().nullable(),
  actionId: ActionCatalogIdSchema,
  title: z.string().min(3),
  description: z.string().min(5),
  explanation: z.string().min(10),
  preconditionsSatisfied: z.array(z.string()),
  contraindicationsChecked: z.array(z.string()),
  missingInformation: z.array(z.string()),
  supportingEvidenceIds: z.array(z.string()),
  uncertainty: UncertaintyAssessmentSchema,
  riskLevel: ResolutionRiskLevelSchema,
  requiresHumanReview: z.boolean(),
  isPrimary: z.boolean(),
  visualState: RecommendationVisualStateSchema,
  createdAt: z.string().datetime(),
  disclaimer: z.string().refine((val) => val.includes('Advisory recommendation only'), {
    message: 'Mandatory advisory disclaimer must be present.',
  }),
});

export const CaseRecommendationsResultSchema = z.object({
  caseId: z.string().uuid(),
  merchantId: z.string().min(1),
  caseVersion: z.number().int().min(1),
  evidenceFingerprint: z.string().nullable(),
  isEvidenceStale: z.boolean(),
  hasInvestigation: z.boolean(),
  investigationStatus: z.string().nullable(),
  recommendations: z.array(EvaluatedRecommendationSchema),
  evaluatedAt: z.string().datetime(),
  disclaimer: z.literal(MANDATORY_RESOLUTION_DISCLAIMER),
});

