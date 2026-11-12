/**
 * CloseLoop Phase 3D.5: Controlled Execution Engine
 * Validates approval eligibility, executes deterministic dry-run simulations,
 * and maintains cryptographic audit continuity without executing real-world financial mutations.
 */

import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { getReaderPool, getAuditorPool } from '@/lib/db/pool';
import { getActionCatalogEntry } from '@/lib/resolution/catalog';
import { ActionCatalogId } from '@/lib/resolution/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import { computeCanonicalApprovalBindingHash, computeAuditEventHash, GENESIS_AUDIT_HASH } from '@/lib/approvals/cryptoBinding';
import {
  CaseExecutionRecord,
  ExecuteActionParams,
  ExecutionEligibilityResult,
  ExecutionResultSummary,
  MANDATORY_SIMULATION_DISCLAIMER,
  PAYPAL_SANDBOX_UNAVAILABLE_MESSAGE,
  LIVE_EXECUTION_DISABLED_MESSAGE,
} from './types';

export class ExecutionError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

/**
 * Validates all preconditions and invariants required for an action to enter execution (Section A2).
 * Fails closed if any gate fails.
 */
export async function checkExecutionEligibility(
  approvalId: string,
  merchantId: string,
  poolOrClient?: Pool | PoolClient
): Promise<ExecutionEligibilityResult> {
  const pool = poolOrClient || getReaderPool();

  // 1. Fetch approval record
  const approvalRes = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      recommendation_id AS "recommendationId",
      action_id AS "actionId",
      action_parameters AS "actionParameters",
      case_version AS "caseVersion",
      evidence_fingerprint AS "evidenceFingerprint",
      canonical_binding_hash AS "canonicalBindingHash",
      status,
      requested_by AS "requestedBy",
      decided_by AS "decidedBy",
      decision_reason AS "decisionReason",
      decision_timestamp AS "decisionTimestamp",
      created_at AS "createdAt",
      expires_at AS "expiresAt"
    FROM case_approvals
    WHERE id = $1 AND merchant_id = $2;`,
    [approvalId, merchantId]
  );

  if (approvalRes.rows.length === 0) {
    return {
      isEligible: false,
      rejectionCode: 'APPROVAL_NOT_FOUND',
      rejectionReason: `Approval request '${approvalId}' was not found under merchant '${merchantId}'.`,
    };
  }

  const approval = approvalRes.rows[0];

  // 2. Verify status is APPROVED
  if (approval.status !== 'APPROVED') {
    return {
      isEligible: false,
      rejectionCode: 'APPROVAL_NOT_GRANTED',
      rejectionReason: `Action cannot be executed. Approval status is '${approval.status}' (must be 'APPROVED').`,
      approval,
    };
  }

  // 3. Verify expiration
  const now = new Date();
  const expiresAt = new Date(approval.expiresAt);
  if (now > expiresAt) {
    return {
      isEligible: false,
      rejectionCode: 'APPROVAL_EXPIRED',
      rejectionReason: `Approval request '${approvalId}' expired on ${expiresAt.toISOString()}.`,
      approval,
    };
  }

  // 4. Verify Canonical Binding Hash (RFC 8785 SHA-256)
  const actionParams =
    typeof approval.actionParameters === 'string'
      ? JSON.parse(approval.actionParameters)
      : approval.actionParameters;

  const createdAtStr =
    approval.createdAt instanceof Date ? approval.createdAt.toISOString() : String(approval.createdAt);
  const expiresAtStr =
    approval.expiresAt instanceof Date ? approval.expiresAt.toISOString() : String(approval.expiresAt);

  const recomputedHash = computeCanonicalApprovalBindingHash({
    approvalRequestId: approval.id,
    merchantId: approval.merchantId,
    caseId: approval.caseId,
    recommendationId: approval.recommendationId,
    actionId: approval.actionId,
    actionParameters: actionParams,
    caseVersion: approval.caseVersion,
    evidenceFingerprint: approval.evidenceFingerprint,
    createdAt: createdAtStr,
    expiresAt: expiresAtStr,
  });

  if (recomputedHash !== approval.canonicalBindingHash) {
    return {
      isEligible: false,
      rejectionCode: 'TAMPERED_BINDING_HASH',
      rejectionReason: 'Cryptographic parameter binding hash verification failed! Approved parameters have been modified.',
      approval,
    };
  }

  // 5. Verify Parent Case Version
  const caseRes = await pool.query(
    `SELECT id, version, discrepancy_type AS "discrepancyType", status, variance_amount_minor AS "varianceAmountMinor", currency
     FROM exception_cases WHERE id = $1 AND merchant_id = $2;`,
    [approval.caseId, merchantId]
  );

  if (caseRes.rows.length === 0) {
    return {
      isEligible: false,
      rejectionCode: 'CASE_NOT_FOUND',
      rejectionReason: `Parent exception case '${approval.caseId}' was not found.`,
      approval,
    };
  }

  const caseRecord = caseRes.rows[0];
  if (caseRecord.version !== approval.caseVersion) {
    return {
      isEligible: false,
      rejectionCode: 'VERSION_DRIFT_DETECTED',
      rejectionReason: `Case version progressed from approved v${approval.caseVersion} to live v${caseRecord.version}. Approval is stale.`,
      approval,
    };
  }

  // 6. Verify Evidence Graph Fingerprint Freshness
  const evidenceRes = await pool.query(
    `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1 AND merchant_id = $2;`,
    [approval.caseId, merchantId]
  );

  const liveFingerprint = computeEvidenceFingerprint(
    approval.caseId,
    caseRecord.version,
    evidenceRes.rows
  );

  if (liveFingerprint !== approval.evidenceFingerprint) {
    return {
      isEligible: false,
      rejectionCode: 'EVIDENCE_DRIFT_DETECTED',
      rejectionReason: 'Live evidence items differ from the snapshot fingerprint attached to this approved action.',
      approval,
    };
  }

  // 7. Validate Action Catalog Preconditions
  let catalogEntry;
  try {
    catalogEntry = getActionCatalogEntry(approval.actionId);
  } catch {
    return {
      isEligible: false,
      rejectionCode: 'UNSUPPORTED_ACTION',
      rejectionReason: `Approved action '${approval.actionId}' does not exist in the declarative resolution catalog.`,
      approval,
    };
  }

  // 8. Verify action has not already been executed
  const existingExecRes = await pool.query(
    `SELECT id, status, completed_at AS "completedAt" FROM case_executions
     WHERE approval_id = $1 AND status IN ('SIMULATED', 'SUCCEEDED');`,
    [approval.id]
  );

  if (existingExecRes.rows.length > 0) {
    return {
      isEligible: false,
      rejectionCode: 'ALREADY_EXECUTED',
      rejectionReason: `Action has already been executed under execution ID '${existingExecRes.rows[0].id}' (${existingExecRes.rows[0].status}). Duplicate execution is blocked.`,
      approval,
      catalogEntry,
    };
  }

  return {
    isEligible: true,
    approval,
    caseRecord,
    catalogEntry,
  };
}

/**
 * Produces a deterministic simulated execution outcome for a given catalog action.
 */
function generateDeterministicSimulationResult(
  actionId: ActionCatalogId,
  actionParameters: Record<string, unknown>,
  caseRecord?: Record<string, unknown>
): ExecutionResultSummary {
  const completedAt = new Date().toISOString();
  const catalogEntry = getActionCatalogEntry(actionId);

  const safetyAssertions = [
    'Zero external PayPal payment or refund API calls were initiated.',
    'Reconciliation financial core and persisted ledgers remain completely unaltered.',
    'Simulated results are intended strictly for operator review and demonstration.',
    MANDATORY_SIMULATION_DISCLAIMER,
  ];

  switch (actionId) {
    case 'INVESTIGATE_AMOUNT_VARIANCE':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated ledger adjustment preview generated: Identified gross capture differential. Prepared offsetting fee schedule adjustment voucher.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        simulatedLedgerImpact: {
          accountDebited: '2100_ACCOUNTS_RECEIVABLE_DISCREPANCIES',
          accountCredited: '5200_PAYPAL_PROCESSING_FEE_EXPENSE',
          amountMinor: Number(caseRecord?.varianceAmountMinor || actionParameters?.varianceMinor || 1500),
          currency: String(caseRecord?.currency || 'USD'),
          journalType: 'ADJUSTING_JOURNAL_VOUCHER',
          entryDescription: 'Simulated fee variance allocation voucher for operator sign-off.',
        },
        simulatedExternalCall: {
          targetSystem: 'PAYPAL_API_M_SANDBOX',
          mockEndpoint: 'POST /v2/payments/captures/{capture_id}/dry-run-inspect',
          simulatedStatus: 'SIMULATED_200_OK',
          note: 'No network request sent. Local deterministic simulation.',
        },
        completedAt,
      };

    case 'REVIEW_DUPLICATE_PAYMENT':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated duplicate capture hold preview: Flagged secondary capture reference for reconciliation hold. Simulated automated customer email notification draft.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        simulatedLedgerImpact: {
          accountDebited: '2200_UNEARNED_DUPLICATE_REVENUE_HOLD',
          accountCredited: '1100_PAYPAL_SETTLEMENT_CLEARING',
          amountMinor: Number(caseRecord?.varianceAmountMinor || 7500),
          currency: String(caseRecord?.currency || 'USD'),
          journalType: 'DUPLICATE_ISOLATION_HOLD',
          entryDescription: 'Simulated hold voucher isolating duplicate capture funds from daily settlement.',
        },
        simulatedExternalCall: {
          targetSystem: 'MERCHANT_OMS',
          mockEndpoint: 'POST /api/orders/{order_id}/duplicate-flag',
          simulatedStatus: 'SIMULATED_200_OK',
          note: 'Simulated OMS order flag. No real network transmission.',
        },
        completedAt,
      };

    case 'WAIT_FOR_SETTLEMENT':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated clearing schedule verification: Transaction timestamp is within 7-day ACH/card settlement window. Simulated automated re-evaluation timer set.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        simulatedExternalCall: {
          targetSystem: 'PAYPAL_SETTLEMENT_WATCHER',
          mockEndpoint: 'POST /api/scheduler/register-settlement-check',
          simulatedStatus: 'SIMULATED_200_OK',
          note: 'Settlement monitor simulation active.',
        },
        completedAt,
      };

    case 'REQUEST_MERCHANT_DOCUMENTATION':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated merchant documentation dispatch: Prepared outbound order inquiry for merchant OMS accounting team with attached PayPal transaction reference.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        completedAt,
      };

    case 'REVIEW_REFUND_STATUS':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated refund reconciliation: Cross-referenced refund event against merchant return policy. Verified no unauthorized second reversal is required.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        completedAt,
      };

    case 'ESCALATE_FOR_MANUAL_REVIEW':
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          'Simulated supervisory escalation: High-risk/high-uncertainty exception assigned to Senior Financial Controller review queue with complete evidence dossier.',
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        completedAt,
      };

    case 'VERIFY_PAYMENT_REFERENCE':
    case 'REVIEW_CASE_EVIDENCE':
    default:
      return {
        isSimulated: true,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        actionId,
        actionTitle: catalogEntry.title,
        executionMode: 'DRY_RUN',
        simulatedOutcome:
          `Simulated review for ${catalogEntry.title}: Verified evidence provenance and confirmed reference integrity without external ledger modification.`,
        preconditionsVerified: catalogEntry.preconditions,
        safetyAssertions,
        completedAt,
      };
  }
}

/**
 * Atomically executes a controlled action under strict safety boundaries (Section A1-A4).
 * For DRY_RUN, produces a deterministic simulated outcome, records execution, and appends to audit trail.
 */
export async function executeControlledAction(
  params: ExecuteActionParams,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseExecutionRecord> {
  const mode = params.executionMode || 'DRY_RUN';

  // Strict execution mode guards
  if (mode === 'LIVE') {
    throw new ExecutionError(
      'LIVE_EXECUTION_DISABLED',
      LIVE_EXECUTION_DISABLED_MESSAGE,
      403
    );
  }

  if (mode === 'PAYPAL_SANDBOX') {
    throw new ExecutionError(
      'PAYPAL_SANDBOX_UNAVAILABLE',
      PAYPAL_SANDBOX_UNAVAILABLE_MESSAGE,
      501
    );
  }

  const pool = customPoolOrClient || getAuditorPool();
  let client: PoolClient;
  let shouldRelease = false;

  if ('connect' in pool && typeof (pool as Pool).connect === 'function') {
    client = await (pool as Pool).connect();
    shouldRelease = true;
  } else {
    client = pool as PoolClient;
  }

  try {
    await client.query('BEGIN;');

    // 1. Lock the approval record FOR UPDATE
    const approvalRes = await client.query(
      `SELECT
        id,
        merchant_id AS "merchantId",
        case_id AS "caseId",
        recommendation_id AS "recommendationId",
        action_id AS "actionId",
        action_parameters AS "actionParameters",
        case_version AS "caseVersion",
        evidence_fingerprint AS "evidenceFingerprint",
        canonical_binding_hash AS "canonicalBindingHash",
        status,
        requested_by AS "requestedBy",
        decided_by AS "decidedBy",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      FROM case_approvals
      WHERE id = $1 AND merchant_id = $2
      FOR UPDATE;`,
      [params.approvalId, params.merchantId]
    );

    if (approvalRes.rows.length === 0) {
      throw new ExecutionError(
        'APPROVAL_NOT_FOUND',
        `Approval request '${params.approvalId}' was not found under merchant '${params.merchantId}'.`,
        404
      );
    }

    const approval = approvalRes.rows[0];

    // 2. Validate Eligibility within Transaction
    const eligibility = await checkExecutionEligibility(
      params.approvalId,
      params.merchantId,
      client
    );

    if (!eligibility.isEligible) {
      throw new ExecutionError(
        eligibility.rejectionCode || 'INELIGIBLE_FOR_EXECUTION',
        eligibility.rejectionReason || 'Action failed execution eligibility validation.',
        409
      );
    }

    // 3. Resolve Idempotency Key
    const idempotencyKey =
      params.idempotencyKey?.trim() ||
      `exec_${params.approvalId}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Check if idempotency key was already consumed
    const existingKeyRes = await client.query(
      `SELECT id, status FROM case_executions WHERE merchant_id = $1 AND idempotency_key = $2;`,
      [params.merchantId, idempotencyKey]
    );

    if (existingKeyRes.rows.length > 0) {
      throw new ExecutionError(
        'DUPLICATE_IDEMPOTENCY_KEY',
        `Idempotency key '${idempotencyKey}' has already been processed (Execution ID: ${existingKeyRes.rows[0].id}).`,
        409
      );
    }

    // 4. Compute Parameter Hash
    const actionParams =
      typeof approval.actionParameters === 'string'
        ? JSON.parse(approval.actionParameters)
        : approval.actionParameters;

    const paramHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(actionParams), 'utf8')
      .digest('hex');

    // 5. Generate Deterministic Simulation Result
    const simulationResult = generateDeterministicSimulationResult(
      approval.actionId as ActionCatalogId,
      actionParams,
      eligibility.caseRecord as unknown as Record<string, unknown>
    );

    const executionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // 6. Insert Execution Record
    const insertRes = await client.query(
      `INSERT INTO case_executions (
        id,
        merchant_id,
        case_id,
        approval_id,
        recommendation_id,
        action_id,
        execution_mode,
        idempotency_key,
        parameter_hash,
        status,
        result_summary,
        created_at,
        completed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 'DRY_RUN', $7, $8, 'SIMULATED', $9, $10, $11)
      RETURNING
        id,
        merchant_id AS "merchantId",
        case_id AS "caseId",
        approval_id AS "approvalId",
        recommendation_id AS "recommendationId",
        action_id AS "actionId",
        execution_mode AS "executionMode",
        idempotency_key AS "idempotencyKey",
        parameter_hash AS "parameterHash",
        status,
        result_summary AS "resultSummary",
        error_code AS "errorCode",
        error_message AS "errorMessage",
        created_at AS "createdAt",
        completed_at AS "completedAt";`,
      [
        executionId,
        params.merchantId,
        approval.caseId,
        approval.id,
        approval.recommendationId,
        approval.actionId,
        idempotencyKey,
        paramHash,
        JSON.stringify(simulationResult),
        now,
        now,
      ]
    );

    // 7. Append Hash-Chained Audit Event (Section A4)
    const lastAuditRes = await client.query(
      `SELECT event_hash FROM approval_audit_events WHERE approval_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [approval.id]
    );
    const prevHash = lastAuditRes.rows[0]?.event_hash || GENESIS_AUDIT_HASH;

    const auditPayload = {
      executionId,
      executionMode: 'DRY_RUN',
      idempotencyKey,
      actionId: approval.actionId,
      simulatedOutcome: simulationResult.simulatedOutcome,
      disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
    };

    const auditEventHash = computeAuditEventHash(prevHash, {
      approvalId: approval.id,
      caseId: approval.caseId,
      merchantId: params.merchantId,
      actorId: params.operatorId,
      eventType: 'EXECUTION_SIMULATED',
      canonicalPayload: auditPayload,
      createdAt: now,
    });

    await client.query(
      `INSERT INTO approval_audit_events (
        merchant_id,
        case_id,
        approval_id,
        actor_id,
        event_type,
        canonical_payload,
        previous_event_hash,
        event_hash,
        created_at
      ) VALUES ($1, $2, $3, $4, 'EXECUTION_SIMULATED', $5, $6, $7, $8);`,
      [
        params.merchantId,
        approval.caseId,
        approval.id,
        params.operatorId,
        JSON.stringify(auditPayload),
        prevHash,
        auditEventHash,
        now,
      ]
    );

    await client.query('COMMIT;');

    const row = insertRes.rows[0];
    return {
      ...row,
      resultSummary:
        typeof row.resultSummary === 'string'
          ? JSON.parse(row.resultSummary)
          : row.resultSummary,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : String(row.completedAt),
    };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}
