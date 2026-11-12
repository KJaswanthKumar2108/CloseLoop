/**
 * CloseLoop Phase 3D.1: Exception Intelligence & Evidence Aggregation
 * Core types for exception cases, evidence items, and tenant isolation.
 */

import {
  DiscrepancyType,
  Money,
} from '@/types/financial';

export type ExceptionCaseStatus =
  | 'OPEN'
  | 'INVESTIGATING'
  | 'PENDING_APPROVAL'
  | 'RESOLVED'
  | 'CLOSED_DISMISSED'
  | 'ESCALATED';

export type EvidenceType =
  | 'MERCHANT_ORDER'
  | 'PAYPAL_TRANSACTION'
  | 'RECONCILIATION_MATCH'
  | 'REJECTED_RECORD'
  | 'COLLISION_RECORD';

export type EvidenceSourceSystem =
  | 'MERCHANT_CSV'
  | 'MERCHANT_API'
  | 'PAYPAL_DURABLE_LEDGER'
  | 'RECONCILIATION_ENGINE';

/**
 * Database record for exception_cases table.
 */
export interface ExceptionCaseRecord {
  id: string; // UUID
  merchantId: string;
  caseKey: string;
  reconciliationRunId: string;
  discrepancyType: DiscrepancyType | string;
  status: ExceptionCaseStatus;
  version: number;
  varianceAmountMinor: number;
  expectedAmountMinor: number;
  actualAmountMinor: number;
  currency: string;
  currencyPrecision: number;
  primaryReference: string;
  merchantOrderId: string | null;
  paypalTransactionId: string | null;
  notes: string | null;
  initialVarianceAmountMinor?: number;
  legacyCaseKey?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * Database record for case_evidence_items table.
 */
export interface CaseEvidenceItemRecord {
  id: string; // UUID
  caseId: string; // UUID
  merchantId: string;
  evidenceType: EvidenceType;
  sourceSystem: EvidenceSourceSystem;
  sourceTable: string | null;
  sourceRecordId: string;
  sourceTransactionId: string | null; // UUID referencing paypal_imported_transactions(id)
  reconciliationRunId: string;
  payloadSnapshot: Record<string, unknown>;
  contentHash: string; // SHA-256 hex string (64 characters)
  isObservedFact: boolean;
  capturedAt: string; // ISO 8601
}

/**
 * In-memory representation of an extracted case along with its evidence graph items.
 */
export interface ExtractedCaseWithEvidence {
  caseRecord: Omit<ExceptionCaseRecord, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  };
  evidenceItems: Array<
    Omit<CaseEvidenceItemRecord, 'id' | 'caseId' | 'capturedAt'> & {
      id?: string;
    }
  >;
}

/**
 * Result of the deterministic extraction process.
 */
export interface CaseExtractionSummary {
  reconciliationRunId: string;
  totalRecordsProcessed: number;
  eligibleCasesExtracted: number;
  cleanMatchesSkipped: number;
  ineligibleQuarantinedSkipped: number;
  cases: ExtractedCaseWithEvidence[];
}

/**
 * Result of persisting cases to the database.
 */
export interface PersistenceResult {
  casesCreated: number;
  casesUpdated: number;
  caseIds: string[];
  evidenceItemsInserted: number;
}

/**
 * API Summary representation of an exception case.
 */
export interface ExceptionCaseSummary {
  id: string;
  merchantId: string;
  caseKey: string;
  reconciliationRunId: string;
  discrepancyType: string;
  status: ExceptionCaseStatus;
  version: number;
  varianceAmount: Money;
  expectedAmount: Money;
  actualAmount: Money;
  currency: string;
  primaryReference: string;
  merchantOrderId: string | null;
  paypalTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * API Detail representation of an exception case including full evidence graph.
 */
export interface ExceptionCaseDetail extends ExceptionCaseSummary {
  notes: string | null;
  evidenceCount: number;
  evidence: CaseEvidenceItemRecord[];
}

/**
 * Options for listing exception cases.
 */
export interface ListCasesOptions {
  merchantId: string;
  status?: ExceptionCaseStatus;
  discrepancyType?: string;
  limit?: number;
  offset?: number;
}

