/**
 * CloseLoop Phase 3D.5: Controlled Execution Types
 * Strongly typed contracts for controlled resolution execution, dry runs, idempotency, and safety boundaries.
 */

import { ActionCatalogEntry } from '@/lib/resolution/types';
import { CaseApprovalRecord } from '@/lib/approvals/types';
import { ExceptionCaseDetail } from '@/lib/exceptions/types';

export const MANDATORY_SIMULATION_DISCLAIMER =
  'SIMULATED — NO FINANCIAL ACTION WAS EXECUTED.';

export const PAYPAL_SANDBOX_UNAVAILABLE_MESSAGE =
  'PayPal Sandbox Write API is unavailable in current deployment: CloseLoop operates under read-only ingest credentials. Controlled execution is performed via deterministic DRY RUN simulation.';

export const LIVE_EXECUTION_DISABLED_MESSAGE =
  'Live financial execution is strictly disabled. CloseLoop operates under safe advisory and controlled demonstration governance.';

export type ExecutionMode = 'DRY_RUN' | 'PAYPAL_SANDBOX' | 'LIVE';

export type ExecutionStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'SIMULATED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED';

export interface SimulatedLedgerImpact {
  accountDebited?: string;
  accountCredited?: string;
  amountMinor?: number;
  currency?: string;
  journalType?: string;
  entryDescription?: string;
}

export interface SimulatedExternalCall {
  targetSystem: string;
  mockEndpoint: string;
  simulatedStatus: string;
  note: string;
}

export interface ExecutionResultSummary {
  isSimulated: boolean;
  disclaimer: string;
  actionId: string;
  actionTitle: string;
  executionMode: ExecutionMode;
  simulatedOutcome: string;
  preconditionsVerified: string[];
  safetyAssertions: string[];
  simulatedLedgerImpact?: SimulatedLedgerImpact;
  simulatedExternalCall?: SimulatedExternalCall;
  completedAt: string; // ISO 8601
}

export interface CaseExecutionRecord {
  id: string; // UUID
  merchantId: string;
  caseId: string; // UUID
  approvalId: string; // UUID
  recommendationId: string;
  actionId: string;
  executionMode: ExecutionMode;
  idempotencyKey: string;
  parameterHash: string; // SHA-256 (64 hex characters)
  status: ExecutionStatus;
  resultSummary: ExecutionResultSummary;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string; // ISO 8601
  completedAt: string | null; // ISO 8601
}

export interface ExecuteActionParams {
  approvalId: string;
  merchantId: string;
  executionMode?: ExecutionMode; // Defaults to DRY_RUN
  idempotencyKey?: string;
  operatorId: string;
}

export interface ExecutionEligibilityResult {
  isEligible: boolean;
  rejectionReason?: string;
  rejectionCode?: string;
  approval?: CaseApprovalRecord;
  caseRecord?: ExceptionCaseDetail;
  catalogEntry?: ActionCatalogEntry;
}

