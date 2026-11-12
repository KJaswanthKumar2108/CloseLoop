/**
 * CloseLoop Phase 3D.4: Cryptographic Parameter Binding & Tamper-Evident Hash-Chain
 * Implements RFC 8785 JSON canonicalization and SHA-256 cryptographic binding.
 */

import crypto from 'crypto';
import { canonicalizeJson } from '@/lib/exceptions/evidenceGraph';
import {
  CanonicalApprovalBindingPayload,
  ApprovalAuditEventRecord,
  HashChainVerificationResult,
} from './types';

export const GENESIS_AUDIT_HASH = '0'.repeat(64);

/**
 * Computes the canonical SHA-256 binding hash for an approval request (Section 3).
 * Canonicalizes all binding fields via RFC 8785 before hashing.
 */
export function computeCanonicalApprovalBindingHash(
  payload: CanonicalApprovalBindingPayload
): string {
  const bindingData = {
    actionId: payload.actionId,
    actionParameters: payload.actionParameters,
    approvalRequestId: payload.approvalRequestId,
    caseId: payload.caseId,
    caseVersion: payload.caseVersion,
    createdAt: payload.createdAt,
    evidenceFingerprint: payload.evidenceFingerprint,
    expiresAt: payload.expiresAt,
    merchantId: payload.merchantId,
    recommendationId: payload.recommendationId,
  };

  const canonical = canonicalizeJson(bindingData);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Computes the SHA-256 hash for an audit event in the tamper-evident hash-chain (Section 4).
 * Combines previous event hash, event metadata, and canonical payload.
 */
export function computeAuditEventHash(
  previousEventHash: string,
  eventData: {
    approvalId: string;
    caseId: string;
    merchantId: string;
    actorId: string;
    eventType: string;
    canonicalPayload: Record<string, unknown>;
    createdAt: string;
  }
): string {
  const canonicalData = {
    actorId: eventData.actorId,
    approvalId: eventData.approvalId,
    canonicalPayload: eventData.canonicalPayload,
    caseId: eventData.caseId,
    createdAt: eventData.createdAt,
    eventType: eventData.eventType,
    merchantId: eventData.merchantId,
    previousEventHash,
  };

  const canonical = canonicalizeJson(canonicalData);
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Verifies the mathematical integrity of an audit event hash-chain (Section 4).
 * Iterates through ordered events, verifying link hashes and payload digests.
 * Fails closed upon detecting any broken link or payload alteration.
 */
export function verifyAuditHashChain(
  events: ApprovalAuditEventRecord[]
): HashChainVerificationResult {
  if (events.length === 0) {
    return {
      isValid: true,
      totalEvents: 0,
    };
  }

  for (let i = 0; i < events.length; i++) {
    const currentEvent = events[i];

    // 1. Verify previous hash pointer
    if (i === 0) {
      if (currentEvent.previousEventHash !== GENESIS_AUDIT_HASH) {
        return {
          isValid: false,
          totalEvents: events.length,
          invalidEventIndex: 0,
          invalidEventId: currentEvent.id,
          expectedHash: GENESIS_AUDIT_HASH,
          actualHash: currentEvent.previousEventHash,
          failureReason: `Genesis event has invalid previous_event_hash: '${currentEvent.previousEventHash}' (expected 64 zeros).`,
        };
      }
    } else {
      const priorEvent = events[i - 1];
      if (currentEvent.previousEventHash !== priorEvent.eventHash) {
        return {
          isValid: false,
          totalEvents: events.length,
          invalidEventIndex: i,
          invalidEventId: currentEvent.id,
          expectedHash: priorEvent.eventHash,
          actualHash: currentEvent.previousEventHash,
          failureReason: `Broken link in hash chain at event index ${i}: previous_event_hash does not match prior event's event_hash.`,
        };
      }
    }

    // 2. Recompute current event hash from persisted data
    const createdAtStr =
      typeof currentEvent.createdAt === 'string'
        ? currentEvent.createdAt
        : String(currentEvent.createdAt);

    const recomputedHash = computeAuditEventHash(currentEvent.previousEventHash, {
      approvalId: currentEvent.approvalId,
      caseId: currentEvent.caseId,
      merchantId: currentEvent.merchantId,
      actorId: currentEvent.actorId,
      eventType: currentEvent.eventType,
      canonicalPayload: currentEvent.canonicalPayload,
      createdAt: createdAtStr,
    });

    if (recomputedHash !== currentEvent.eventHash) {
      return {
        isValid: false,
        totalEvents: events.length,
        invalidEventIndex: i,
        invalidEventId: currentEvent.id,
        expectedHash: recomputedHash,
        actualHash: currentEvent.eventHash,
        failureReason: `Cryptographic digest mismatch at event index ${i}: payload or metadata has been tampered with.`,
      };
    }
  }

  return {
    isValid: true,
    totalEvents: events.length,
  };
}
