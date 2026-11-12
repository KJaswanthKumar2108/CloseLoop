import { Pool, PoolClient } from 'pg';
import { getPool } from '../pool';
import { PayPalImportedTransactionRecord, ReconciliationEligibilityStatus, IdentityCollisionStatus } from '../types';
import { TransactionType, TransactionStatus } from '@/types/financial';

function parseSafeInteger(val: unknown, fieldName: string): number {
  if (val === null || val === undefined) return 0;
  const num = typeof val === 'number' ? val : Number(val);
  if (!Number.isSafeInteger(num)) {
    throw new Error(`Value for "${fieldName}" (${String(val)}) exceeds JavaScript Number.MAX_SAFE_INTEGER.`);
  }
  return num;
}

function mapRowToTransaction(row: Record<string, unknown>): PayPalImportedTransactionRecord {
  return {
    id: String(row.id),
    paypalTransactionId: String(row.paypal_transaction_id),
    fingerprint: String(row.fingerprint),
    transactionEventCode: String(row.transaction_event_code),
    transactionType: row.transaction_type as TransactionType,
    transactionStatus: row.transaction_status as TransactionStatus,
    grossAmountMinor: parseSafeInteger(row.gross_amount_minor, 'gross_amount_minor'),
    currency: String(row.currency),
    currencyPrecision: Number(row.currency_precision),
    feeAmountMinor: row.fee_amount_minor !== null ? parseSafeInteger(row.fee_amount_minor, 'fee_amount_minor') : null,
    netAmountMinor: row.net_amount_minor !== null ? parseSafeInteger(row.net_amount_minor, 'net_amount_minor') : null,
    transactionTime: new Date(row.transaction_time as string | Date).toISOString(),
    paypalReferenceId: row.paypal_reference_id ? String(row.paypal_reference_id) : null,
    paypalReferenceType: row.paypal_reference_type ? String(row.paypal_reference_type) : null,
    paypalOrderId: row.paypal_order_id ? String(row.paypal_order_id) : null,
    paypalCaptureId: row.paypal_capture_id ? String(row.paypal_capture_id) : null,
    invoiceId: row.invoice_id ? String(row.invoice_id) : null,
    merchantReference: row.merchant_reference ? String(row.merchant_reference) : null,
    sourceEnvironment: row.source_environment as 'SANDBOX' | 'LIVE',
    sourceProvider: row.source_provider as 'PAYPAL',
    firstImportedAt: new Date(row.first_imported_at as string | Date).toISOString(),
    lastObservedAt: new Date(row.last_observed_at as string | Date).toISOString(),
    firstImportRunId: String(row.first_import_run_id),
    lastImportRunId: String(row.last_import_run_id),
    reconciliationEligible: Boolean(row.reconciliation_eligible),
    reconciliationEligibilityStatus: row.reconciliation_eligibility_status as ReconciliationEligibilityStatus,
    identityCollisionStatus: row.identity_collision_status as IdentityCollisionStatus,
    rawReference: String(row.raw_reference),
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString(),
  };
}

/**
 * Checks for existing fingerprints in the database.
 * Returns a map of fingerprint -> existing record.
 */
export async function findExistingFingerprints(
  fingerprints: string[],
  clientOrPool?: PoolClient | Pool
): Promise<Map<string, PayPalImportedTransactionRecord>> {
  if (fingerprints.length === 0) return new Map();

  const runner = clientOrPool || getPool();
  const placeholders = fingerprints.map((_, i) => `$${i + 1}`).join(', ');
  const res = await runner.query(
    `SELECT * FROM paypal_imported_transactions WHERE fingerprint IN (${placeholders})`,
    fingerprints
  );

  const map = new Map<string, PayPalImportedTransactionRecord>();
  for (const row of res.rows) {
    const record = mapRowToTransaction(row);
    map.set(record.fingerprint, record);
  }
  return map;
}

export interface InsertTransactionParams {
  paypalTransactionId: string;
  fingerprint: string;
  transactionEventCode: string;
  transactionType: TransactionType;
  transactionStatus: TransactionStatus;
  grossAmountMinor: number;
  currency: string;
  currencyPrecision: number;
  feeAmountMinor?: number | null;
  netAmountMinor?: number | null;
  transactionTime: string;
  paypalReferenceId?: string | null;
  paypalReferenceType?: string | null;
  paypalOrderId?: string | null;
  paypalCaptureId?: string | null;
  invoiceId?: string | null;
  merchantReference?: string | null;
  sourceEnvironment?: 'SANDBOX' | 'LIVE';
  importRunId: string;
  reconciliationEligible: boolean;
  reconciliationEligibilityStatus: ReconciliationEligibilityStatus;
  identityCollisionStatus?: IdentityCollisionStatus;
  rawReference: string;
}

/**
 * Inserts a new PayPal imported transaction record.
 * Enforces database-level uniqueness via UNIQUE constraint on fingerprint.
 * When options.onConflict is 'DO_NOTHING', returns null if fingerprint already exists.
 */
export async function insertImportedTransaction(
  params: InsertTransactionParams,
  clientOrPool?: PoolClient | Pool,
  options?: { onConflict?: 'THROW' }
): Promise<PayPalImportedTransactionRecord>;
export async function insertImportedTransaction(
  params: InsertTransactionParams,
  clientOrPool?: PoolClient | Pool,
  options?: { onConflict: 'DO_NOTHING' }
): Promise<PayPalImportedTransactionRecord | null>;
export async function insertImportedTransaction(
  params: InsertTransactionParams,
  clientOrPool?: PoolClient | Pool,
  options?: { onConflict?: 'THROW' | 'DO_NOTHING' }
): Promise<PayPalImportedTransactionRecord | null> {
  const runner = clientOrPool || getPool();

  if (options?.onConflict === 'DO_NOTHING') {
    const existing = await runner.query(
      'SELECT id FROM paypal_imported_transactions WHERE fingerprint = $1',
      [params.fingerprint]
    );
    if (existing.rows.length > 0) {
      return null;
    }
  }

  const onConflictClause =
    options?.onConflict === 'DO_NOTHING'
      ? 'ON CONFLICT (fingerprint) DO NOTHING'
      : '';

  const query = `
    INSERT INTO paypal_imported_transactions (
      paypal_transaction_id,
      fingerprint,
      transaction_event_code,
      transaction_type,
      transaction_status,
      gross_amount_minor,
      currency,
      currency_precision,
      fee_amount_minor,
      net_amount_minor,
      transaction_time,
      paypal_reference_id,
      paypal_reference_type,
      paypal_order_id,
      paypal_capture_id,
      invoice_id,
      merchant_reference,
      source_environment,
      source_provider,
      first_import_run_id,
      last_import_run_id,
      reconciliation_eligible,
      reconciliation_eligibility_status,
      identity_collision_status,
      raw_reference
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18, 'PAYPAL', $19,
      $19, $20, $21, $22, $23
    )
    ${onConflictClause}
    RETURNING *;
  `;

  const values = [
    params.paypalTransactionId,
    params.fingerprint,
    params.transactionEventCode,
    params.transactionType,
    params.transactionStatus,
    params.grossAmountMinor,
    params.currency,
    params.currencyPrecision,
    params.feeAmountMinor ?? null,
    params.netAmountMinor ?? null,
    params.transactionTime,
    params.paypalReferenceId ?? null,
    params.paypalReferenceType ?? null,
    params.paypalOrderId ?? null,
    params.paypalCaptureId ?? null,
    params.invoiceId ?? null,
    params.merchantReference ?? null,
    params.sourceEnvironment || 'SANDBOX',
    params.importRunId,
    params.reconciliationEligible,
    params.reconciliationEligibilityStatus,
    params.identityCollisionStatus || 'NONE',
    params.rawReference,
  ];

  const res = await runner.query(query, values);
  if (res.rows.length === 0) {
    return null;
  }
  return mapRowToTransaction(res.rows[0]);
}

/**
 * Updates observation provenance for an already present transaction.
 * NEVER overwrites original financial amounts or first_import_run_id.
 */
export async function updateObservationProvenance(
  fingerprint: string,
  importRunId: string,
  clientOrPool?: PoolClient | Pool
): Promise<void> {
  const runner = clientOrPool || getPool();
  await runner.query(
    `
      UPDATE paypal_imported_transactions SET
        last_observed_at = NOW(),
        last_import_run_id = $1,
        updated_at = NOW()
      WHERE fingerprint = $2
    `,
    [importRunId, fingerprint]
  );
}

/**
 * Retrieves a transaction by fingerprint.
 */
export async function getTransactionByFingerprint(
  fingerprint: string,
  clientOrPool?: PoolClient | Pool
): Promise<PayPalImportedTransactionRecord | null> {
  const runner = clientOrPool || getPool();
  const res = await runner.query(
    'SELECT * FROM paypal_imported_transactions WHERE fingerprint = $1',
    [fingerprint]
  );
  if (res.rows.length === 0) return null;
  return mapRowToTransaction(res.rows[0]);
}

/**
 * Retrieves all transactions first introduced by an import run.
 */
export async function getTransactionsByRunId(
  runId: string,
  clientOrPool?: PoolClient | Pool
): Promise<PayPalImportedTransactionRecord[]> {
  const runner = clientOrPool || getPool();
  const res = await runner.query(
    'SELECT * FROM paypal_imported_transactions WHERE first_import_run_id = $1 ORDER BY transaction_time ASC',
    [runId]
  );
  return res.rows.map(mapRowToTransaction);
}

export interface ListImportedTransactionsFilter {
  page?: number;
  pageSize?: number;
  transactionType?: TransactionType;
  transactionStatus?: TransactionStatus;
  currency?: string;
  startDate?: string;
  endDate?: string;
  importRunId?: string;
  reconciliationEligible?: boolean;
  identityCollisionStatus?: IdentityCollisionStatus;
}

export interface ListImportedTransactionsResult {
  transactions: PayPalImportedTransactionRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Lists imported transactions with pagination and multi-parameter filtering.
 */
export async function listImportedTransactions(
  filter: ListImportedTransactionsFilter = {},
  clientOrPool?: PoolClient | Pool
): Promise<ListImportedTransactionsResult> {
  const runner = clientOrPool || getPool();
  const page = Math.max(1, filter.page || 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize || 50));
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  let paramIdx = 1;

  if (filter.transactionType) {
    conditions.push(`transaction_type = $${paramIdx++}`);
    values.push(filter.transactionType);
  }
  if (filter.transactionStatus) {
    conditions.push(`transaction_status = $${paramIdx++}`);
    values.push(filter.transactionStatus);
  }
  if (filter.currency) {
    conditions.push(`currency = $${paramIdx++}`);
    values.push(filter.currency.toUpperCase().trim());
  }
  if (filter.startDate) {
    conditions.push(`transaction_time >= $${paramIdx++}`);
    values.push(filter.startDate);
  }
  if (filter.endDate) {
    conditions.push(`transaction_time <= $${paramIdx++}`);
    values.push(filter.endDate);
  }
  if (filter.importRunId) {
    conditions.push(`(first_import_run_id = $${paramIdx} OR last_import_run_id = $${paramIdx})`);
    paramIdx++;
    values.push(filter.importRunId);
  }
  if (filter.reconciliationEligible !== undefined) {
    conditions.push(`reconciliation_eligible = $${paramIdx++}`);
    values.push(filter.reconciliationEligible);
  }
  if (filter.identityCollisionStatus) {
    conditions.push(`identity_collision_status = $${paramIdx++}`);
    values.push(filter.identityCollisionStatus);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total count
  const countRes = await runner.query(
    `SELECT COUNT(*) AS total FROM paypal_imported_transactions ${whereClause}`,
    values
  );
  const totalCount = Number(countRes.rows[0]?.total || 0);

  // Get paginated rows
  const queryValues = [...values, pageSize, offset];
  const query = `
    SELECT * FROM paypal_imported_transactions
    ${whereClause}
    ORDER BY transaction_time DESC, created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  const res = await runner.query(query, queryValues);

  return {
    transactions: res.rows.map(mapRowToTransaction),
    totalCount,
    page,
    pageSize,
    totalPages: Math.ceil(totalCount / pageSize) || 1,
  };
}
