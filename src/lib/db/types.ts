import { PayPalTransactionDetail } from '@/lib/paypal/transactionSchemas';
import { TransactionType, TransactionStatus } from '@/types/financial';

/**
 * Status of an import run.
 */
export type ImportStatus = 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' | 'PARTIAL';

/**
 * Reconciliation eligibility classification.
 * Strictly separates stored PayPal reporting records from customer-order reconciliation.
 */
export type ReconciliationEligibilityStatus =
  | 'ELIGIBLE'
  | 'INELIGIBLE_NON_SETTLED'
  | 'INELIGIBLE_HOLD'
  | 'INELIGIBLE_AUTHORIZATION'
  | 'QUARANTINED_COLLISION'
  | 'REJECTED';

/**
 * Identity collision status.
 */
export type IdentityCollisionStatus = 'NONE' | 'COLLISION_DETECTED' | 'QUARANTINED';

/**
 * Import Run Entity.
 */
export interface ImportRunRecord {
  id: string; // UUID
  sourceProvider: 'PAYPAL';
  sourceEnvironment: 'SANDBOX' | 'LIVE';
  requestedStartDate: string; // ISO 8601
  requestedEndDate: string; // ISO 8601
  pageSize: number;
  maxPages: number;
  startedAt: string; // ISO 8601
  completedAt: string | null; // ISO 8601
  importStatus: ImportStatus;
  pagesFetched: number;
  recordsReceived: number;
  recordsInserted: number;
  recordsAlreadyPresent: number;
  recordsRejected: number;
  identityCollisionsDetected: number;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
}

/**
 * PayPal Imported Transaction Entity.
 * Exact integer minor-unit financial storage with immutable source provenance.
 */
export interface PayPalImportedTransactionRecord {
  id: string; // UUID
  paypalTransactionId: string;
  fingerprint: string; // Deterministic composite external ID
  transactionEventCode: string;
  transactionType: TransactionType;
  transactionStatus: TransactionStatus;
  grossAmountMinor: number; // Signed integer minor units
  currency: string;
  currencyPrecision: number;
  feeAmountMinor: number | null;
  netAmountMinor: number | null;
  transactionTime: string; // ISO 8601
  paypalReferenceId: string | null;
  paypalReferenceType: string | null;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  invoiceId: string | null;
  merchantReference: string | null;
  sourceEnvironment: 'SANDBOX' | 'LIVE';
  sourceProvider: 'PAYPAL';
  firstImportedAt: string; // ISO 8601
  lastObservedAt: string; // ISO 8601
  firstImportRunId: string; // UUID
  lastImportRunId: string; // UUID
  reconciliationEligible: boolean;
  reconciliationEligibilityStatus: ReconciliationEligibilityStatus;
  identityCollisionStatus: IdentityCollisionStatus;
  rawReference: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * PayPal Rejected Record Entity.
 */
export interface PayPalRejectedRecord {
  id: string; // UUID
  importRunId: string; // UUID
  paypalTransactionId: string | null;
  transactionEventCode: string | null;
  rejectionReason: string;
  rejectionMessage: string;
  rawPayload: PayPalTransactionDetail;
  rejectedAt: string; // ISO 8601
}

/**
 * Identity Collision Log Entity.
 */
export interface IdentityCollisionLogRecord {
  id: string; // UUID
  importRunId: string; // UUID
  fingerprint: string;
  paypalTransactionId: string;
  collisionType: 'WITHIN_BATCH_DUPLICATE' | 'CROSS_BATCH_DISCREPANCY';
  details: string;
  rawPayload: PayPalTransactionDetail;
  loggedAt: string; // ISO 8601
}

