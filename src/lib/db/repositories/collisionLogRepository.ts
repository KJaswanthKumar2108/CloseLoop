import { Pool, PoolClient } from 'pg';
import { getPool } from '../pool';
import { IdentityCollisionLogRecord } from '../types';
import { PayPalTransactionDetail } from '@/lib/paypal/transactionSchemas';

function mapRowToCollision(row: Record<string, unknown>): IdentityCollisionLogRecord {
  return {
    id: String(row.id),
    importRunId: String(row.import_run_id),
    fingerprint: String(row.fingerprint),
    paypalTransactionId: String(row.paypal_transaction_id),
    collisionType: row.collision_type as 'WITHIN_BATCH_DUPLICATE' | 'CROSS_BATCH_DISCREPANCY',
    details: String(row.details),
    rawPayload: (typeof row.raw_payload === 'string'
      ? JSON.parse(row.raw_payload)
      : row.raw_payload) as PayPalTransactionDetail,
    loggedAt: new Date(row.logged_at as string | Date).toISOString(),
  };
}

export interface InsertCollisionLogParams {
  importRunId: string;
  fingerprint: string;
  paypalTransactionId: string;
  collisionType: 'WITHIN_BATCH_DUPLICATE' | 'CROSS_BATCH_DISCREPANCY';
  details: string;
  rawPayload: PayPalTransactionDetail;
}

/**
 * Inserts an identity collision audit log entry.
 */
export async function insertCollisionLog(
  params: InsertCollisionLogParams,
  clientOrPool?: PoolClient | Pool
): Promise<IdentityCollisionLogRecord> {
  const runner = clientOrPool || getPool();
  const query = `
    INSERT INTO identity_collision_logs (
      import_run_id,
      fingerprint,
      paypal_transaction_id,
      collision_type,
      details,
      raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;

  const values = [
    params.importRunId,
    params.fingerprint,
    params.paypalTransactionId,
    params.collisionType,
    params.details,
    JSON.stringify(params.rawPayload),
  ];

  const res = await runner.query(query, values);
  return mapRowToCollision(res.rows[0]);
}

/**
 * Retrieves all collision logs for a given import run.
 */
export async function getCollisionLogsByRunId(
  runId: string,
  clientOrPool?: PoolClient | Pool
): Promise<IdentityCollisionLogRecord[]> {
  const runner = clientOrPool || getPool();
  const res = await runner.query(
    'SELECT * FROM identity_collision_logs WHERE import_run_id = $1 ORDER BY logged_at ASC',
    [runId]
  );
  return res.rows.map(mapRowToCollision);
}

