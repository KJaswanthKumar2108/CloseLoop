/**
 * CloseLoop Phase 3D.1: Evidence Graph & Sanitization Engine
 * Handles safe allowlisting, sensitive field redaction, canonical JSON serialization,
 * recursive bounds checking, and deterministic SHA-256 content hashing.
 * Hardened per F-29 (Redaction Hardening).
 */

import crypto from 'crypto';
import { MerchantOrder, PaymentTransaction, MatchingEvidence } from '@/types/financial';

export const MAX_RECURSION_DEPTH = 5;
export const MAX_STRING_LENGTH = 1000;
export const MAX_OBJECT_KEYS = 50;
export const MAX_ARRAY_LENGTH = 100;
export const MAX_PAYLOAD_BYTES = 64 * 1024; // 64KB

/**
 * Validates whether a numeric string satisfies the Luhn mod-10 formula.
 * Used for synthetic credit card identification without false positives.
 */
export function isLuhnValid(digitsStr: string): boolean {
  const digits = digitsStr.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;

  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Sanitizes and redacts sensitive patterns in string values:
 * PANs, IBANs, emails, bearer tokens, JWTs, and API credentials.
 * Redaction is performed BEFORE length truncation so sensitive values are never
 * partially exposed by clipping (F-29).
 */
export function sanitizeTextValue(text: string): string {
  if (typeof text !== 'string') return text;

  // 1. Redact PANs (Luhn valid 13-19 digits)
  let val = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
    const rawDigits = match.replace(/[\s-]/g, '');
    if (isLuhnValid(rawDigits)) {
      return `[REDACTED_CARD_${rawDigits.slice(-4)}]`;
    }
    return match;
  });

  // 2. Redact IBANs
  val = val.replace(/\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/gi, '[REDACTED_IBAN]');

  // 3. Mask Emails
  val = val.replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_match, user, domain) => {
    if (user.length <= 1) return `*@${domain}`;
    return `${user[0]}***@${domain}`;
  });

  // 4. Redact Bearer tokens & JWTs
  val = val.replace(/bearer\s+[A-Za-z0-9_\-\.]+/gi, '[REDACTED_BEARER_TOKEN]');
  val = val.replace(/ey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');

  // 5. Redact Sensitive API Key / Secret patterns
  val = val.replace(
    /(?:sk_live|pk_live|access_token|client_secret|api_key|secret_key)[\s:=]+[A-Za-z0-9_\-=]+/gi,
    '[REDACTED_CREDENTIAL]'
  );

  // 6. Bound string character length AFTER redaction has completed
  if (val.length > MAX_STRING_LENGTH) {
    let cutoff = MAX_STRING_LENGTH;
    // If cutoff falls inside a [REDACTED_...] tag, extend cutoff to include the full tag
    const lastOpen = val.lastIndexOf('[REDACTED_', cutoff);
    if (lastOpen !== -1) {
      const closingBracket = val.indexOf(']', lastOpen);
      if (closingBracket !== -1 && closingBracket >= cutoff) {
        cutoff = closingBracket + 1;
      }
    }
    val = `${val.substring(0, cutoff)}... [TRUNCATED_MAX_LENGTH]`;
  }

  // 7. Bound UTF-8 byte length safely
  const byteLen = Buffer.byteLength(val, 'utf8');
  if (byteLen > MAX_STRING_LENGTH * 4) {
    const buf = Buffer.from(val, 'utf8');
    val = `${buf.subarray(0, MAX_STRING_LENGTH).toString('utf8')}... [TRUNCATED_MAX_BYTES]`;
  }

  return val;
}

/**
 * Recursively sanitizes nested objects and arrays, enforcing depth limits,
 * cycle protection, and safe handling of unsupported types.
 */
export function recursivelySanitize(
  obj: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): unknown {
  if (depth > MAX_RECURSION_DEPTH) {
    return '[TRUNCATED_MAX_DEPTH]';
  }
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'string') {
    return sanitizeTextValue(obj);
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (typeof obj === 'function' || typeof obj === 'symbol') {
    return '[UNSUPPORTED_DATA_TYPE]';
  }
  if (typeof obj === 'object') {
    if (seen.has(obj)) {
      return '[CIRCULAR_REFERENCE]';
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      const safeArray = obj.slice(0, MAX_ARRAY_LENGTH);
      return safeArray.map((item) => recursivelySanitize(item, depth + 1, seen));
    }

    const record = obj as Record<string, unknown>;
    const sanitizedObj: Record<string, unknown> = {};
    const keys = Object.keys(record).slice(0, MAX_OBJECT_KEYS);
    for (const key of keys) {
      sanitizedObj[key] = recursivelySanitize(record[key], depth + 1, seen);
    }
    return sanitizedObj;
  }
  return '[UNSUPPORTED_DATA_TYPE]';
}

/**
 * Deterministically serializes an object into a canonical JSON string
 * with sorted keys recursively, ensuring reproducible SHA-256 fingerprints.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return 'null';
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return JSON.stringify(obj);
  }
  if (typeof obj === 'string') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const keyValuePairs = sortedKeys
      .filter((k) => record[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`);
    return `{${keyValuePairs.join(',')}}`;
  }
  return JSON.stringify(obj);
}

/**
 * Computes a standard 64-character hex SHA-256 digest of a canonicalized JSON string.
 */
export function computeContentHash(payload: Record<string, unknown>): string {
  const canonical = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Explicit approved metadata keys allowlist for Merchant Orders.
 */
export const APPROVED_METADATA_KEYS = new Set([
  'notes',
  'shipping_method',
  'delivery_window',
  'channel',
  'source_platform',
  'fulfillment_status',
  'tax_exempt',
  'carrier',
  'country_code',
]);

/**
 * Sanitizes generic metadata, filtering out tokens, secrets, or keys not on the approved allowlist.
 */
function sanitizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }
  try {
    const safe: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(metadata)) {
      if (!APPROVED_METADATA_KEYS.has(key.toLowerCase())) {
        continue; // Unapproved keys dropped
      }
      safe[key] = recursivelySanitize(val, 1);
    }
    return safe;
  } catch {
    // Fail closed
    return { '[ERROR]': 'METADATA_SANITIZATION_FAILED' };
  }
}

/**
 * Explicit allowlisting and sanitization for MerchantOrder records.
 * Strips credentials, auth tokens, minimizes PII, and bounds sizes.
 */
export function sanitizeMerchantOrderEvidence(order: MerchantOrder): Record<string, unknown> {
  try {
    const safeCustomerRef = order.customerReference
      ? sanitizeTextValue(order.customerReference)
      : undefined;

    const payload: Record<string, unknown> = {
      merchantOrderId: sanitizeTextValue(order.merchantOrderId),
      externalReference: sanitizeTextValue(order.externalReference),
      expectedAmount: {
        amountMinor: order.expectedAmount.amountMinor,
        currency: order.expectedAmount.currency,
        precision: order.expectedAmount.precision,
      },
      currency: order.currency,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      source: sanitizeTextValue(order.source),
      customerReference: safeCustomerRef,
      safeMetadata: sanitizeMetadata(order.metadata),
    };

    // Size limit verification in UTF-8 bytes (Fail closed if oversized)
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      return {
        merchantOrderId: sanitizeTextValue(order.merchantOrderId),
        expectedAmount: payload.expectedAmount,
        currency: order.currency,
        '[NOTICE]': 'PAYLOAD_OVERSIZED_NON_ESSENTIALS_TRUNCATED',
      };
    }

    return payload;
  } catch {
    // Fail closed on any unexpected processing exception
    return {
      merchantOrderId: order.merchantOrderId ? sanitizeTextValue(order.merchantOrderId) : 'UNKNOWN',
      '[ERROR]': 'SANITIZATION_FAILED_CLOSED',
    };
  }
}

/**
 * Explicit allowlisting and sanitization for PaymentTransaction.
 * Strips access tokens, authorization secrets, and internal fields.
 */
export function sanitizePaymentTransactionEvidence(txn: PaymentTransaction): Record<string, unknown> {
  try {
    const payload: Record<string, unknown> = {
      paypalTransactionId: sanitizeTextValue(txn.paypalTransactionId),
      paypalOrderId: txn.paypalOrderId ? sanitizeTextValue(txn.paypalOrderId) : null,
      paypalCaptureId: txn.paypalCaptureId ? sanitizeTextValue(txn.paypalCaptureId) : null,
      invoiceId: txn.invoiceId ? sanitizeTextValue(txn.invoiceId) : null,
      merchantReference: txn.merchantReference ? sanitizeTextValue(txn.merchantReference) : null,
      grossAmount: {
        amountMinor: txn.grossAmount.amountMinor,
        currency: txn.grossAmount.currency,
        precision: txn.grossAmount.precision,
      },
      feeAmount: txn.feeAmount
        ? {
          amountMinor: txn.feeAmount.amountMinor,
          currency: txn.feeAmount.currency,
          precision: txn.feeAmount.precision,
        }
        : null,
      netAmount: txn.netAmount
        ? {
          amountMinor: txn.netAmount.amountMinor,
          currency: txn.netAmount.currency,
          precision: txn.netAmount.precision,
        }
        : null,
      currency: txn.currency,
      transactionType: txn.transactionType,
      transactionStatus: txn.transactionStatus,
      transactionTime: txn.transactionTime,
      source: sanitizeTextValue(txn.source),
    };

    // Enforce UTF-8 byte limit on payment transaction evidence
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      return {
        paypalTransactionId: sanitizeTextValue(txn.paypalTransactionId),
        grossAmount: payload.grossAmount,
        currency: txn.currency,
        '[NOTICE]': 'PAYLOAD_OVERSIZED_NON_ESSENTIALS_TRUNCATED',
      };
    }

    return payload;
  } catch {
    return {
      paypalTransactionId: txn.paypalTransactionId ? sanitizeTextValue(txn.paypalTransactionId) : 'UNKNOWN',
      '[ERROR]': 'SANITIZATION_FAILED_CLOSED',
    };
  }
}

/**
 * Allowlisting and packaging for deterministic reconciliation match evidence.
 * Derived facts are explicitly labeled and captured.
 */
export function sanitizeReconciliationMatchEvidence(
  evidence: MatchingEvidence,
  reconciliationRecordId: string,
  matchStatus: string,
  discrepancyType: string
): Record<string, unknown> {
  try {
    const payload: Record<string, unknown> = {
      reconciliationRecordId: sanitizeTextValue(reconciliationRecordId),
      matchStatus,
      discrepancyType,
      orderId: evidence.orderId ? sanitizeTextValue(evidence.orderId) : null,
      transactionIds: [...evidence.transactionIds].map((id) => sanitizeTextValue(id)).sort(),
      matchingMethod: evidence.matchingMethod,
      matchingRule: evidence.matchingRule,
      amountComparison: {
        expectedAmountMinor: evidence.amountComparison.expectedAmountMinor,
        actualAmountMinor: evidence.amountComparison.actualAmountMinor,
        varianceMinor: evidence.amountComparison.varianceMinor,
        currency: evidence.amountComparison.currency,
        isExactMatch: evidence.amountComparison.isExactMatch,
      },
      currencyComparison: {
        orderCurrency: evidence.currencyComparison.orderCurrency,
        transactionCurrency: evidence.currencyComparison.transactionCurrency,
        matches: evidence.currencyComparison.matches,
      },
      timestampComparison: evidence.timestampComparison
        ? {
          differenceSeconds: evidence.timestampComparison.differenceSeconds,
          toleranceWindowSeconds: evidence.timestampComparison.toleranceWindowSeconds,
          withinTolerance: evidence.timestampComparison.withinTolerance,
        }
        : null,
      reasonsForAccepting: evidence.reasonsForAccepting.map((r) => sanitizeTextValue(r)),
      reasonsForRejectingCandidates: evidence.reasonsForRejectingCandidates.map((r) => sanitizeTextValue(r)),
    };

    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
      return {
        reconciliationRecordId: sanitizeTextValue(reconciliationRecordId),
        matchStatus,
        discrepancyType,
        '[NOTICE]': 'PAYLOAD_OVERSIZED_NON_ESSENTIALS_TRUNCATED',
      };
    }

    return payload;
  } catch {
    return {
      reconciliationRecordId: sanitizeTextValue(reconciliationRecordId),
      matchStatus,
      discrepancyType,
      '[ERROR]': 'SANITIZATION_FAILED_CLOSED',
    };
  }
}
