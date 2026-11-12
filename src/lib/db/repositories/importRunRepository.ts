import { Pool, PoolClient } from 'pg';
import { getPool } from '../pool';
import { ImportRunRecord, ImportStatus } from '../types';

export const CLOSELOOP_INGESTION_LOCK_ID = '8492048201';

export interface CreateImportRunParams {
  sourceProvider?: 'PAYPAL';
  sourceEnvironment?: 'SANDBOX' | 'LIVE';
  requestedStartDate: string;
  requestedEndDate: string;
  pageSize?: number;
  maxPages?: number;
}

export interface FinalizeImportRunParams {
  pagesFetched: number;
  recordsReceived: number;
  recordsInserted: number;
  recordsAlreadyPresent: number;
  recordsRejected: number;
  identityCollisionsDetected: number;
  importStatus?: ImportStatus;
  safeErrorCode?: string;
  safeErrorMessage?: string;
}

function mapRowToImportRun(row: Record<string, unknown>): ImportRunRecord {
  return {
    id: String(row.id),
    sourceProvider: row.source_provider as 'PAYPAL',
    sourceEnvironment: row.source_environment as 'SANDBOX' | 'LIVE',
    requestedStartDate: new Date(row.requested_start_date as string | Date).toISOString(),
    requestedEndDate: new Date(row.requested_end_date as string | Date).toISOString(),
    pageSize: Number(row.page_size),
    maxPages: Number(row.max_pages),
    startedAt: new Date(row.started_at as string | Date).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as string | Date).toISOString() : null,
    importStatus: row.import_status as ImportStatus,
    pagesFetched: Number(row.pages_fetched || 0),
    recordsReceived: Number(row.records_received || 0),
    recordsInserted: Number(row.records_inserted || 0),
    recordsAlreadyPresent: Number(row.records_already_present || 0),
    recordsRejected: Number(row.records_rejected || 0),
    identityCollisionsDetected: Number(row.identity_collisions_detected || 0),
    safeErrorCode: row.safe_error_code ? String(row.safe_error_code) : null,
    safeErrorMessage: row.safe_error_message ? String(row.safe_error_message) : null,
  };
}

/**
 * Creates a new ImportRun record in RUNNING status.
 */
export async function createImportRun(
  params: CreateImportRunParams,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord> {
  const runner = clientOrPool || getPool();
  const query = `
    INSERT INTO import_runs (
      source_provider,
      source_environment,
      requested_start_date,
      requested_end_date,
      page_size,
      max_pages,
      import_status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'RUNNING')
    RETURNING *;
  `;

  const values = [
    params.sourceProvider || 'PAYPAL',
    params.sourceEnvironment || 'SANDBOX',
    params.requestedStartDate,
    params.requestedEndDate,
    params.pageSize || 100,
    params.maxPages || 5,
  ];

  const res = await runner.query(query, values);
  return mapRowToImportRun(res.rows[0]);
}

/**
 * Finalizes an ImportRun record with completion metrics.
 */
export async function finalizeImportRun(
  id: string,
  params: FinalizeImportRunParams,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord> {
  const runner = clientOrPool || getPool();
  const query = `
    UPDATE import_runs SET
      pages_fetched = $1,
      records_received = $2,
      records_inserted = $3,
      records_already_present = $4,
      records_rejected = $5,
      identity_collisions_detected = $6,
      import_status = $7,
      safe_error_code = $8,
      safe_error_message = $9,
      completed_at = NOW()
    WHERE id = $10
    RETURNING *;
  `;

  const values = [
    params.pagesFetched,
    params.recordsReceived,
    params.recordsInserted,
    params.recordsAlreadyPresent,
    params.recordsRejected,
    params.identityCollisionsDetected,
    params.importStatus || 'COMPLETED',
    params.safeErrorCode || null,
    params.safeErrorMessage || null,
    id,
  ];

  const res = await runner.query(query, values);
  if (res.rows.length === 0) {
    throw new Error(`ImportRun with ID "${id}" not found.`);
  }
  return mapRowToImportRun(res.rows[0]);
}

/**
 * Retrieves an ImportRun by its unique ID.
 */
export async function getImportRunById(
  id: string,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord | null> {
  const runner = clientOrPool || getPool();
  const res = await runner.query('SELECT * FROM import_runs WHERE id = $1', [id]);
  if (res.rows.length === 0) return null;
  return mapRowToImportRun(res.rows[0]);
}

/**
 * Lists import runs with pagination.
 */
export async function listImportRuns(
  limit = 20,
  offset = 0,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord[]> {
  const runner = clientOrPool || getPool();
  const res = await runner.query(
    'SELECT * FROM import_runs ORDER BY started_at DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return res.rows.map(mapRowToImportRun);
}

/**
 * Initiates an ImportRun under a session-level exclusive advisory lock lease.
 * Coordinates with reconciliation snapshot establishment to prevent race conditions.
 */
export async function initiateImportRunLease(
  params: CreateImportRunParams,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord> {
  const runner = clientOrPool || getPool();
  const isDedicatedClient = !('connect' in runner && typeof (runner as Pool).connect === 'function');
  const client: PoolClient = isDedicatedClient ? (runner as PoolClient) : await (runner as Pool).connect();
  let clientReleased = isDedicatedClient;
  let lockTimeoutApplied = false;
  let lockAcquired = false;
  let txActive = false;
  let connectionTainted = false;

  const safeRelease = (destroy = false) => {
    if (!clientReleased) {
      clientReleased = true;
      client.release(destroy);
    }
  };

  try {
    // 1. Set bounded lock timeout to prevent indefinite pool blocking
    await client.query("SET lock_timeout = '3000ms';");
    lockTimeoutApplied = true;

    // 2. Acquire exclusive session-level coordination lock
    await client.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
    lockAcquired = true;

    // 3. Atomically insert RUNNING status lease in short-lived transaction
    await client.query('BEGIN;');
    txActive = true;
    const importRun = await createImportRun(params, client);
    await client.query('COMMIT;');
    txActive = false;

    return importRun;
  } catch (err: unknown) {
    if (txActive) {
      try {
        await client.query('ROLLBACK;');
      } catch (rbErr) {
        connectionTainted = true;
        console.error('[CloseLoop Transaction Rollback Error]:', rbErr);
      }
      txActive = false;
    }
    throw err;
  } finally {
    // Stage 1: Unlock advisory lock if acquired
    if (lockAcquired) {
      try {
        const unlockRes = await client.query<{ pg_advisory_unlock: boolean }>(
          'SELECT pg_advisory_unlock($1);',
          [CLOSELOOP_INGESTION_LOCK_ID]
        );
        if (unlockRes.rows[0]?.pg_advisory_unlock !== true) {
          connectionTainted = true;
          console.error(
            `[CloseLoop Unlock Warning]: pg_advisory_unlock returned false for key ${CLOSELOOP_INGESTION_LOCK_ID}`
          );
        }
      } catch (unlockErr) {
        connectionTainted = true;
        console.error('[CloseLoop Unlock Error]:', unlockErr);
      }
    }

    // Stage 2: Reset session-level lock_timeout if applied (regardless of lockAcquired)
    if (lockTimeoutApplied && !connectionTainted) {
      try {
        await client.query('RESET lock_timeout;');
      } catch (resetErr) {
        connectionTainted = true;
        console.error('[CloseLoop Reset Setting Error]:', resetErr);
      }
    }

    // Stage 3: Release client exactly once (destroy if tainted by any error)
    safeRelease(connectionTainted);
  }
}

/**
 * Finds any currently active (RUNNING) import runs intersecting the requested date window.
 */
export async function findIntersectingActiveRuns(
  startDate: string,
  endDate: string,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord[]> {
  const runner = clientOrPool || getPool();
  const query = `
    SELECT * FROM import_runs
    WHERE import_status = 'RUNNING'
      AND requested_start_date <= $2::TIMESTAMPTZ
      AND requested_end_date >= $1::TIMESTAMPTZ
    ORDER BY started_at DESC;
  `;
  const res = await runner.query(query, [startDate, endDate]);
  return res.rows.map(mapRowToImportRun);
}

/**
 * Finds unsuperseded incomplete import runs (PARTIAL, FAILED, COMPLETED_WITH_WARNINGS)
 * intersecting the requested date window.
 * An incomplete run is superseded iff a later COMPLETED run (0 rejections, 0 collisions, no error)
 * fully covers its entire requested date window.
 */
export async function findUnsupersededIncompleteRuns(
  startDate: string,
  endDate: string,
  clientOrPool?: PoolClient | Pool
): Promise<ImportRunRecord[]> {
  const runner = clientOrPool || getPool();
  const query = `
    SELECT
      i.*
    FROM import_runs i
    LEFT JOIN import_runs s ON (
      s.import_status = 'COMPLETED'
      AND s.records_rejected = 0
      AND s.identity_collisions_detected = 0
      AND s.safe_error_code IS NULL
      AND s.started_at > i.started_at
      AND s.requested_start_date <= i.requested_start_date
      AND s.requested_end_date >= i.requested_end_date
    )
    WHERE i.import_status IN ('PARTIAL', 'FAILED', 'COMPLETED_WITH_WARNINGS')
      AND i.requested_start_date <= $2::TIMESTAMPTZ
      AND i.requested_end_date >= $1::TIMESTAMPTZ
      AND s.id IS NULL
    ORDER BY i.started_at DESC;
  `;
  const res = await runner.query(query, [startDate, endDate]);
  return res.rows.map(mapRowToImportRun);
}

