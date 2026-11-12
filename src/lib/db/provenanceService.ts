import { Pool, PoolClient } from 'pg';
import { getPool } from './pool';
import { finalizeImportRun } from './repositories/importRunRepository';
import {
  findExistingFingerprints,
  insertImportedTransaction,
  updateObservationProvenance,
  getTransactionByFingerprint,
} from './repositories/paypalTransactionRepository';
import { insertRejectedRecord } from './repositories/rejectedRecordRepository';
import { insertCollisionLog } from './repositories/collisionLogRepository';
import { determineReconciliationEligibility } from './eligibility';
import { PaymentTransaction, TransactionType, TransactionStatus } from '@/types/financial';
import { PayPalTransactionDetail } from '@/lib/paypal/transactionSchemas';
import { IdentityCollisionStatus, ImportStatus, PayPalImportedTransactionRecord } from './types';

export interface BatchItemInput {
  normalized?: PaymentTransaction;
  rejected?: {
    reason: string;
    message: string;
    rawDetail: PayPalTransactionDetail;
  };
  rawDetail: PayPalTransactionDetail;
}

export interface RecordPayPalImportBatchParams {
  importRunId: string;
  pagesFetched?: number;
  isTruncated?: boolean;
  items: BatchItemInput[];
}

export interface BatchImportResult {
  importRunId: string;
  recordsReceived: number;
  recordsInserted: number;
  recordsAlreadyPresent: number;
  recordsRejected: number;
  identityCollisionsDetected: number;
  crossBatchDiscrepancies: number;
  status: ImportStatus;
}

export interface CanonicalComparisonResult {
  isEquivalent: boolean;
  differences: string[];
}

/**
 * Compares an incoming normalized record with an existing database record
 * across all financially and identity-relevant canonical attributes.
 */
export function compareCanonicalTransaction(
  incoming: {
    paypalTransactionId: string;
    transactionEventCode: string;
    transactionType: TransactionType;
    transactionStatus: TransactionStatus;
    grossAmountMinor: number;
    currency: string;
    feeAmountMinor?: number | null;
    netAmountMinor?: number | null;
    transactionTime: string;
    paypalReferenceId?: string | null;
    paypalReferenceType?: string | null;
    paypalOrderId?: string | null;
    paypalCaptureId?: string | null;
    invoiceId?: string | null;
    merchantReference?: string | null;
  },
  existing: PayPalImportedTransactionRecord
): CanonicalComparisonResult {
  const differences: string[] = [];

  if (incoming.paypalTransactionId !== existing.paypalTransactionId) {
    differences.push(
      `paypalTransactionId: existing="${existing.paypalTransactionId}", incoming="${incoming.paypalTransactionId}"`
    );
  }
  if (incoming.transactionEventCode !== existing.transactionEventCode) {
    differences.push(
      `transactionEventCode: existing="${existing.transactionEventCode}", incoming="${incoming.transactionEventCode}"`
    );
  }
  if (incoming.transactionType !== existing.transactionType) {
    differences.push(
      `transactionType: existing="${existing.transactionType}", incoming="${incoming.transactionType}"`
    );
  }
  if (incoming.transactionStatus !== existing.transactionStatus) {
    differences.push(
      `transactionStatus: existing="${existing.transactionStatus}", incoming="${incoming.transactionStatus}"`
    );
  }
  if (incoming.grossAmountMinor !== existing.grossAmountMinor) {
    differences.push(
      `grossAmountMinor: existing=${existing.grossAmountMinor}, incoming=${incoming.grossAmountMinor}`
    );
  }
  if (incoming.currency !== existing.currency) {
    differences.push(
      `currency: existing="${existing.currency}", incoming="${incoming.currency}"`
    );
  }
  if ((incoming.feeAmountMinor ?? null) !== (existing.feeAmountMinor ?? null)) {
    differences.push(
      `feeAmountMinor: existing=${existing.feeAmountMinor}, incoming=${incoming.feeAmountMinor ?? null}`
    );
  }
  if ((incoming.netAmountMinor ?? null) !== (existing.netAmountMinor ?? null)) {
    differences.push(
      `netAmountMinor: existing=${existing.netAmountMinor}, incoming=${incoming.netAmountMinor ?? null}`
    );
  }

  const inMs = new Date(incoming.transactionTime).getTime();
  const exMs = new Date(existing.transactionTime).getTime();
  if (inMs !== exMs) {
    differences.push(
      `transactionTime: existing="${existing.transactionTime}", incoming="${incoming.transactionTime}"`
    );
  }
  if ((incoming.paypalReferenceId ?? null) !== (existing.paypalReferenceId ?? null)) {
    differences.push(
      `paypalReferenceId: existing="${existing.paypalReferenceId}", incoming="${incoming.paypalReferenceId ?? null}"`
    );
  }
  if ((incoming.paypalReferenceType ?? null) !== (existing.paypalReferenceType ?? null)) {
    differences.push(
      `paypalReferenceType: existing="${existing.paypalReferenceType}", incoming="${incoming.paypalReferenceType ?? null}"`
    );
  }
  if ((incoming.paypalOrderId ?? null) !== (existing.paypalOrderId ?? null)) {
    differences.push(
      `paypalOrderId: existing="${existing.paypalOrderId}", incoming="${incoming.paypalOrderId ?? null}"`
    );
  }
  if ((incoming.paypalCaptureId ?? null) !== (existing.paypalCaptureId ?? null)) {
    differences.push(
      `paypalCaptureId: existing="${existing.paypalCaptureId}", incoming="${incoming.paypalCaptureId ?? null}"`
    );
  }
  if ((incoming.invoiceId ?? null) !== (existing.invoiceId ?? null)) {
    differences.push(
      `invoiceId: existing="${existing.invoiceId}", incoming="${incoming.invoiceId ?? null}"`
    );
  }
  if ((incoming.merchantReference ?? null) !== (existing.merchantReference ?? null)) {
    differences.push(
      `merchantReference: existing="${existing.merchantReference}", incoming="${incoming.merchantReference ?? null}"`
    );
  }

  return {
    isEquivalent: differences.length === 0,
    differences,
  };
}

/**
 * Evaluates whether a transaction has a genuine external parent reference
 * (e.g., an external capture ID or order ID distinct from the transaction's own ID).
 * Never accepts the refund's own transaction ID or normalizer fallback ID as a parent link.
 */
export function hasGenuineParentReference(
  tx: PaymentTransaction,
  raw: PayPalTransactionDetail
): boolean {
  const ownTxnId = tx.paypalTransactionId?.trim();
  const rawRefId = raw.transaction_info.paypal_reference_id?.trim();
  const orderId = tx.paypalOrderId?.trim();
  const captureId = tx.paypalCaptureId?.trim();

  // 1. Explicit PayPal reference ID distinct from the record's own transaction ID
  if (rawRefId && rawRefId.length > 0 && rawRefId !== ownTxnId) {
    return true;
  }

  // 2. PayPal Order ID distinct from the record's own transaction ID
  if (orderId && orderId.length > 0 && orderId !== ownTxnId) {
    return true;
  }

  // 3. Paypal Capture ID distinct from the record's own transaction ID (filtering normalizer self-fallback)
  if (captureId && captureId.length > 0 && captureId !== ownTxnId) {
    return true;
  }

  return false;
}

/**
 * Orchestrates atomic, idempotent persistence of an imported PayPal batch.
 *
 * Guarantees:
 * 1. Database-level transaction boundaries: All insertions, updates, rejections,
 *    and collision logs commit atomically or roll back completely on failure.
 * 2. Idempotency without row duplication: Re-importing known fingerprints updates
 *    last_observed_at and last_import_run_id, preserving original first_import_run_id and amounts.
 * 3. Intra-batch collision detection: If multiple identical reporting rows appear in
 *    the same batch, they are quarantined and logged to identity_collision_logs.
 * 4. Reconciliation eligibility boundary: Only valid, settled, non-colliding records
 *    are marked reconciliationEligible = true.
 * 5. Full audit trail of rejected items with original JSON payloads.
 */
export async function recordPayPalImportBatch(
  params: RecordPayPalImportBatchParams,
  customPool?: Pool
): Promise<BatchImportResult> {
  const { importRunId, pagesFetched = 1, items } = params;
  const pool = customPool || getPool();
  const client: PoolClient = await pool.connect();

  let recordsInserted = 0;
  let recordsAlreadyPresent = 0;
  let recordsRejected = 0;
  let identityCollisionsDetected = 0;
  let crossBatchDiscrepancies = 0;

  try {
    await client.query('BEGIN');

    // 1. Separate normalized items from rejected items
    const normalizedItems: Array<{ tx: PaymentTransaction; raw: PayPalTransactionDetail }> = [];
    const rejectedItems: Array<{
      reason: string;
      message: string;
      rawDetail: PayPalTransactionDetail;
    }> = [];

    for (const item of items) {
      if (item.normalized) {
        normalizedItems.push({ tx: item.normalized, raw: item.rawDetail });
      } else if (item.rejected) {
        rejectedItems.push(item.rejected);
      }
    }

    // 2. Intra-Batch Collision Detection
    // Count occurrences of each fingerprint in the current incoming batch
    const fingerprintCounts = new Map<string, number>();
    for (const item of normalizedItems) {
      const fp = item.tx.id;
      fingerprintCounts.set(fp, (fingerprintCounts.get(fp) || 0) + 1);
    }

    // Identify fingerprints that collided within this single batch
    const intraBatchCollidedFps = new Set<string>();
    for (const [fp, count] of fingerprintCounts.entries()) {
      if (count > 1) {
        intraBatchCollidedFps.add(fp);
      }
    }

    // 3. Query existing fingerprints in database
    const incomingFps = Array.from(fingerprintCounts.keys());
    const existingDbRecords = await findExistingFingerprints(incomingFps, client);

    // Track fingerprints processed in this loop to avoid inserting duplicate keys in the same transaction
    const processedInTransaction = new Set<string>();

    // 4. Process Normalized Transactions
    for (const item of normalizedItems) {
      const { tx, raw } = item;
      const fp = tx.id;
      const isCollidedWithinBatch = intraBatchCollidedFps.has(fp);

      if (isCollidedWithinBatch) {
        identityCollisionsDetected++;
        // Log collision audit record
        await insertCollisionLog(
          {
            importRunId,
            fingerprint: fp,
            paypalTransactionId: tx.paypalTransactionId,
            collisionType: 'WITHIN_BATCH_DUPLICATE',
            details: `Ambiguous identity collision: Fingerprint appeared ${fingerprintCounts.get(fp)} times in the same import batch.`,
            rawPayload: raw,
          },
          client
        );
      }

      const incomingFields = {
        paypalTransactionId: tx.paypalTransactionId,
        transactionEventCode: raw.transaction_info.transaction_event_code || 'UNKNOWN',
        transactionType: tx.transactionType,
        transactionStatus: tx.transactionStatus,
        grossAmountMinor: tx.grossAmount.amountMinor,
        currency: tx.currency,
        feeAmountMinor: tx.feeAmount?.amountMinor ?? null,
        netAmountMinor: tx.netAmount?.amountMinor ?? null,
        transactionTime: tx.transactionTime,
        paypalReferenceId: tx.paypalCaptureId ?? raw.transaction_info.paypal_reference_id ?? null,
        paypalReferenceType: raw.transaction_info.paypal_reference_id_type ?? null,
        paypalOrderId: tx.paypalOrderId ?? null,
        paypalCaptureId: tx.paypalCaptureId ?? null,
        invoiceId: tx.invoiceId ?? null,
        merchantReference: tx.merchantReference ?? null,
      };

      // Check if already in DB
      if (existingDbRecords.has(fp)) {
        const existing = existingDbRecords.get(fp)!;
        const comparison = compareCanonicalTransaction(incomingFields, existing);

        if (comparison.isEquivalent) {
          // Exact re-observation: Safe duplicate observation without row duplication or amount mutation
          recordsAlreadyPresent++;
          await updateObservationProvenance(fp, importRunId, client);
        } else {
          // Cross-batch payload discrepancy: Fingerprint matches but canonical source attributes differ!
          identityCollisionsDetected++;
          crossBatchDiscrepancies++;
          await insertCollisionLog(
            {
              importRunId,
              fingerprint: fp,
              paypalTransactionId: tx.paypalTransactionId,
              collisionType: 'CROSS_BATCH_DISCREPANCY',
              details: `Cross-batch payload discrepancy: ${comparison.differences.join('; ')}`,
              rawPayload: raw,
            },
            client
          );
        }
        continue;
      }

      // If this fingerprint was already inserted earlier in this same loop (due to intra-batch duplicate),
      // we do not attempt a duplicate insert into DB (which would violate UNIQUE constraint).
      if (processedInTransaction.has(fp)) {
        // Already inserted earlier in this batch
        continue;
      }

      processedInTransaction.add(fp);

      // Collision status & Reconciliation eligibility evaluation
      const collisionStatus: IdentityCollisionStatus = isCollidedWithinBatch
        ? 'QUARANTINED'
        : 'NONE';

      const hasParentReference = hasGenuineParentReference(tx, raw);

      const eligibility = determineReconciliationEligibility({
        transactionType: tx.transactionType,
        transactionStatus: tx.transactionStatus,
        grossAmountMinor: tx.grossAmount.amountMinor,
        collisionStatus,
        hasParentReference,
      });

      // Insert new record with safe concurrent conflict resolution
      const insertParams = {
        paypalTransactionId: tx.paypalTransactionId,
        fingerprint: fp,
        transactionEventCode: raw.transaction_info.transaction_event_code || 'UNKNOWN',
        transactionType: tx.transactionType,
        transactionStatus: tx.transactionStatus,
        grossAmountMinor: tx.grossAmount.amountMinor,
        currency: tx.currency,
        currencyPrecision: tx.grossAmount.precision,
        feeAmountMinor: tx.feeAmount?.amountMinor ?? null,
        netAmountMinor: tx.netAmount?.amountMinor ?? null,
        transactionTime: tx.transactionTime,
        paypalReferenceId: tx.paypalCaptureId ?? raw.transaction_info.paypal_reference_id ?? null,
        paypalReferenceType: raw.transaction_info.paypal_reference_id_type ?? null,
        paypalOrderId: tx.paypalOrderId ?? null,
        paypalCaptureId: tx.paypalCaptureId ?? null,
        invoiceId: tx.invoiceId ?? null,
        merchantReference: tx.merchantReference ?? null,
        sourceEnvironment: 'SANDBOX' as const,
        importRunId,
        reconciliationEligible: eligibility.isEligible,
        reconciliationEligibilityStatus: eligibility.status,
        identityCollisionStatus: collisionStatus,
        rawReference: tx.rawReference,
      };

      const inserted = await insertImportedTransaction(
        insertParams,
        client,
        { onConflict: 'DO_NOTHING' }
      );

      if (inserted) {
        recordsInserted++;
      } else {
        // Concurrent insert conflict: Another worker committed this fingerprint concurrently.
        // Compare against the now-committed record to guarantee exact canonical equivalence or quarantine.
        const existingConcurrent = await getTransactionByFingerprint(fp, client);
        if (existingConcurrent) {
          const comparison = compareCanonicalTransaction(incomingFields, existingConcurrent);
          if (comparison.isEquivalent) {
            recordsAlreadyPresent++;
            await updateObservationProvenance(fp, importRunId, client);
          } else {
            identityCollisionsDetected++;
            crossBatchDiscrepancies++;
            await insertCollisionLog(
              {
                importRunId,
                fingerprint: fp,
                paypalTransactionId: tx.paypalTransactionId,
                collisionType: 'CROSS_BATCH_DISCREPANCY',
                details: `Concurrent import payload discrepancy: ${comparison.differences.join('; ')}`,
                rawPayload: raw,
              },
              client
            );
          }
        }
      }
    }

    // 5. Process Rejected Records
    for (const rej of rejectedItems) {
      recordsRejected++;
      await insertRejectedRecord(
        {
          importRunId,
          paypalTransactionId: rej.rawDetail.transaction_info.transaction_id ?? null,
          transactionEventCode: rej.rawDetail.transaction_info.transaction_event_code ?? null,
          rejectionReason: rej.reason,
          rejectionMessage: rej.message,
          rawPayload: rej.rawDetail,
        },
        client
      );
    }

    // 6. Finalize Import Run inside the transaction
    let finalStatus: ImportStatus;
    if (params.isTruncated) {
      finalStatus = 'PARTIAL';
    } else if (identityCollisionsDetected > 0 || recordsRejected > 0) {
      finalStatus = 'COMPLETED_WITH_WARNINGS';
    } else {
      finalStatus = 'COMPLETED';
    }

    await finalizeImportRun(
      importRunId,
      {
        pagesFetched,
        recordsReceived: items.length,
        recordsInserted,
        recordsAlreadyPresent,
        recordsRejected,
        identityCollisionsDetected,
        importStatus: finalStatus,
      },
      client
    );

    await client.query('COMMIT');

    return {
      importRunId,
      recordsReceived: items.length,
      recordsInserted,
      recordsAlreadyPresent,
      recordsRejected,
      identityCollisionsDetected,
      crossBatchDiscrepancies,
      status: finalStatus,
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK');

    // Attempt to update run status to FAILED in a separate isolated query
    try {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await finalizeImportRun(importRunId, {
        pagesFetched,
        recordsReceived: items.length,
        recordsInserted: 0,
        recordsAlreadyPresent: 0,
        recordsRejected: 0,
        identityCollisionsDetected: 0,
        importStatus: 'FAILED',
        safeErrorCode: 'IMPORT_BATCH_FAILED',
        safeErrorMessage: errorMsg,
      });
    } catch {
      // Ignore secondary update error
    }

    throw err;
  } finally {
    client.release();
  }
}

