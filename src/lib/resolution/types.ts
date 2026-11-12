/**
/**
 * CloseLoop Phase 3D.3: Deterministic Resolution Recommendations & Action Catalog Types
 * Strongly typed interfaces for operator recommendations, action catalog, uncertainty scoring, and safety boundaries.
 */

import { DiscrepancyType } from '@/types/financial';
import { EvidenceType } from '@/lib/exceptions/types';

export const MANDATORY_RESOLUTION_DISCLAIMER =
  'Advisory recommendation only. No financial action has been executed.';

export type ActionCatalogId =
  | 'VERIFY_PAYMENT_REFERENCE'
  | 'WAIT_FOR_SETTLEMENT'
  | 'REQUEST_MERCHANT_DOCUMENTATION'
  | 'REVIEW_REFUND_STATUS'
  | 'INVESTIGATE_AMOUNT_VARIANCE'
  | 'REVIEW_DUPLICATE_PAYMENT'
  | 'ESCALATE_FOR_MANUAL_REVIEW'
  | 'REVIEW_CASE_EVIDENCE';

export type ResolutionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type UncertaintyLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';

export type RecommendationVisualState =
  | 'RECOMMENDED'
  | 'REQUIRES_VERIFICATION'
  | 'HIGH_UNCERTAINTY'
  | 'EVIDENCE_STALE'
  | 'MANUAL_REVIEW_REQUIRED';

export interface ActionCatalogEntry {
  actionId: ActionCatalogId;
  title: string;
  description: string;
  supportedDiscrepancies: Array<DiscrepancyType | string>;
  preconditions: string[];
  contraindications: string[];
  requiredEvidenceTypes: EvidenceType[];
  expectedOperatorOutcome: string;
  riskLevel: ResolutionRiskLevel;
  requiresHumanReview: boolean;
}

export interface UncertaintyFactor {
  factor: string;
  scoreContribution: number; // e.g. +20
  reason: string;
}

export interface UncertaintyAssessment {
  score: number; // 0 to 100
  level: UncertaintyLevel;
  factors: UncertaintyFactor[];
  isSuppressedOrDemoted: boolean;
  suppressionReason?: string;
}

export interface EvaluatedRecommendation {
  id: string; // Deterministic UUID or stable ID
  caseId: string;
  merchantId: string;
  caseVersion: number;
  evidenceFingerprint: string | null;
  actionId: ActionCatalogId;
  title: string;
  description: string;
  explanation: string;
  preconditionsSatisfied: string[];
  contraindicationsChecked: string[];
  missingInformation: string[];
  supportingEvidenceIds: string[];
  uncertainty: UncertaintyAssessment;
  riskLevel: ResolutionRiskLevel;
  requiresHumanReview: boolean;
  isPrimary: boolean;
  visualState: RecommendationVisualState;
  createdAt: string; // ISO 8601
  disclaimer: string;
}

export interface CaseRecommendationsResult {
  caseId: string;
  merchantId: string;
  caseVersion: number;
  evidenceFingerprint: string | null;
  isEvidenceStale: boolean;
  hasInvestigation: boolean;
  investigationStatus: string | null;
  recommendations: EvaluatedRecommendation[];
  evaluatedAt: string; // ISO 8601
  disclaimer: string;
}

