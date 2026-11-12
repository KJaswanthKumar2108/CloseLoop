/**
 * CloseLoop Phase 3D.4: Human Approval & Tamper-Evident Audit Types
 * Strongly typed contracts for approval requests, cryptographic parameter binding, and hash-chained audit events.
 */

export const MANDATORY_APPROVAL_DISCLAIMER =
  'Approval granted. No financial action has been executed.';

export const APPROVED_AWAITING_EXECUTION_LABEL =
  'APPROVED — AWAITING CONTROLLED EXECUTION';

export type ApprovalStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export type ApprovalEventType =
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'APPROVAL_EXPIRED'
  | 'APPROVAL_INVALIDATED'
  | 'APPROVAL_STALE';

export interface CaseApprovalRecord {
  id: string; // UUID
  merchantId: string;
  caseId: string; // UUID
  recommendationId: string;
  actionId: string;
  actionParameters: Record<string, unknown>;
  caseVersion: number;
  evidenceFingerprint: string;
  canonicalBindingHash: string; // SHA-256 hex string (64 characters)
  status: ApprovalStatus;
  requestedBy: string;
  decidedBy: string | null;
  decisionReason: string | null;
  decisionTimestamp: string | null;
  createdAt: string; // ISO 8601
  expiresAt: string; // ISO 8601
}

export interface ApprovalAuditEventRecord {
  id: string; // UUID
  merchantId: string;
  caseId: string; // UUID
  approvalId: string; // UUID
  actorId: string;
  eventType: ApprovalEventType;
  canonicalPayload: Record<string, unknown>;
  previousEventHash: string; // SHA-256 hex string (64 characters)
  eventHash: string; // SHA-256 hex string (64 characters)
  createdAt: string; // ISO 8601
}

export interface CanonicalApprovalBindingPayload {
  approvalRequestId: string;
  merchantId: string;
  caseId: string;
  recommendationId: string;
  actionId: string;
  actionParameters: Record<string, unknown>;
  caseVersion: number;
  evidenceFingerprint: string;
  createdAt: string;
  expiresAt: string;
}

export interface HashChainVerificationResult {
  isValid: boolean;
  totalEvents: number;
  invalidEventIndex?: number;
  invalidEventId?: string;
  expectedHash?: string;
  actualHash?: string;
  failureReason?: string;
}

export interface CreateApprovalParams {
  merchantId: string;
  caseId: string;
  recommendationId: string;
  actionId: string;
  actionParameters?: Record<string, unknown>;
  caseVersion: number;
  evidenceFingerprint: string;
  requestedBy: string;
  expiresInHours?: number; // default 48h
}

export interface DecideApprovalParams {
  approvalId: string;
  merchantId: string;
  decision: 'APPROVE' | 'REJECT';
  decidedBy: string;
  decisionReason: string;
}

