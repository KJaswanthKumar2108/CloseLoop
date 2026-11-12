/**
 * CloseLoop Phase 3D.1: Exception Cases & Evidence Repository
 * Persistent transactional database access with strict tenant isolation,
 * idempotency, historical observation preservation, composite foreign keys,
 * and lifecycle state machine transitions.
 * Hardened per F-24, F-25, F-26, F-28, F-30.
 */

import { Pool, PoolClient } from 'pg';
import { getPool } from '@/lib/db/pool';
import {
  ExceptionCaseDetail,
  ExceptionCaseStatus,
  ExceptionCaseSummary,
  ExtractedCaseWithEvidence,
  ListCasesOptions,
  PersistenceResult,
  CaseEvidenceItemRecord,
} from './types';
import { assertValidTransition, VersionConflictError } from './lifecycle';
import { computeContentHash } from './evidenceGraph';

/**
 * Inserts or idempotently updates exception cases and persists their evidence graphs in an atomic transaction.
 * Hardened per F-26 (Historical Case Integrity) and F-28 (Collision-Resistant Case Identity).
 */
export async function persistExceptionCases(
  customPoolOrClient?: Pool | PoolClient,
  casesWithEvidence: ExtractedCaseWithEvidence[] = []
): Promise<PersistenceResult> {
  if (casesWithEvidence.length === 0) {
    return {
      casesCreated: 0,
      casesUpdated: 0,
      caseIds: [],
      evidenceItemsInserted: 0,
    };
  }

  const pool = customPoolOrClient || getPool();
  const isClient = 'release' in pool && typeof (pool as PoolClient).release === 'function';
  const client: PoolClient = isClient ? (pool as PoolClient) : await (pool as Pool).connect();

  let casesCreated = 0;
  let casesUpdated = 0;
  let evidenceItemsInserted = 0;
  const caseIds: string[] = [];

  try {
    if (!isClient) {
      await client.query('BEGIN');
    }

    for (const item of casesWithEvidence) {
      const c = item.caseRecord;

      // Query whether this case already exists using either canonical hash key or legacy key (F-28)
      const existingRes = await client.query(
        `SELECT
           id,
           case_key,
           version,
           variance_amount_minor,
           expected_amount_minor,
           actual_amount_minor,
           initial_variance_amount_minor
         FROM exception_cases
         WHERE merchant_id = $1 AND (case_key = $2 OR case_key = $3)
         FOR UPDATE`,
        [c.merchantId, c.caseKey, c.legacyCaseKey || c.caseKey]
      );

      const isExisting = existingRes.rows.length > 0;
      let caseId: string;

      if (isExisting) {
        const existingRow = existingRes.rows[0];
        caseId = existingRow.id;

        const oldVariance = Number(existingRow.variance_amount_minor);
        const oldExpected = Number(existingRow.expected_amount_minor);
        const oldActual = Number(existingRow.actual_amount_minor);
        const currentVersion = Number(existingRow.version) || 1;

        // Compare financial values to distinguish identical re-observations from material changes (F-26)
        const isIdenticalObservation =
          oldVariance === c.varianceAmountMinor &&
          oldExpected === c.expectedAmountMinor &&
          oldActual === c.actualAmountMinor;

        if (isIdenticalObservation) {
          // Idempotent re-observation: Update timestamp and upgrade legacy key to v1 hash without incrementing version
          const updateSql = `
            UPDATE exception_cases
            SET
              updated_at = NOW(),
              reconciliation_run_id = $1,
              case_key = $2
            WHERE id = $3
            RETURNING id;
          `;
          await client.query(updateSql, [c.reconciliationRunId, c.caseKey, caseId]);
          casesUpdated++;
        } else {
          // Material observation change: Atomically increment version and preserve historical variance (F-26)
          const newVersion = currentVersion + 1;
          const updateSql = `
            UPDATE exception_cases
            SET
              updated_at = NOW(),
              reconciliation_run_id = $1,
              case_key = $2,
              version = $3,
              variance_amount_minor = $4,
              expected_amount_minor = $5,
              actual_amount_minor = $6,
              notes = $7
            WHERE id = $8
            RETURNING id;
          `;
          await client.query(updateSql, [
            c.reconciliationRunId,
            c.caseKey,
            newVersion,
            c.varianceAmountMinor,
            c.expectedAmountMinor,
            c.actualAmountMinor,
            c.notes,
            caseId,
          ]);
          casesUpdated++;

          // Record snapshot evidence item of the material financial change
          const snapshotPayload = {
            event: 'MATERIAL_FINANCIAL_OBSERVATION_UPDATED',
            priorVersion: currentVersion,
            newVersion,
            priorVarianceMinor: oldVariance,
            newVarianceMinor: c.varianceAmountMinor,
            priorExpectedMinor: oldExpected,
            newExpectedMinor: c.expectedAmountMinor,
            priorActualMinor: oldActual,
            newActualMinor: c.actualAmountMinor,
            observedAtRunId: c.reconciliationRunId,
          };

          item.evidenceItems.push({
            merchantId: c.merchantId,
            evidenceType: 'RECONCILIATION_MATCH',
            sourceSystem: 'RECONCILIATION_ENGINE',
            sourceTable: 'reconciliation_records',
            sourceRecordId: `${c.primaryReference}_v${newVersion}`,
            sourceTransactionId: null,
            reconciliationRunId: c.reconciliationRunId,
            payloadSnapshot: snapshotPayload,
            contentHash: computeContentHash(snapshotPayload),
            isObservedFact: false,
          });
        }
      } else {
        // Initial observation: Insert with initial_variance_amount_minor set permanently (F-26)
        const caseInsertSql = `
          INSERT INTO exception_cases (
            merchant_id,
            case_key,
            reconciliation_run_id,
            discrepancy_type,
            status,
            version,
            variance_amount_minor,
            expected_amount_minor,
            actual_amount_minor,
            initial_variance_amount_minor,
            currency,
            currency_precision,
            primary_reference,
            merchant_order_id,
            paypal_transaction_id,
            notes,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $7, $10, $11, $12, $13, $14, $15, NOW(), NOW()
          )
          ON CONFLICT (merchant_id, case_key) DO UPDATE SET
            updated_at = NOW(),
            reconciliation_run_id = EXCLUDED.reconciliation_run_id
          RETURNING id;
        `;

        const caseRes = await client.query(caseInsertSql, [
          c.merchantId,
          c.caseKey,
          c.reconciliationRunId,
          c.discrepancyType,
          c.status,
          c.version,
          c.varianceAmountMinor,
          c.expectedAmountMinor,
          c.actualAmountMinor,
          c.currency,
          c.currencyPrecision,
          c.primaryReference,
          c.merchantOrderId,
          c.paypalTransactionId,
          c.notes,
        ]);

        caseId = caseRes.rows[0].id;
        casesCreated++;
      }

      caseIds.push(caseId);

      // 2. Persist evidence items linked to this case with composite tenant ownership (F-24)
      for (const ev of item.evidenceItems) {
        const existingEv = await client.query(
          'SELECT id FROM case_evidence_items WHERE case_id = $1 AND merchant_id = $2 AND evidence_type = $3 AND source_record_id = $4',
          [caseId, ev.merchantId, ev.evidenceType, ev.sourceRecordId]
        );

        if (existingEv.rows.length === 0) {
          const evidenceInsertSql = `
            INSERT INTO case_evidence_items (
              case_id,
              merchant_id,
              evidence_type,
              source_system,
              source_table,
              source_record_id,
              source_transaction_id,
              reconciliation_run_id,
              payload_snapshot,
              content_hash,
              is_observed_fact,
              captured_at
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
            )
            RETURNING id;
          `;

          const evRes = await client.query(evidenceInsertSql, [
            caseId,
            ev.merchantId,
            ev.evidenceType,
            ev.sourceSystem,
            ev.sourceTable,
            ev.sourceRecordId,
            ev.sourceTransactionId,
            ev.reconciliationRunId,
            JSON.stringify(ev.payloadSnapshot),
            ev.contentHash,
            ev.isObservedFact,
          ]);

          if (evRes.rows && evRes.rows.length > 0) {
            evidenceItemsInserted++;
          }
        }
      }
    }

    if (!isClient) {
      await client.query('COMMIT');
    }

    return {
      casesCreated,
      casesUpdated,
      caseIds,
      evidenceItemsInserted,
    };
  } catch (err) {
    if (!isClient) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[CloseLoop Repository]: Failed to rollback transaction:', rollbackErr);
      }
    }
    throw err;
  } finally {
    if (!isClient) {
      client.release();
    }
  }
}

/**
 * Atomically transitions an exception case to a new status following the lifecycle state machine (F-30).
 */
export async function transitionCaseStatus(
  customPoolOrClient: Pool | PoolClient | undefined,
  caseId: string,
  merchantId: string,
  targetStatus: ExceptionCaseStatus,
  operatorReason?: string,
  expectedVersion?: number
): Promise<ExceptionCaseDetail> {
  const pool = customPoolOrClient || getPool();
  const isClient = 'release' in pool && typeof (pool as PoolClient).release === 'function';
  const client: PoolClient = isClient ? (pool as PoolClient) : await (pool as Pool).connect();

  try {
    if (!isClient) await client.query('BEGIN');

    // 1. Fetch current case under tenant lock
    const currentRes = await client.query(
      'SELECT id, status, version FROM exception_cases WHERE id = $1 AND merchant_id = $2 FOR UPDATE',
      [caseId, merchantId]
    );

    if (currentRes.rows.length === 0) {
      throw new Error(`Case ${caseId} not found under merchant ${merchantId}`);
    }

    const currentStatus = currentRes.rows[0].status as ExceptionCaseStatus;
    const currentVersion = Number(currentRes.rows[0].version);

    // Optimistic concurrency version check (F-30)
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      throw new VersionConflictError(expectedVersion, currentVersion);
    }

    // 2. Enforce state transition invariants (F-30)
    assertValidTransition(currentStatus, targetStatus);

    const newVersion = currentVersion + 1;

    // Financial truth notice for RESOLVED status (administrative resolution only in Phase 3D.1)
    const effectiveReason =
      targetStatus === 'RESOLVED'
        ? operatorReason
          ? `[RESOLVED_OPERATIONAL]: ${operatorReason} (Administrative resolution; no automated financial ledger movement)`
          : '[RESOLVED_OPERATIONAL]: Administrative investigation resolved (no automated financial ledger movement)'
        : operatorReason
        ? `Status transitioned to ${targetStatus}: ${operatorReason}`
        : null;

    // 3. Atomically update status and increment version with optimistic lock check
    const updateRes = await client.query(
      `UPDATE exception_cases
       SET status = $1, version = $2, updated_at = NOW(), notes = COALESCE($3, notes)
       WHERE id = $4 AND merchant_id = $5 AND version = $6`,
      [
        targetStatus,
        newVersion,
        effectiveReason,
        caseId,
        merchantId,
        currentVersion,
      ]
    );

    if (updateRes.rowCount === 0) {
      throw new VersionConflictError(currentVersion, currentVersion + 1);
    }

    if (!isClient) await client.query('COMMIT');

    const updatedCase = await findCaseById(client, caseId, merchantId);
    if (!updatedCase) {
      throw new Error(`Failed to load updated case ${caseId}`);
    }
    return updatedCase;
  } catch (err) {
    if (!isClient) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Rollback failure non-critical
      }
    }
    throw err;
  } finally {
    if (!isClient) client.release();
  }
}

/**
 * Finds a single exception case by its UUID, strictly enforcing tenant isolation.
 * Returns null if not found or if the case belongs to another tenant.
 */
export async function findCaseById(
  customPoolOrClient: Pool | PoolClient | undefined,
  caseId: string,
  merchantId: string
): Promise<ExceptionCaseDetail | null> {
  const pool = customPoolOrClient || getPool();

  const caseSql = `
    SELECT
      id,
      merchant_id AS "merchantId",
      case_key AS "caseKey",
      reconciliation_run_id AS "reconciliationRunId",
      discrepancy_type AS "discrepancyType",
      status,
      version,
      variance_amount_minor AS "varianceAmountMinor",
      expected_amount_minor AS "expectedAmountMinor",
      actual_amount_minor AS "actualAmountMinor",
      initial_variance_amount_minor AS "initialVarianceAmountMinor",
      currency,
      currency_precision AS "currencyPrecision",
      primary_reference AS "primaryReference",
      merchant_order_id AS "merchantOrderId",
      paypal_transaction_id AS "paypalTransactionId",
      notes,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM exception_cases
    WHERE id = $1 AND merchant_id = $2;
  `;

  const caseRes = await pool.query(caseSql, [caseId, merchantId]);
  if (caseRes.rows.length === 0) {
    return null;
  }

  const row = caseRes.rows[0];

  // Fetch associated evidence items strictly scoped to this merchant (F-24)
  const evidenceSql = `
    SELECT
      id,
      case_id AS "caseId",
      merchant_id AS "merchantId",
      evidence_type AS "evidenceType",
      source_system AS "sourceSystem",
      source_table AS "sourceTable",
      source_record_id AS "sourceRecordId",
      source_transaction_id AS "sourceTransactionId",
      reconciliation_run_id AS "reconciliationRunId",
      payload_snapshot AS "payloadSnapshot",
      content_hash AS "contentHash",
      is_observed_fact AS "isObservedFact",
      captured_at AS "capturedAt"
    FROM case_evidence_items
    WHERE case_id = $1 AND merchant_id = $2
    ORDER BY captured_at ASC, id ASC;
  `;

  const evidenceRes = await pool.query(evidenceSql, [caseId, merchantId]);
  const evidence: CaseEvidenceItemRecord[] = evidenceRes.rows.map((e) => ({
    ...e,
    payloadSnapshot:
      typeof e.payloadSnapshot === 'string'
        ? JSON.parse(e.payloadSnapshot)
        : e.payloadSnapshot,
  }));

  return {
    id: row.id,
    merchantId: row.merchantId,
    caseKey: row.caseKey,
    reconciliationRunId: row.reconciliationRunId,
    discrepancyType: row.discrepancyType,
    status: row.status,
    version: row.version,
    varianceAmount: {
      amountMinor: Number(row.varianceAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    expectedAmount: {
      amountMinor: Number(row.expectedAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    actualAmount: {
      amountMinor: Number(row.actualAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    currency: row.currency,
    primaryReference: row.primaryReference,
    merchantOrderId: row.merchantOrderId,
    paypalTransactionId: row.paypalTransactionId,
    notes: row.notes,
    evidenceCount: evidence.length,
    evidence,
    createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt.toISOString ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

/**
 * Lists exception cases with filtering, pagination, and strict tenant isolation.
 */
export async function listCases(
  customPoolOrClient: Pool | PoolClient | undefined,
  options: ListCasesOptions
): Promise<{ total: number; cases: ExceptionCaseSummary[] }> {
  const pool = customPoolOrClient || getPool();
  const limit = Math.min(Math.max(options.limit || 50, 1), 100);
  const offset = Math.max(options.offset || 0, 0);

  const whereClauses: string[] = ['merchant_id = $1'];
  const params: unknown[] = [options.merchantId];
  let paramIndex = 2;

  if (options.status) {
    whereClauses.push(`status = $${paramIndex}`);
    params.push(options.status);
    paramIndex++;
  }

  if (options.discrepancyType) {
    whereClauses.push(`discrepancy_type = $${paramIndex}`);
    params.push(options.discrepancyType);
    paramIndex++;
  }

  const whereSql = whereClauses.join(' AND ');

  // 1. Total count
  const countSql = `SELECT COUNT(*) AS total FROM exception_cases WHERE ${whereSql};`;
  const countRes = await pool.query(countSql, params);
  const total = parseInt(countRes.rows[0]?.total || '0', 10);

  // 2. Paginated rows
  const selectSql = `
    SELECT
      id,
      merchant_id AS "merchantId",
      case_key AS "caseKey",
      reconciliation_run_id AS "reconciliationRunId",
      discrepancy_type AS "discrepancyType",
      status,
      version,
      variance_amount_minor AS "varianceAmountMinor",
      expected_amount_minor AS "expectedAmountMinor",
      actual_amount_minor AS "actualAmountMinor",
      currency,
      currency_precision AS "currencyPrecision",
      primary_reference AS "primaryReference",
      merchant_order_id AS "merchantOrderId",
      paypal_transaction_id AS "paypalTransactionId",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM exception_cases
    WHERE ${whereSql}
    ORDER BY created_at DESC, id ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
  `;

  const listParams = [...params, limit, offset];
  const listRes = await pool.query(selectSql, listParams);

  const cases: ExceptionCaseSummary[] = listRes.rows.map((row) => ({
    id: row.id,
    merchantId: row.merchantId,
    caseKey: row.caseKey,
    reconciliationRunId: row.reconciliationRunId,
    discrepancyType: row.discrepancyType,
    status: row.status,
    version: row.version,
    varianceAmount: {
      amountMinor: Number(row.varianceAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    expectedAmount: {
      amountMinor: Number(row.expectedAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    actualAmount: {
      amountMinor: Number(row.actualAmountMinor),
      currency: row.currency,
      precision: row.currencyPrecision,
    },
    currency: row.currency,
    primaryReference: row.primaryReference,
    merchantOrderId: row.merchantOrderId,
    paypalTransactionId: row.paypalTransactionId,
    createdAt: row.createdAt.toISOString ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt.toISOString ? row.updatedAt.toISOString() : String(row.updatedAt),
  }));

  return { total, cases };
}
