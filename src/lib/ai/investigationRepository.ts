/**
 * CloseLoop Phase 3D.2: Investigation Audit Repository
 * Append-only data access layer for persisting and retrieving investigation audit records.
 *
 * Hardened per F-31 (Append-Only Immutability),
 * F-33 (Runtime Database Role Separation: Dedicated Reader and Auditor pools),
 * and F-35 (Atomic Snapshot Consistency & Dynamic Staleness Evaluation).
 */

import { Pool, PoolClient } from 'pg';
import { getReaderPool, getAuditorPool } from '@/lib/db/pool';
import {
  InvestigationResult,
  TokenUsage,
  SnapshotConsistencyMetadata,
} from './types';

export interface CaseInvestigationRecord {
  id: string;
  caseId: string;
  merchantId: string;
  caseVersion: number;
  evidenceFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: 'COMPLETED' | 'FAILED' | 'STALE_SNAPSHOT';
  investigationResult: InvestigationResult | null;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
  tokensUsed?: TokenUsage | null;
  isStale?: boolean;
  snapshotMetadata?: SnapshotConsistencyMetadata | null;
  createdAt: string;
}

export interface InsertInvestigationParams {
  caseId: string;
  merchantId: string;
  caseVersion: number;
  evidenceFingerprint: string;
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  status: 'COMPLETED' | 'FAILED' | 'STALE_SNAPSHOT';
  investigationResult?: InvestigationResult | null;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
  tokensUsed?: TokenUsage | null;
  isStale?: boolean;
  snapshotMetadata?: SnapshotConsistencyMetadata | null;
}

/**
 * Persists an immutable investigation record to case_investigations.
 * Authenticates using the restricted Auditor Pool by default (F-33).
 * Enforces atomic parent-case version validation inside a short transaction (F-35).
 */
export async function persistInvestigation(
  customPoolOrClient: Pool | PoolClient | undefined,
  params: InsertInvestigationParams
): Promise<CaseInvestigationRecord> {
  const pool = customPoolOrClient || getAuditorPool();

  let client: { query: PoolClient['query']; release?: () => void };
  let shouldRelease = false;

  if ('connect' in pool && typeof (pool as Pool).connect === 'function') {
    client = await (pool as Pool).connect();
    shouldRelease = true;
  } else {
    client = pool as PoolClient;
  }

  try {
    await client.query('BEGIN;');

    let finalStatus = params.status;
    let finalIsStale = params.isStale ?? false;
    let finalSnapshotMetadata = params.snapshotMetadata;

    // Check parent case with FOR SHARE row-lock if not already marked failed
    if (finalStatus !== 'FAILED') {
      const caseLockRes = await client.query(
        `SELECT version FROM exception_cases WHERE id = $1 AND merchant_id = $2 FOR SHARE;`,
        [params.caseId, params.merchantId]
      );

      if (caseLockRes.rows.length > 0) {
        const liveVersion = caseLockRes.rows[0].version;
        if (liveVersion !== params.caseVersion) {
          finalStatus = 'STALE_SNAPSHOT';
          finalIsStale = true;
          finalSnapshotMetadata = {
            analyzedVersion: params.caseVersion,
            currentVersion: liveVersion,
            analyzedFingerprint: params.evidenceFingerprint,
            currentFingerprint: 'drifted_atomic_commit',
            contextCreatedAt: new Date().toISOString(),
            checkedAt: new Date().toISOString(),
          };
        }
      }
    }

    const insertSql = `
      INSERT INTO case_investigations (
        case_id,
        merchant_id,
        case_version,
        evidence_fingerprint,
        provider,
        model,
        prompt_version,
        schema_version,
        status,
        investigation_result,
        safe_error_code,
        safe_error_message,
        tokens_used,
        is_stale,
        snapshot_metadata,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
      )
      RETURNING
        id,
        case_id AS "caseId",
        merchant_id AS "merchantId",
        case_version AS "caseVersion",
        evidence_fingerprint AS "evidenceFingerprint",
        provider,
        model,
        prompt_version AS "promptVersion",
        schema_version AS "schemaVersion",
        status,
        investigation_result AS "investigationResult",
        safe_error_code AS "safeErrorCode",
        safe_error_message AS "safeErrorMessage",
        tokens_used AS "tokensUsed",
        is_stale AS "isStale",
        snapshot_metadata AS "snapshotMetadata",
        created_at AS "createdAt";
    `;

    const res = await client.query(insertSql, [
      params.caseId,
      params.merchantId,
      params.caseVersion,
      params.evidenceFingerprint,
      params.provider,
      params.model,
      params.promptVersion,
      params.schemaVersion,
      finalStatus,
      params.investigationResult ? JSON.stringify(params.investigationResult) : null,
      params.safeErrorCode || null,
      params.safeErrorMessage || null,
      params.tokensUsed ? JSON.stringify(params.tokensUsed) : null,
      finalIsStale,
      finalSnapshotMetadata ? JSON.stringify(finalSnapshotMetadata) : null,
    ]);

    await client.query('COMMIT;');

    const row = res.rows[0];
    return {
      ...row,
      investigationResult:
        typeof row.investigationResult === 'string'
          ? JSON.parse(row.investigationResult)
          : row.investigationResult,
      tokensUsed:
        typeof row.tokensUsed === 'string' ? JSON.parse(row.tokensUsed) : row.tokensUsed,
      snapshotMetadata:
        typeof row.snapshotMetadata === 'string'
          ? JSON.parse(row.snapshotMetadata)
          : row.snapshotMetadata,
      createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch {
      // ignore rollback failures
    }
    throw err;
  } finally {
    if (shouldRelease && typeof client.release === 'function') {
      client.release();
    }
  }
}

/**
 * Retrieves the latest investigation record for a case under strict tenant isolation.
 * Authenticates using the restricted Reader Pool by default (F-33).
 * Evaluates staleness dynamically against the live parent case version (F-35).
 */
export async function findLatestInvestigationByCaseId(
  customPoolOrClient: Pool | PoolClient | undefined,
  caseId: string,
  merchantId: string
): Promise<CaseInvestigationRecord | null> {
  const pool = customPoolOrClient || getReaderPool();

  const querySql = `
    SELECT
      ci.id,
      ci.case_id AS "caseId",
      ci.merchant_id AS "merchantId",
      ci.case_version AS "caseVersion",
      ci.evidence_fingerprint AS "evidenceFingerprint",
      ci.provider,
      ci.model,
      ci.prompt_version AS "promptVersion",
      ci.schema_version AS "schemaVersion",
      ci.status,
      ci.investigation_result AS "investigationResult",
      ci.safe_error_code AS "safeErrorCode",
      ci.safe_error_message AS "safeErrorMessage",
      ci.tokens_used AS "tokensUsed",
      ci.is_stale AS "isStale",
      ci.snapshot_metadata AS "snapshotMetadata",
      ci.created_at AS "createdAt",
      ec.version AS "liveCaseVersion"
    FROM case_investigations ci
    LEFT JOIN exception_cases ec ON ec.id = ci.case_id AND ec.merchant_id = ci.merchant_id
    WHERE ci.case_id = $1 AND ci.merchant_id = $2
    ORDER BY ci.created_at DESC
    LIMIT 1;
  `;

  const res = await pool.query(querySql, [caseId, merchantId]);
  if (res.rows.length === 0) return null;

  const row = res.rows[0];
  const liveVersion = row.liveCaseVersion;
  const isDynamicallyStale =
    Boolean(row.isStale) ||
    (liveVersion !== null && liveVersion !== undefined && liveVersion !== row.caseVersion);

  const parsedSnapshotMeta =
    typeof row.snapshotMetadata === 'string'
      ? JSON.parse(row.snapshotMetadata)
      : row.snapshotMetadata;

  return {
    ...row,
    isStale: isDynamicallyStale,
    status: isDynamicallyStale && row.status === 'COMPLETED' ? 'STALE_SNAPSHOT' : row.status,
    snapshotMetadata:
      isDynamicallyStale && !parsedSnapshotMeta
        ? {
            analyzedVersion: row.caseVersion,
            currentVersion: liveVersion ?? row.caseVersion,
            analyzedFingerprint: row.evidenceFingerprint,
            currentFingerprint: 'drifted_live_version',
            contextCreatedAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
            checkedAt: new Date().toISOString(),
          }
        : parsedSnapshotMeta,
    investigationResult:
      typeof row.investigationResult === 'string'
        ? JSON.parse(row.investigationResult)
        : row.investigationResult,
    tokensUsed:
      typeof row.tokensUsed === 'string' ? JSON.parse(row.tokensUsed) : row.tokensUsed,
    createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/**
 * Lists all historical investigations for a case in reverse chronological order.
 * Authenticates using the restricted Reader Pool by default (F-33).
 * Evaluates staleness dynamically against the live parent case version (F-35).
 */
export async function listInvestigationsByCaseId(
  customPoolOrClient: Pool | PoolClient | undefined,
  caseId: string,
  merchantId: string,
  limit = 20
): Promise<CaseInvestigationRecord[]> {
  const pool = customPoolOrClient || getReaderPool();

  const querySql = `
    SELECT
      ci.id,
      ci.case_id AS "caseId",
      ci.merchant_id AS "merchantId",
      ci.case_version AS "caseVersion",
      ci.evidence_fingerprint AS "evidenceFingerprint",
      ci.provider,
      ci.model,
      ci.prompt_version AS "promptVersion",
      ci.schema_version AS "schemaVersion",
      ci.status,
      ci.investigation_result AS "investigationResult",
      ci.safe_error_code AS "safeErrorCode",
      ci.safe_error_message AS "safeErrorMessage",
      ci.tokens_used AS "tokensUsed",
      ci.is_stale AS "isStale",
      ci.snapshot_metadata AS "snapshotMetadata",
      ci.created_at AS "createdAt",
      ec.version AS "liveCaseVersion"
    FROM case_investigations ci
    LEFT JOIN exception_cases ec ON ec.id = ci.case_id AND ec.merchant_id = ci.merchant_id
    WHERE ci.case_id = $1 AND ci.merchant_id = $2
    ORDER BY ci.created_at DESC
    LIMIT $3;
  `;

  const res = await pool.query(querySql, [caseId, merchantId, limit]);
  return res.rows.map((row) => {
    const liveVersion = row.liveCaseVersion;
    const isDynamicallyStale =
      Boolean(row.isStale) ||
      (liveVersion !== null && liveVersion !== undefined && liveVersion !== row.caseVersion);

    const parsedSnapshotMeta =
      typeof row.snapshotMetadata === 'string'
        ? JSON.parse(row.snapshotMetadata)
        : row.snapshotMetadata;

    return {
      ...row,
      isStale: isDynamicallyStale,
      status: isDynamicallyStale && row.status === 'COMPLETED' ? 'STALE_SNAPSHOT' : row.status,
      snapshotMetadata:
        isDynamicallyStale && !parsedSnapshotMeta
          ? {
              analyzedVersion: row.caseVersion,
              currentVersion: liveVersion ?? row.caseVersion,
              analyzedFingerprint: row.evidenceFingerprint,
              currentFingerprint: 'drifted_live_version',
              contextCreatedAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
              checkedAt: new Date().toISOString(),
            }
          : parsedSnapshotMeta,
      investigationResult:
        typeof row.investigationResult === 'string'
          ? JSON.parse(row.investigationResult)
          : row.investigationResult,
      tokensUsed:
        typeof row.tokensUsed === 'string' ? JSON.parse(row.tokensUsed) : row.tokensUsed,
      createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
    };
  });
}
