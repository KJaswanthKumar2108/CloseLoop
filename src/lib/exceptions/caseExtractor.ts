/**
 * CloseLoop Phase 3D.1: Deterministic Case Extractor
 * Pure, authoritative extraction of exception cases and evidence graphs
 * from deterministic reconciliation runs.
 */

import {
  ReconciliationRecord,
  ReconciliationRun,
  MerchantOrder,
  PaymentTransaction,
} from '@/types/financial';
import {
  ExtractedCaseWithEvidence,
  CaseExtractionSummary,
} from './types';
import {
  computeContentHash,
  canonicalizeJson,
  sanitizeMerchantOrderEvidence,
  sanitizePaymentTransactionEvidence,
  sanitizeReconciliationMatchEvidence,
} from './evidenceGraph';

export interface ExtractionParams {
  run: ReconciliationRun;
  orders?: MerchantOrder[];
  transactions?: PaymentTransaction[];
  merchantId?: string;
  /**
   * Optional map of paypalTransactionId -> database UUID in paypal_imported_transactions
   */
  transactionDbIdMap?: Map<string, string>;
}

/**
 * Canonical structured case identity payload for versioned hashing (F-28).
 */
export interface CaseIdentityStructure {
  v: 1;
  discrepancyType: string;
  orderId: string | null;
  transactionIds: string[];
}

/**
 * Builds the canonical structured versioned SHA-256 case key (F-28).
 * Immune to delimiter collisions, whitespace, reordering, duplicate references, Unicode, and long references.
 */
export function buildDeterministicCaseKey(
  discrepancyType: string,
  orderId?: string | null,
  transactionIds: string[] = []
): string {
  const normDiscrepancy = discrepancyType.normalize('NFC').trim().toUpperCase();
  const normOrderId = orderId && orderId.trim() !== '' ? orderId.normalize('NFC').trim() : null;

  // Deduplicate, trim, normalize NFC, and sort transaction IDs while preserving case sensitivity
  const normTxnIds = Array.from(
    new Set(
      transactionIds
        .map((id) => id.normalize('NFC').trim())
        .filter((id) => id.length > 0)
    )
  ).sort();

  const identity: CaseIdentityStructure = {
    v: 1,
    discrepancyType: normDiscrepancy,
    orderId: normOrderId,
    transactionIds: normTxnIds,
  };

  const canonicalJson = canonicalizeJson(identity);
  const hash = computeContentHash(JSON.parse(canonicalJson));
  return `v1_${hash}`;
}

/**
 * Builds the legacy delimiter-concatenated case key for backward compatibility migration.
 */
export function buildLegacyCaseKey(
  discrepancyType: string,
  orderId?: string | null,
  transactionIds: string[] = []
): string {
  const normOrderId = orderId ? orderId.trim() : 'NO_ORDER';
  const normTxnIds =
    transactionIds.length > 0
      ? [...transactionIds].map((id) => id.trim()).sort().join(',')
      : 'NO_TXN';
  return `${discrepancyType}:${normOrderId}:${normTxnIds}`;
}

/**
 * Extracts actionable exception cases and compiles evidence graphs from a completed reconciliation run.
 */
export function extractCasesFromReconciliationRun(
  params: ExtractionParams
): CaseExtractionSummary {
  if (!params.merchantId || params.merchantId.trim() === '') {
    throw new Error(
      'Explicit merchantId is required for exception case extraction. Silent fallback to default is forbidden.'
    );
  }
  const merchantId = params.merchantId.trim();
  const run = params.run;
  const ordersMap = new Map<string, MerchantOrder>();
  if (params.orders) {
    for (const order of params.orders) {
      ordersMap.set(order.merchantOrderId, order);
    }
  }

  const transactionsMap = new Map<string, PaymentTransaction>();
  if (params.transactions) {
    for (const txn of params.transactions) {
      transactionsMap.set(txn.paypalTransactionId, txn);
    }
  }

  const extractedCases: ExtractedCaseWithEvidence[] = [];
  let cleanMatchesSkipped = 0;
  let ineligibleQuarantinedSkipped = 0;

  for (const record of run.records) {
    // Invariant: Clean matches with no discrepancy do not create exception cases
    if (record.matchStatus === 'MATCHED' && record.discrepancyType === 'NONE') {
      cleanMatchesSkipped++;
      continue;
    }

    // Determine primary and secondary references
    const orderId = record.orderId;
    const transactionIds = record.transactionIds || [];
    const primaryRef = orderId || (transactionIds.length > 0 ? transactionIds[0] : record.id);

    // Invariant: Verify that unmatched transactions are not quarantined or ineligible
    if (record.matchStatus === 'UNMATCHED_TRANSACTION') {
      const primaryTxnId = transactionIds[0];
      const txn = primaryTxnId ? transactionsMap.get(primaryTxnId) : undefined;

      if (txn) {
        // Authorization transactions are non-settled and must never be treated as settled captures
        if (txn.transactionType === 'AUTHORIZATION') {
          ineligibleQuarantinedSkipped++;
          continue;
        }

        // Pending or failed refund states are not eligible completed refunds
        if (
          txn.transactionType === 'REFUND' &&
          (txn.transactionStatus === 'PENDING' ||
            txn.transactionStatus === 'DENIED' ||
            txn.transactionStatus === 'FAILED' ||
            txn.transactionStatus === 'REVERSED')
        ) {
          ineligibleQuarantinedSkipped++;
          continue;
        }
      }
    }

    // Determine normalized discrepancy classification
    let effectiveDiscrepancy: string = record.discrepancyType;
    if (record.discrepancyType === 'NONE') {
      if (record.matchStatus === 'UNMATCHED_ORDER') {
        effectiveDiscrepancy = 'MISSING_PAYMENT';
      } else if (record.matchStatus === 'UNMATCHED_TRANSACTION') {
        effectiveDiscrepancy = 'MISSING_ORDER_IN_MERCHANT';
      } else if (record.matchStatus === 'AMBIGUOUS') {
        effectiveDiscrepancy = 'AMBIGUOUS';
      }
    }

    // Deterministic case key (versioned SHA-256 hash) and legacy fallback key
    const caseKey = buildDeterministicCaseKey(effectiveDiscrepancy, orderId, transactionIds);
    const legacyCaseKey = buildLegacyCaseKey(effectiveDiscrepancy, orderId, transactionIds);

    // Build Case Record (minor integer units)
    const varianceMinor = record.varianceAmount ? record.varianceAmount.amountMinor : 0;
    const expectedMinor = record.expectedAmount ? record.expectedAmount.amountMinor : 0;
    const actualMinor = record.actualAmount ? record.actualAmount.amountMinor : 0;
    const currency = record.currency || (record.expectedAmount ? record.expectedAmount.currency : 'USD');
    const currencyPrecision = record.varianceAmount ? record.varianceAmount.precision : 2;

    const notes = generateCaseNotes(record, effectiveDiscrepancy);

    const caseRecord: ExtractedCaseWithEvidence['caseRecord'] = {
      merchantId,
      caseKey,
      legacyCaseKey,
      reconciliationRunId: run.id,
      discrepancyType: effectiveDiscrepancy,
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: varianceMinor,
      expectedAmountMinor: expectedMinor,
      actualAmountMinor: actualMinor,
      currency,
      currencyPrecision,
      primaryReference: primaryRef,
      merchantOrderId: orderId || null,
      paypalTransactionId: transactionIds.length > 0 ? transactionIds[0] : null,
      notes,
    };

    // Compile Evidence Graph
    const evidenceItems: ExtractedCaseWithEvidence['evidenceItems'] = [];

    // 1. Merchant Order Evidence (Observed Fact)
    if (orderId && ordersMap.has(orderId)) {
      const order = ordersMap.get(orderId)!;
      const sanitizedOrderPayload = sanitizeMerchantOrderEvidence(order);
      evidenceItems.push({
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: order.merchantOrderId,
        sourceTransactionId: null,
        reconciliationRunId: run.id,
        payloadSnapshot: sanitizedOrderPayload,
        contentHash: computeContentHash(sanitizedOrderPayload),
        isObservedFact: true,
      });
    }

    // 2. PayPal Transaction Evidence (Observed Fact for each linked transaction)
    for (const txnId of transactionIds) {
      if (transactionsMap.has(txnId)) {
        const txn = transactionsMap.get(txnId)!;
        const sanitizedTxnPayload = sanitizePaymentTransactionEvidence(txn);
        const sourceTxnDbId = params.transactionDbIdMap?.get(txn.paypalTransactionId) || null;

        evidenceItems.push({
          merchantId,
          evidenceType: 'PAYPAL_TRANSACTION',
          sourceSystem: 'PAYPAL_DURABLE_LEDGER',
          sourceTable: 'paypal_imported_transactions',
          sourceRecordId: txn.paypalTransactionId,
          sourceTransactionId: sourceTxnDbId,
          reconciliationRunId: run.id,
          payloadSnapshot: sanitizedTxnPayload,
          contentHash: computeContentHash(sanitizedTxnPayload),
          isObservedFact: true,
        });
      }
    }

    // 3. Deterministic Reconciliation Match Evidence (Derived Fact)
    if (record.evidence) {
      const sanitizedMatchPayload = sanitizeReconciliationMatchEvidence(
        record.evidence,
        record.id,
        record.matchStatus,
        effectiveDiscrepancy
      );
      evidenceItems.push({
        merchantId,
        evidenceType: 'RECONCILIATION_MATCH',
        sourceSystem: 'RECONCILIATION_ENGINE',
        sourceTable: 'reconciliation_records',
        sourceRecordId: record.id,
        sourceTransactionId: null,
        reconciliationRunId: run.id,
        payloadSnapshot: sanitizedMatchPayload,
        contentHash: computeContentHash(sanitizedMatchPayload),
        isObservedFact: false, // Derived fact
      });
    }

    extractedCases.push({
      caseRecord,
      evidenceItems,
    });
  }

  return {
    reconciliationRunId: run.id,
    totalRecordsProcessed: run.records.length,
    eligibleCasesExtracted: extractedCases.length,
    cleanMatchesSkipped,
    ineligibleQuarantinedSkipped,
    cases: extractedCases,
  };
}

/**
 * Generates an informative, deterministic summary note for an exception case.
 */
function generateCaseNotes(record: ReconciliationRecord, discrepancy: string): string {
  switch (discrepancy) {
    case 'FEE_VARIANCE':
      return `Fee variance detected: expected ${record.expectedAmount.amountMinor} minor units vs actual ${record.actualAmount.amountMinor} minor units (variance ${record.varianceAmount.amountMinor}).`;
    case 'AMOUNT_MISMATCH':
      return `Amount mismatch detected: expected ${record.expectedAmount.amountMinor} vs actual ${record.actualAmount.amountMinor}.`;
    case 'TIMING_DELAY':
      return `Timing settlement lag: transaction timestamp exceeds standard tolerance window.`;
    case 'PARTIAL_REFUND_MISMATCH':
      return `Partial refund linked to capture: settlement amount adjusted for partial reversal.`;
    case 'FULL_REFUND_SETTLEMENT':
      return `Full refund linked to capture: net transaction settled as fully refunded.`;
    case 'MISSING_PAYMENT':
    case 'UNMATCHED_ORDER':
      return `Merchant order ${record.orderId} has no corresponding settled PayPal capture.`;
    case 'MISSING_ORDER_IN_MERCHANT':
    case 'UNMATCHED_TRANSACTION':
      return `PayPal transaction ${record.transactionIds.join(', ')} has no corresponding merchant order.`;
    case 'AMBIGUOUS':
      return `Ambiguous match: multiple candidate orders or transactions compete for identification.`;
    case 'DISPUTE_HOLD':
      return `Transaction held or flagged due to active buyer dispute.`;
    case 'EXCHANGE_RATE_SLIPPAGE':
      return `Exchange rate variance between order authorization currency and settlement currency.`;
    default:
      return `Discrepancy ${discrepancy} identified by rule ${record.matchingMethod}.`;
  }
}

