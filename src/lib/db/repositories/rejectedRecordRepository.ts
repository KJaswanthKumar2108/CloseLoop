import { Pool, PoolClient } from 'pg';
import { getPool } from '../pool';
import { PayPalRejectedRecord } from '../types';
import { PayPalTransactionDetail } from '@/lib/paypal/transactionSchemas';

function mapRowToRejected(row: Record<string, unknown>): PayPalRejectedRecord {
  return {
    id: String(row.id),
    importRunId: String(row.import_run_id),
    paypalTransactionId: row.paypal_transaction_id ? String(row.paypal_transaction_id) : null,
    transactionEventCode: row.transaction_event_code ? String(row.transaction_event_code) : null,
    rejectionReason: String(row.rejection_reason),
    rejectionMessage: String(row.rejection_message),
    rawPayload: (typeof row.raw_payload === 'string'
      ? JSON.parse(row.raw_payload)
      : row.raw_payload) as PayPalTransactionDetail,
    rejectedAt: new Date(row.rejected_at as string | Date).toISOString(),
  };
}

export interface InsertRejectedRecordParams {
  importRunId: string;
  paypalTransactionId?: string | null;
  transactionEventCode?: string | null;
  rejectionReason: string;
  rejectionMessage: string;
  rawPayload: PayPalTransactionDetail;
}

/**
 * Inserts a rejected record with complete diagnostic information and original JSON payload.
 */
export async function insertRejectedRecord(
  params: InsertRejectedRecordParams,
  clientOrPool?: PoolClient | Pool
): Promise<PayPalRejectedRecord> {
  const runner = clientOrPool || getPool();
  const query = `
    INSERT INTO paypal_rejected_records (
      import_run_id,
      paypal_transaction_id,
      transaction_event_code,
      rejection_reason,
      rejection_message,
      raw_payload
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;

  const values = [
    params.importRunId,
    params.paypalTransactionId ?? null,
    params.transactionEventCode ?? null,
    params.rejectionReason,
    params.rejectionMessage,
    JSON.stringify(params.rawPayload),
  ];

  const res = await runner.query(query, values);
  return mapRowToRejected(res.rows[0]);
}

/**
 * Retrieves all rejected records for a given import run.
 */
export async function getRejectedRecordsByRunId(
  runId: string,
  clientOrPool?: PoolClient | Pool
): Promise<PayPalRejectedRecord[]> {
  const runner = clientOrPool || getPool();
  const res = await runner.query(
    'SELECT * FROM paypal_rejected_records WHERE import_run_id = $1 ORDER BY rejected_at ASC',
    [runId]
  );
  return res.rows.map(mapRowToRejected);
}

