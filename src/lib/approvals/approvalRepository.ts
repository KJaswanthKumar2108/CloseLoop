/**
 * CloseLoop Phase 3D.4: Approval Repository & Tamper-Evident Hash-Chained Audit Trail
 * Data access layer enforcing atomic approval transitions, cryptographic binding, and append-only hash chains.
 */

import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';
import { getReaderPool, getAuditorPool } from '@/lib/db/pool';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import {
  CaseApprovalRecord,
  ApprovalAuditEventRecord,
  CreateApprovalParams,
  DecideApprovalParams,
  HashChainVerificationResult,
} from './types';
import {
  computeCanonicalApprovalBindingHash,
  computeAuditEventHash,
  verifyAuditHashChain,
  GENESIS_AUDIT_HASH,
} from './cryptoBinding';

export class ApprovalError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'ApprovalError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, ApprovalError.prototype);
  }
}

/**
 * Creates an immutable approval request bound by a canonical SHA-256 hash (Section 3).
 * Atomic transaction verifies case version, evidence fingerprint, and duplicate prevention.
 */
export async function createApprovalRequest(
  params: CreateApprovalParams,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseApprovalRecord> {
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

    // 1. Lock parent case with FOR SHARE
    const caseLockRes = await client.query(
      `SELECT id, version FROM exception_cases WHERE id = $1 AND merchant_id = $2 FOR SHARE;`,
      [params.caseId, params.merchantId]
    );

    if (caseLockRes.rows.length === 0) {
      throw new ApprovalError(
        'CASE_NOT_FOUND',
        `Exception case '${params.caseId}' was not found under merchant '${params.merchantId}'.`,
        404
      );
    }

    const liveVersion = caseLockRes.rows[0].version;
    if (liveVersion !== params.caseVersion) {
      throw new ApprovalError(
        'VERSION_DRIFT_DETECTED',
        `Case version drifted from v${params.caseVersion} to v${liveVersion}. Request cannot be submitted for stale version.`,
        409
      );
    }

    // 2. Fetch live evidence items to verify live fingerprint
    const evidenceRes = await client.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1 AND merchant_id = $2;`,
      [params.caseId, params.merchantId]
    );

    const liveFingerprint = computeEvidenceFingerprint(
      params.caseId,
      liveVersion,
      evidenceRes.rows
    );

    if (liveFingerprint !== params.evidenceFingerprint) {
      throw new ApprovalError(
        'EVIDENCE_DRIFT_DETECTED',
        'Live evidence items differ from the snapshot fingerprint attached to this recommendation.',
        409
      );
    }

    // 3. Check for existing pending approval request for this recommendation
    const existingPending = await client.query(
      `SELECT id FROM case_approvals 
       WHERE case_id = $1 AND merchant_id = $2 AND recommendation_id = $3 AND status = 'PENDING_APPROVAL';`,
      [params.caseId, params.merchantId, params.recommendationId]
    );

    if (existingPending.rows.length > 0) {
      throw new ApprovalError(
        'DUPLICATE_APPROVAL_REQUEST',
        `A pending approval request already exists for recommendation '${params.recommendationId}' (Approval ID: ${existingPending.rows[0].id}).`,
        409
      );
    }

    // 4. Construct canonical binding payload and compute SHA-256 hash
    const approvalId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresInHours = params.expiresInHours || 48;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
    const actionParams = params.actionParameters || {};

    const canonicalBindingHash = computeCanonicalApprovalBindingHash({
      approvalRequestId: approvalId,
      merchantId: params.merchantId,
      caseId: params.caseId,
      recommendationId: params.recommendationId,
      actionId: params.actionId,
      actionParameters: actionParams,
      caseVersion: params.caseVersion,
      evidenceFingerprint: params.evidenceFingerprint,
      createdAt,
      expiresAt,
    });

    // 5. Insert approval record
    const insertApprovalSql = `
      INSERT INTO case_approvals (
        id,
        merchant_id,
        case_id,
        recommendation_id,
        action_id,
        action_parameters,
        case_version,
        evidence_fingerprint,
        canonical_binding_hash,
        status,
        requested_by,
        created_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_APPROVAL', $10, $11, $12)
      RETURNING
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
        expires_at AS "expiresAt";
    `;

    const approvalRes = await client.query(insertApprovalSql, [
      approvalId,
      params.merchantId,
      params.caseId,
      params.recommendationId,
      params.actionId,
      JSON.stringify(actionParams),
      params.caseVersion,
      params.evidenceFingerprint,
      canonicalBindingHash,
      params.requestedBy,
      createdAt,
      expiresAt,
    ]);

    // 6. Append initial audit event: APPROVAL_REQUESTED
    const eventPayload = {
      actionId: params.actionId,
      canonicalBindingHash,
      caseVersion: params.caseVersion,
      evidenceFingerprint: params.evidenceFingerprint,
      recommendationId: params.recommendationId,
      requestedBy: params.requestedBy,
    };

    const eventHash = computeAuditEventHash(GENESIS_AUDIT_HASH, {
      approvalId,
      caseId: params.caseId,
      merchantId: params.merchantId,
      actorId: params.requestedBy,
      eventType: 'APPROVAL_REQUESTED',
      canonicalPayload: eventPayload,
      createdAt,
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
      ) VALUES ($1, $2, $3, $4, 'APPROVAL_REQUESTED', $5, $6, $7, $8);`,
      [
        params.merchantId,
        params.caseId,
        approvalId,
        params.requestedBy,
        JSON.stringify(eventPayload),
        GENESIS_AUDIT_HASH,
        eventHash,
        createdAt,
      ]
    );

    await client.query('COMMIT;');

    const row = approvalRes.rows[0];
    return {
      ...row,
      actionParameters:
        typeof row.actionParameters === 'string'
          ? JSON.parse(row.actionParameters)
          : row.actionParameters,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
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

/**
 * Retrieves a single approval record by ID under tenant isolation.
 * Automatically marks expired requests as EXPIRED.
 */
export async function getApprovalById(
  approvalId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseApprovalRecord | null> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
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

  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  const now = new Date();
  const expiresAt = new Date(row.expiresAt);

  // Auto-expire if pending and past expiration
  if (row.status === 'PENDING_APPROVAL' && now > expiresAt) {
    try {
      const auditorPool = getAuditorPool();
      await auditorPool.query(
        `UPDATE case_approvals SET status = 'EXPIRED' WHERE id = $1 AND status = 'PENDING_APPROVAL';`,
        [approvalId]
      );
      row.status = 'EXPIRED';
    } catch {
      // Ignore background update error
    }
  }

  return {
    ...row,
    actionParameters:
      typeof row.actionParameters === 'string'
        ? JSON.parse(row.actionParameters)
        : row.actionParameters,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
    decisionTimestamp: row.decisionTimestamp
      ? row.decisionTimestamp instanceof Date
        ? row.decisionTimestamp.toISOString()
        : String(row.decisionTimestamp)
      : null,
  };
}

/**
 * Lists all approval requests for an exception case under tenant isolation.
 */
export async function listApprovalsForCase(
  caseId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseApprovalRecord[]> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
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
    WHERE case_id = $1 AND merchant_id = $2
    ORDER BY created_at DESC;`,
    [caseId, merchantId]
  );

  const now = new Date();
  return res.rows.map((row) => {
    let effectiveStatus = row.status;
    const expiresAt = new Date(row.expiresAt);
    if (row.status === 'PENDING_APPROVAL' && now > expiresAt) {
      effectiveStatus = 'EXPIRED';
    }

    return {
      ...row,
      status: effectiveStatus,
      actionParameters:
        typeof row.actionParameters === 'string'
          ? JSON.parse(row.actionParameters)
          : row.actionParameters,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
      decisionTimestamp: row.decisionTimestamp
        ? row.decisionTimestamp instanceof Date
          ? row.decisionTimestamp.toISOString()
          : String(row.decisionTimestamp)
        : null,
    };
  });
}

/**
 * Atomically approves or rejects a pending approval request (Section 3).
 * Reconstructs the canonical binding, verifies cryptographic hash integrity,
 * verifies case version and evidence freshness, and appends to the audit hash-chain.
 */
export async function decideApproval(
  params: DecideApprovalParams,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseApprovalRecord> {
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
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      FROM case_approvals
      WHERE id = $1 AND merchant_id = $2
      FOR UPDATE;`,
      [params.approvalId, params.merchantId]
    );

    if (approvalRes.rows.length === 0) {
      throw new ApprovalError(
        'APPROVAL_NOT_FOUND',
        `Approval request '${params.approvalId}' was not found under merchant '${params.merchantId}'.`,
        404
      );
    }

    const approval = approvalRes.rows[0];

    // 2. State machine transition check
    if (approval.status !== 'PENDING_APPROVAL') {
      throw new ApprovalError(
        'INVALID_APPROVAL_STATE',
        `Approval request '${params.approvalId}' is already in terminal state '${approval.status}'. Transitions from terminal states are forbidden.`,
        409
      );
    }

    // 3. Expiry verification
    const now = new Date();
    const expiresAt = new Date(approval.expiresAt);
    if (now > expiresAt) {
      // Mark EXPIRED
      await client.query(
        `UPDATE case_approvals SET status = 'EXPIRED' WHERE id = $1;`,
        [params.approvalId]
      );
      // Append audit event
      const lastAuditRes = await client.query(
        `SELECT event_hash FROM approval_audit_events WHERE approval_id = $1 ORDER BY created_at DESC LIMIT 1;`,
        [params.approvalId]
      );
      const prevHash = lastAuditRes.rows[0]?.event_hash || GENESIS_AUDIT_HASH;
      const expireTime = now.toISOString();
      const expEventHash = computeAuditEventHash(prevHash, {
        approvalId: params.approvalId,
        caseId: approval.caseId,
        merchantId: params.merchantId,
        actorId: 'SYSTEM_EXPIRY',
        eventType: 'APPROVAL_EXPIRED',
        canonicalPayload: { reason: 'Approval request expired before operator decision.' },
        createdAt: expireTime,
      });

      await client.query(
        `INSERT INTO approval_audit_events (
          merchant_id, case_id, approval_id, actor_id, event_type, canonical_payload, previous_event_hash, event_hash, created_at
        ) VALUES ($1, $2, $3, 'SYSTEM_EXPIRY', 'APPROVAL_EXPIRED', $4, $5, $6, $7);`,
        [
          params.merchantId,
          approval.caseId,
          params.approvalId,
          JSON.stringify({ reason: 'Approval request expired before operator decision.' }),
          prevHash,
          expEventHash,
          expireTime,
        ]
      );

      await client.query('COMMIT;');
      throw new ApprovalError(
        'APPROVAL_EXPIRED',
        `Approval request '${params.approvalId}' has expired and cannot be approved or rejected.`,
        410
      );
    }

    // 4. Reconstruct and verify Cryptographic Binding Hash (Section 3)
    const actionParams =
      typeof approval.actionParameters === 'string'
        ? JSON.parse(approval.actionParameters)
        : approval.actionParameters;

    const createdAtStr =
      approval.createdAt instanceof Date ? approval.createdAt.toISOString() : String(approval.createdAt);
    const expiresAtStr =
      approval.expiresAt instanceof Date ? approval.expiresAt.toISOString() : String(approval.expiresAt);

    const recomputedBindingHash = computeCanonicalApprovalBindingHash({
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

    if (recomputedBindingHash !== approval.canonicalBindingHash) {
      throw new ApprovalError(
        'TAMPERED_APPROVAL_BINDING',
        'Cryptographic parameter binding hash verification failed! Request parameters have been modified.',
        400
      );
    }

    // 5. Check Parent Case Version & Lock with FOR SHARE
    const caseRes = await client.query(
      `SELECT version FROM exception_cases WHERE id = $1 AND merchant_id = $2 FOR SHARE;`,
      [approval.caseId, params.merchantId]
    );

    if (caseRes.rows.length === 0) {
      throw new ApprovalError(
        'CASE_NOT_FOUND',
        `Parent exception case '${approval.caseId}' was not found.`,
        404
      );
    }

    const liveCaseVersion = caseRes.rows[0].version;
    if (liveCaseVersion !== approval.caseVersion) {
      // Version drifted! Mark APPROVAL_STALE
      const lastAuditRes = await client.query(
        `SELECT event_hash FROM approval_audit_events WHERE approval_id = $1 ORDER BY created_at DESC LIMIT 1;`,
        [params.approvalId]
      );
      const prevHash = lastAuditRes.rows[0]?.event_hash || GENESIS_AUDIT_HASH;
      const staleTime = now.toISOString();
      const stalePayload = {
        analyzedVersion: approval.caseVersion,
        currentVersion: liveCaseVersion,
        reason: 'Case version progressed before operator decision.',
      };
      const staleEventHash = computeAuditEventHash(prevHash, {
        approvalId: params.approvalId,
        caseId: approval.caseId,
        merchantId: params.merchantId,
        actorId: params.decidedBy,
        eventType: 'APPROVAL_STALE',
        canonicalPayload: stalePayload,
        createdAt: staleTime,
      });

      await client.query(
        `INSERT INTO approval_audit_events (
          merchant_id, case_id, approval_id, actor_id, event_type, canonical_payload, previous_event_hash, event_hash, created_at
        ) VALUES ($1, $2, $3, $4, 'APPROVAL_STALE', $5, $6, $7, $8);`,
        [
          params.merchantId,
          approval.caseId,
          params.approvalId,
          params.decidedBy,
          JSON.stringify(stalePayload),
          prevHash,
          staleEventHash,
          staleTime,
        ]
      );

      await client.query('COMMIT;');
      throw new ApprovalError(
        'VERSION_DRIFT_DETECTED',
        `Case version progressed from v${approval.caseVersion} to v${liveCaseVersion}. Approval request is stale and cannot be decided.`,
        409
      );
    }

    // 6. Check Evidence Fingerprint Drift
    const evidenceRes = await client.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1 AND merchant_id = $2;`,
      [approval.caseId, params.merchantId]
    );

    const liveFingerprint = computeEvidenceFingerprint(
      approval.caseId,
      liveCaseVersion,
      evidenceRes.rows
    );

    if (liveFingerprint !== approval.evidenceFingerprint) {
      throw new ApprovalError(
        'EVIDENCE_DRIFT_DETECTED',
        'Live evidence graph has changed since this recommendation was submitted for approval.',
        409
      );
    }

    // 7. Dual Control Enforcement (Section 2)
    // If CLOSELOOP_ENFORCE_DUAL_CONTROL is true, reject self-approval
    if (
      process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL === 'true' &&
      params.decidedBy === approval.requestedBy
    ) {
      throw new ApprovalError(
        'DUAL_CONTROL_VIOLATION',
        `Dual control policy violation: Operator '${params.decidedBy}' cannot approve their own submission.`,
        403
      );
    }

    // 8. Execute Atomic State Transition
    const newStatus = params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const decisionTime = now.toISOString();

    const updateRes = await client.query(
      `UPDATE case_approvals SET
        status = $1,
        decided_by = $2,
        decision_reason = $3,
        decision_timestamp = $4
      WHERE id = $5 AND status = 'PENDING_APPROVAL'
      RETURNING
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
        expires_at AS "expiresAt";`,
      [
        newStatus,
        params.decidedBy,
        params.decisionReason,
        decisionTime,
        params.approvalId,
      ]
    );

    // 9. Append to Tamper-Evident Hash-Chained Audit Trail (Section 4)
    const lastAuditRes = await client.query(
      `SELECT event_hash FROM approval_audit_events WHERE approval_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [params.approvalId]
    );
    const prevHash = lastAuditRes.rows[0]?.event_hash || GENESIS_AUDIT_HASH;
    const auditEventType = params.decision === 'APPROVE' ? 'APPROVAL_GRANTED' : 'APPROVAL_REJECTED';

    const eventPayload = {
      decision: params.decision,
      decisionReason: params.decisionReason,
      decidedBy: params.decidedBy,
      decisionTimestamp: decisionTime,
    };

    const eventHash = computeAuditEventHash(prevHash, {
      approvalId: params.approvalId,
      caseId: approval.caseId,
      merchantId: params.merchantId,
      actorId: params.decidedBy,
      eventType: auditEventType,
      canonicalPayload: eventPayload,
      createdAt: decisionTime,
    });

    await client.query(
      `INSERT INTO approval_audit_events (
        merchant_id, case_id, approval_id, actor_id, event_type, canonical_payload, previous_event_hash, event_hash, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
      [
        params.merchantId,
        approval.caseId,
        params.approvalId,
        params.decidedBy,
        auditEventType,
        JSON.stringify(eventPayload),
        prevHash,
        eventHash,
        decisionTime,
      ]
    );

    await client.query('COMMIT;');

    const row = updateRes.rows[0];
    return {
      ...row,
      actionParameters:
        typeof row.actionParameters === 'string'
          ? JSON.parse(row.actionParameters)
          : row.actionParameters,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
      decisionTimestamp: row.decisionTimestamp
        ? row.decisionTimestamp instanceof Date
          ? row.decisionTimestamp.toISOString()
          : String(row.decisionTimestamp)
        : null,
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

/**
 * Retrieves the full tamper-evident audit history for an approval request (Section 4).
 * Re-evaluates cryptographic hash chain integrity and reports any detected tampering.
 */
export async function getApprovalAuditTrail(
  approvalId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<{
  approval: CaseApprovalRecord;
  events: ApprovalAuditEventRecord[];
  chainVerification: HashChainVerificationResult;
}> {
  const pool = customPoolOrClient || getReaderPool();

  const approval = await getApprovalById(approvalId, merchantId, pool);
  if (!approval) {
    throw new ApprovalError(
      'APPROVAL_NOT_FOUND',
      `Approval request '${approvalId}' was not found under merchant '${merchantId}'.`,
      404
    );
  }

  const eventsRes = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      approval_id AS "approvalId",
      actor_id AS "actorId",
      event_type AS "eventType",
      canonical_payload AS "canonicalPayload",
      previous_event_hash AS "previousEventHash",
      event_hash AS "eventHash",
      created_at AS "createdAt"
    FROM approval_audit_events
    WHERE approval_id = $1 AND merchant_id = $2
    ORDER BY created_at ASC;`,
    [approvalId, merchantId]
  );

  const events: ApprovalAuditEventRecord[] = eventsRes.rows.map((r) => ({
    ...r,
    canonicalPayload:
      typeof r.canonicalPayload === 'string'
        ? JSON.parse(r.canonicalPayload)
        : r.canonicalPayload,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));

  const chainVerification = verifyAuditHashChain(events);

  return {
    approval,
    events,
    chainVerification,
  };
}
