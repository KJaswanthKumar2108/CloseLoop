import { Pool, PoolClient } from 'pg';
import { getPool } from '@/lib/db/pool';
import { ImportRunRecord } from '@/lib/db/types';
import {
  CLOSELOOP_INGESTION_LOCK_ID,
  findIntersectingActiveRuns,
  findUnsupersededIncompleteRuns,
} from '@/lib/db/repositories/importRunRepository';
import { PaymentTransaction, TransactionType, TransactionStatus } from '@/types/financial';
import { createMoney } from '@/lib/reconciliation/money';

export class PersistedLedgerError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.name = 'PersistedLedgerError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Object.setPrototypeOf(this, PersistedLedgerError.prototype);
  }
}

export interface PersistedSourcingParams {
  startDate: string;
  endDate: string;
  acknowledgedPartial?: boolean;
}

export interface AdapterRejection {
  transactionId: string;
  reason: string;
  detail: string;
}

export interface PersistedSourcingResult {
  transactions: PaymentTransaction[];
  totalEligibleCount: number;
  adapterRejectedCount: number;
  adapterRejections: AdapterRejection[];
  isPartial: boolean;
  partialNotice?: string;
  intersectingIncompleteRuns: ImportRunRecord[];
}

export const COUNT_ELIGIBLE_SQL = `
  SELECT COUNT(*) AS total
  FROM paypal_imported_transactions
  WHERE reconciliation_eligible = TRUE
    AND transaction_time >= $1::TIMESTAMPTZ
    AND transaction_time <= $2::TIMESTAMPTZ;
`;

export const SELECT_ELIGIBLE_SQL = `
  SELECT
    id,
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
    first_imported_at,
    last_observed_at,
    first_import_run_id,
    last_import_run_id,
    reconciliation_eligible,
    reconciliation_eligibility_status,
    identity_collision_status,
    raw_reference,
    created_at,
    updated_at
  FROM paypal_imported_transactions
  WHERE reconciliation_eligible = TRUE
    AND transaction_time >= $1::TIMESTAMPTZ
    AND transaction_time <= $2::TIMESTAMPTZ
  ORDER BY transaction_time ASC, created_at ASC;
`;

/**
 * Validates and transforms a single database row into a PaymentTransaction domain entity.
 * Enforces Tier 2 Defense-in-Depth financial invariants.
 * Returns null if the row violates invariants, logging the rejection reason.
 */
export function mapRecordToPaymentTransaction(
  row: Record<string, unknown>
): { transaction: PaymentTransaction | null; rejection: AdapterRejection | null } {
  const rawTxnId = String(row.paypal_transaction_id || '').trim();
  if (!rawTxnId) {
    return {
      transaction: null,
      rejection: {
        transactionId: 'UNKNOWN',
        reason: 'INVALID_TRANSACTION_ID',
        detail: 'Record lacks a valid paypal_transaction_id.',
      },
    };
  }

  // Quarantined collisions must never enter reconciliation
  if (row.identity_collision_status && row.identity_collision_status !== 'NONE') {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'QUARANTINED_COLLISION',
        detail: `Record has collision status "${row.identity_collision_status}".`,
      },
    };
  }

  // Check reconciliation_eligible flag
  if (row.reconciliation_eligible !== true) {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'INELIGIBLE_NON_SETTLED',
        detail: `Record is not flagged as reconciliation_eligible (${row.reconciliation_eligibility_status}).`,
      },
    };
  }

  // Currency validation
  const currency = String(row.currency || '').trim().toUpperCase();
  if (!currency || currency.length !== 3) {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'INVALID_CURRENCY',
        detail: `Currency code "${currency}" is invalid.`,
      },
    };
  }

  // Gross amount minor safe integer check
  const grossRaw = row.gross_amount_minor;
  const grossAmountMinor = typeof grossRaw === 'number' ? grossRaw : Number(grossRaw);
  if (!Number.isSafeInteger(grossAmountMinor)) {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'UNSAFE_FINANCIAL_AMOUNT',
        detail: `gross_amount_minor (${String(grossRaw)}) is not a safe integer.`,
      },
    };
  }

  // Fee amount minor check (optional)
  let feeAmountMinor: number | null = null;
  if (row.fee_amount_minor !== null && row.fee_amount_minor !== undefined) {
    const feeRaw = row.fee_amount_minor;
    const feeNum = typeof feeRaw === 'number' ? feeRaw : Number(feeRaw);
    if (!Number.isSafeInteger(feeNum)) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'UNSAFE_FINANCIAL_AMOUNT',
          detail: `fee_amount_minor (${String(feeRaw)}) is not a safe integer.`,
        },
      };
    }
    feeAmountMinor = feeNum;
  }

  // Net amount minor check (optional)
  let netAmountMinor: number | null = null;
  if (row.net_amount_minor !== null && row.net_amount_minor !== undefined) {
    const netRaw = row.net_amount_minor;
    const netNum = typeof netRaw === 'number' ? netRaw : Number(netRaw);
    if (!Number.isSafeInteger(netNum)) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'UNSAFE_FINANCIAL_AMOUNT',
          detail: `net_amount_minor (${String(netRaw)}) is not a safe integer.`,
        },
      };
    }
    netAmountMinor = netNum;
  }

  // Timestamp check
  const txnTime = new Date(row.transaction_time as string | Date);
  if (isNaN(txnTime.getTime())) {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'INVALID_TRANSACTION_TIME',
        detail: `transaction_time "${String(row.transaction_time)}" is not a valid date.`,
      },
    };
  }

  const txType = row.transaction_type as TransactionType;
  const txStatus = row.transaction_status as TransactionStatus;

  // Invariant validation by TransactionType
  let resolvedCaptureId: string | undefined = undefined;
  let resolvedOrderId: string | undefined = undefined;

  if (txType === 'CAPTURE') {
    if (txStatus !== 'COMPLETED') {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'INELIGIBLE_NON_SETTLED',
          detail: `Capture in status "${txStatus}" is not settled customer revenue.`,
        },
      };
    }
    if (grossAmountMinor <= 0) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'NON_POSITIVE_CAPTURE_AMOUNT',
          detail: `Capture amount (${grossAmountMinor}) must be positive.`,
        },
      };
    }

    if (row.paypal_order_id) {
      resolvedOrderId = String(row.paypal_order_id);
    } else if (row.paypal_reference_type === 'ODR' && row.paypal_reference_id) {
      resolvedOrderId = String(row.paypal_reference_id);
    }

    if (row.paypal_capture_id) {
      resolvedCaptureId = String(row.paypal_capture_id);
    } else if (row.paypal_reference_type === 'TXN' && row.paypal_reference_id) {
      resolvedCaptureId = String(row.paypal_reference_id);
    } else if (!resolvedOrderId) {
      resolvedCaptureId = rawTxnId;
    }
  } else if (txType === 'REFUND') {
    if (txStatus !== 'COMPLETED') {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'INELIGIBLE_NON_SETTLED',
          detail: `Refund in status "${txStatus}" is not settled.`,
        },
      };
    }
    if (grossAmountMinor >= 0) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'NON_NEGATIVE_REFUND_AMOUNT',
          detail: `Refund gross amount (${grossAmountMinor}) must be negative.`,
        },
      };
    }

    // Reference type validation (F-12 & F-08)
    const refType = row.paypal_reference_type
      ? String(row.paypal_reference_type).toUpperCase().trim()
      : null;

    if (refType && ['SUB', 'CASE', 'DIS', 'PAP'].includes(refType)) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'REFUND_UNSUPPORTED_REFERENCE_TYPE',
          detail: `Refund reference type "${refType}" is not an order or capture reference.`,
        },
      };
    }

    const refId = row.paypal_reference_id ? String(row.paypal_reference_id).trim() : null;
    const orderId = row.paypal_order_id ? String(row.paypal_order_id).trim() : null;
    const captureId = row.paypal_capture_id ? String(row.paypal_capture_id).trim() : null;

    if (refType === 'TXN') {
      const candidate = (captureId && captureId !== rawTxnId) ? captureId : (refId && refId !== rawTxnId) ? refId : null;
      if (candidate) {
        resolvedCaptureId = candidate;
        resolvedOrderId = undefined;
      }
    } else if (refType === 'ODR') {
      const candidate = (orderId && orderId !== rawTxnId) ? orderId : (refId && refId !== rawTxnId) ? refId : null;
      if (candidate) {
        resolvedOrderId = candidate;
        resolvedCaptureId = undefined;
      }
    } else {
      if (captureId && captureId !== rawTxnId) {
        resolvedCaptureId = captureId;
      } else if (orderId && orderId !== rawTxnId) {
        resolvedOrderId = orderId;
      } else if (refId && refId !== rawTxnId) {
        resolvedCaptureId = refId;
      }
    }

    // Fail closed on self-fallbacks or missing parent references
    if (!resolvedCaptureId && !resolvedOrderId) {
      return {
        transaction: null,
        rejection: {
          transactionId: rawTxnId,
          reason: 'REFUND_MISSING_PARENT_REFERENCE',
          detail: 'Refund lacks a verified parent capture or order reference distinct from its own ID.',
        },
      };
    }
  } else {
    return {
      transaction: null,
      rejection: {
        transactionId: rawTxnId,
        reason: 'INELIGIBLE_TRANSACTION_TYPE',
        detail: `Transaction type "${txType}" cannot be reconciled against merchant customer orders.`,
      },
    };
  }

  const transaction: PaymentTransaction = {
    id: String(row.id),
    paypalTransactionId: rawTxnId,
    paypalOrderId: resolvedOrderId,
    paypalCaptureId: resolvedCaptureId,
    invoiceId: row.invoice_id ? String(row.invoice_id) : undefined,
    merchantReference: row.merchant_reference ? String(row.merchant_reference) : undefined,
    grossAmount: createMoney(grossAmountMinor, currency),
    feeAmount: feeAmountMinor !== null ? createMoney(feeAmountMinor, currency) : undefined,
    netAmount: netAmountMinor !== null ? createMoney(netAmountMinor, currency) : undefined,
    currency,
    transactionType: txType,
    transactionStatus: txStatus,
    transactionTime: txnTime.toISOString(),
    source: 'PAYPAL_API',
    rawReference: String(row.raw_reference || row.fingerprint || rawTxnId),
  };

  return { transaction, rejection: null };
}

/**
 * Maps raw database rows into domain PaymentTransaction entities,
 * applying Tier 2 Defense-in-Depth checks.
 */
export function mapAndFilterEligibleRecords(
  rows: Record<string, unknown>[],
  totalEligible: number,
  incompleteRuns: ImportRunRecord[] = [],
  acknowledgedPartial = false
): PersistedSourcingResult {
  const transactions: PaymentTransaction[] = [];
  const adapterRejections: AdapterRejection[] = [];

  for (const row of rows) {
    const { transaction, rejection } = mapRecordToPaymentTransaction(row);
    if (transaction) {
      transactions.push(transaction);
    }
    if (rejection) {
      adapterRejections.push(rejection);
    }
  }

  const hasIncomplete = incompleteRuns.length > 0;
  return {
    transactions,
    totalEligibleCount: totalEligible,
    adapterRejectedCount: adapterRejections.length,
    adapterRejections,
    isPartial: hasIncomplete && acknowledgedPartial,
    partialNotice:
      hasIncomplete && acknowledgedPartial
        ? 'Dataset includes transactions from a date window containing acknowledged incomplete or warning-bearing imports.'
        : undefined,
    intersectingIncompleteRuns: incompleteRuns,
  };
}

/**
 * Fetches persisted PayPal transactions for deterministic reconciliation.
 * Enforces session-level advisory locking, REPEATABLE READ snapshot consistency,
 * active mutation blocking (409), unsuperseded incomplete checking (422),
 * and bounded dataset size enforcement (max 5,000 records).
 */
export async function fetchEligibleTransactionsForReconciliation(
  params: PersistedSourcingParams,
  clientOrPool?: PoolClient | Pool
): Promise<PersistedSourcingResult> {
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
    // 1. Set bounded lock timeout (3,000ms)
    await client.query("SET lock_timeout = '3000ms';");
    lockTimeoutApplied = true;

    // 2. Acquire shared session-level coordination lock OUTSIDE transaction (auto-commit)
    await client.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
    lockAcquired = true;

    try {
      // 3. Begin REPEATABLE READ transaction ONLY AFTER lock is acquired
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
      txActive = true;

      // 4. Query 1A: Check for active intersecting RUNNING imports (Hard block HTTP 409)
      const activeRuns = await findIntersectingActiveRuns(params.startDate, params.endDate, client);
      if (activeRuns.length > 0) {
        throw new PersistedLedgerError(
          'IMPORT_RUN_IN_PROGRESS',
          'Active PayPal import in progress for requested date window.',
          409,
          activeRuns
        );
      }

      // Query 1B: Check unsuperseded incomplete runs (F-18A: PARTIAL, FAILED, COMPLETED_WITH_WARNINGS)
      const incompleteRuns = await findUnsupersededIncompleteRuns(params.startDate, params.endDate, client);
      if (incompleteRuns.length > 0 && !params.acknowledgedPartial) {
        throw new PersistedLedgerError(
          'INCOMPLETE_IMPORT_INTERSECTION',
          'Unsuperseded partial, failed, or warning-bearing import runs in window.',
          422,
          incompleteRuns
        );
      }

      // 5. Query 2: Atomic COUNT(*) within same snapshot (F-07)
      const countRes = await client.query(COUNT_ELIGIBLE_SQL, [params.startDate, params.endDate]);
      const totalEligible = Number(countRes.rows[0]?.total ?? countRes.rows[0]?.count ?? 0);
      if (totalEligible > 5000) {
        throw new PersistedLedgerError(
          'DATASET_LIMIT_EXCEEDED',
          `Eligible transaction count (${totalEligible}) exceeds maximum limit of 5,000. Narrow your date window.`,
          422,
          { totalEligible, limit: 5000 }
        );
      }

      // 6. Query 3: Bounded SELECT within identical snapshot
      const recordsRes = await client.query(SELECT_ELIGIBLE_SQL, [params.startDate, params.endDate]);

      await client.query('COMMIT;');
      txActive = false;

      // 7. Tier 2 Defense-in-Depth Adapter Invariant Checks (TypeScript layer)
      return mapAndFilterEligibleRecords(
        recordsRes.rows,
        totalEligible,
        incompleteRuns,
        params.acknowledgedPartial
      );
    } catch (txErr) {
      if (txActive) {
        try {
          await client.query('ROLLBACK;');
        } catch (rbErr) {
          connectionTainted = true;
          console.error('[CloseLoop Transaction Rollback Error]:', rbErr);
        }
        txActive = false;
      }
      throw txErr;
    }
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      (('code' in err && (err as { code: string }).code === '55P03') ||
        ('message' in err && String((err as { message: string }).message).includes('lock timeout')))
    ) {
      throw new PersistedLedgerError(
        'IMPORT_RUN_IN_PROGRESS',
        'Database coordination lock acquisition timed out. An import run is currently in progress.',
        409
      );
    }
    throw err;
  } finally {
    // Stage 1: Unlock shared advisory lock if acquired
    if (lockAcquired) {
      try {
        const unlockRes = await client.query<{ pg_advisory_unlock_shared: boolean }>(
          'SELECT pg_advisory_unlock_shared($1);',
          [CLOSELOOP_INGESTION_LOCK_ID]
        );
        if (unlockRes.rows[0]?.pg_advisory_unlock_shared !== true) {
          connectionTainted = true;
          console.error(
            `[CloseLoop Unlock Warning]: pg_advisory_unlock_shared returned false for key ${CLOSELOOP_INGESTION_LOCK_ID}`
          );
        }
      } catch (unlockErr) {
        connectionTainted = true;
        console.error('[CloseLoop Shared Unlock Error]:', unlockErr);
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
