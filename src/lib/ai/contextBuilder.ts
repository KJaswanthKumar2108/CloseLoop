/**
 * CloseLoop Phase 3D.2: Deterministic Evidence Context Builder
 * Constructs bounded, sanitized, fingerprint-verified investigation contexts
 * strictly scoped to the authoritative merchant tenant.
 *
 * Hardened per F-33 (Runtime Database Role Separation: Defaults to Reader Pool),
 * F-34 (Sensitive-Data Exclusion Before Model Transmission),
 * and F-35 (Snapshot Consistency & Stale Investigations).
 */

import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { findCaseById } from '@/lib/exceptions/repository';
import { getReaderPool } from '@/lib/db/pool';
import { BoundedInvestigationContext, InvestigationEvidenceContextItem } from './types';
import { canonicalizeJson, sanitizeTextValue } from '@/lib/exceptions/evidenceGraph';

export const MAX_CONTEXT_EVIDENCE_ITEMS = 30;
export const MAX_CONTEXT_BYTE_SIZE = 100 * 1024; // 100KB bound

export class CaseContextNotFoundError extends Error {
  readonly code = 'CASE_NOT_FOUND';
  constructor(caseId: string, merchantId: string) {
    super(`Exception case ${caseId} was not found under merchant ${merchantId}.`);
    this.name = 'CaseContextNotFoundError';
    Object.setPrototypeOf(this, CaseContextNotFoundError.prototype);
  }
}

/**
 * Strict pre-transmission sanitization for text values (F-34).
 * Strips PANs (Luhn valid), IBANs, emails, SSNs, phone numbers, bearer tokens, JWTs, and API credentials.
 * Normalizes Unicode to NFC.
 */
export function sanitizeContextTextValue(text: string): string {
  if (typeof text !== 'string') return text;
  let val = sanitizeTextValue(text.normalize('NFC'));

  // Redact SSNs (###-##-#### or #########)
  val = val.replace(/\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/g, '[REDACTED_SSN]');

  // Redact US phone numbers
  val = val.replace(/(?:\+1[-. ]?|1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g, '[REDACTED_PHONE]');

  // Redact custom merchant secrets or generic keys
  val = val.replace(
    /(?:secret|key|token|auth)[\s:=]+['"]?[A-Za-z0-9_\-.~]{16,}['"]?/gi,
    '[REDACTED_CREDENTIAL]'
  );

  return val;
}

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|bearer|token|secret|api[-_]?key|password|cvv|cvc|cvv2|pin|passphrase|session|access[-_]?token|refresh[-_]?token|ssn|social[-_]?security|credit[-_]?card|private[-_]?key)/i;

/**
 * Recursively scrubs credentials, sensitive keys, and text values from evidence payloads before provider transmission.
 */
export function sanitizeContextPayload(
  obj: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): unknown {
  if (depth > 6) return '[MAX_DEPTH_EXCEEDED]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeContextTextValue(obj);
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }
  if (typeof obj === 'object') {
    if (seen.has(obj as object)) return '[CIRCULAR_REFERENCE]';
    seen.add(obj as object);

    if (Array.isArray(obj)) {
      return obj.slice(0, 50).map((item) => sanitizeContextPayload(item, depth + 1, seen));
    }

    const record = obj as Record<string, unknown>;
    const sanitizedObj: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(record)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        continue; // Exclude sensitive authorization / credential keys completely (F-34)
      }
      sanitizedObj[sanitizeContextTextValue(key)] = sanitizeContextPayload(val, depth + 1, seen);
    }

    return sanitizedObj;
  }

  return '[UNSUPPORTED_TYPE]';
}

/**
 * Robust date/string formatter avoiding illegal instanceof checks on strings (QG-1).
 */
export function formatCapturedAt(val: unknown): string {
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return String(val ?? '');
}

/**
 * Computes an immutable SHA-256 fingerprint over canonical evidence IDs, versions, and content hashes.
 */
export function computeEvidenceFingerprint(
  caseId: string,
  caseVersion: number,
  evidenceItems: Array<{ id: string; contentHash: string }>
): string {
  const sorted = [...evidenceItems].sort((a, b) => a.id.localeCompare(b.id));
  const payload = {
    caseId,
    caseVersion,
    evidence: sorted.map((e) => ({ id: e.id, hash: e.contentHash })),
  };
  const serialized = canonicalizeJson(payload);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Builds a bounded, sanitized context object from persisted exception case records.
 * Uses the restricted Reader Pool by default (F-33).
 * Never mutates any database records (Strictly Read-Only).
 * Enforces F-34 pre-transmission sanitization and F-35 snapshot metadata capture.
 */
export async function buildInvestigationContext(
  caseId: string,
  merchantId: string,
  poolOrClient?: Pool | PoolClient
): Promise<BoundedInvestigationContext> {
  const targetPool = poolOrClient || getReaderPool();
  const caseDetail = await findCaseById(targetPool, caseId, merchantId);

  if (!caseDetail) {
    throw new CaseContextNotFoundError(caseId, merchantId);
  }

  // 1. Build evidence items with bounded array length and pre-transmission scrubbing (F-34)
  const boundedItems = caseDetail.evidence.slice(0, MAX_CONTEXT_EVIDENCE_ITEMS);

  const evidenceContextItems: InvestigationEvidenceContextItem[] = boundedItems.map((e) => {
    let sanitizedPayload: Record<string, unknown>;
    try {
      sanitizedPayload = sanitizeContextPayload(e.payloadSnapshot) as Record<string, unknown>;
    } catch {
      sanitizedPayload = { '[ERROR]': 'PAYLOAD_SANITIZATION_FAILED_CLOSED' };
    }

    return {
      evidenceId: e.id,
      evidenceType: e.evidenceType,
      sourceSystem: e.sourceSystem,
      sourceRecordId: sanitizeContextTextValue(e.sourceRecordId).trim(),
      contentHash: e.contentHash,
      isObservedFact: e.isObservedFact,
      capturedAt: formatCapturedAt(e.capturedAt),
      sanitizedPayload,
    };
  });

  // 2. Compute deterministic evidence fingerprint
  const fingerprint = computeEvidenceFingerprint(
    caseDetail.id,
    caseDetail.version,
    boundedItems
  );

  const contextCreatedAt = new Date().toISOString();
  const evidenceIdentifiers = boundedItems.map((i) => i.id);

  const context: BoundedInvestigationContext = {
    caseId: caseDetail.id,
    merchantId: caseDetail.merchantId,
    caseVersion: caseDetail.version,
    caseKey: caseDetail.caseKey,
    discrepancyType: sanitizeContextTextValue(caseDetail.discrepancyType).trim(),
    primaryReference: sanitizeContextTextValue(caseDetail.primaryReference).trim(),
    merchantOrderId: caseDetail.merchantOrderId
      ? sanitizeContextTextValue(caseDetail.merchantOrderId).trim()
      : null,
    paypalTransactionId: caseDetail.paypalTransactionId
      ? sanitizeContextTextValue(caseDetail.paypalTransactionId).trim()
      : null,
    varianceAmountMinor: caseDetail.varianceAmount.amountMinor,
    expectedAmountMinor: caseDetail.expectedAmount.amountMinor,
    actualAmountMinor: caseDetail.actualAmount.amountMinor,
    currency: caseDetail.currency,
    currencyPrecision: caseDetail.varianceAmount.precision,
    evidenceFingerprint: fingerprint,
    evidenceItems: evidenceContextItems,
    evidenceIdentifiers,
    contextCreatedAt,
  };

  // 3. Enforce context byte size limits
  const serializedContext = JSON.stringify(context);
  if (Buffer.byteLength(serializedContext, 'utf8') > MAX_CONTEXT_BYTE_SIZE) {
    // Truncate non-essential evidence items while preserving the first 5 core items
    const reducedItems = evidenceContextItems.slice(0, 5);
    return {
      ...context,
      evidenceFingerprint: computeEvidenceFingerprint(
        caseDetail.id,
        caseDetail.version,
        reducedItems.map((i) => ({ id: i.evidenceId, contentHash: i.contentHash }))
      ),
      evidenceItems: reducedItems,
      evidenceIdentifiers: reducedItems.map((i) => i.evidenceId),
    };
  }

  return context;
}
