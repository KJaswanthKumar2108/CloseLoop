import { describe, it, expect } from 'vitest';
import {
  computeCanonicalApprovalBindingHash,
  computeAuditEventHash,
  verifyAuditHashChain,
  GENESIS_AUDIT_HASH,
} from '../cryptoBinding';
import { CanonicalApprovalBindingPayload, ApprovalAuditEventRecord } from '../types';

describe('Phase 3D.4: Cryptographic Binding & Hash-Chain Suite', () => {
  const sampleBindingPayload: CanonicalApprovalBindingPayload = {
    approvalRequestId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    merchantId: 'merchant_crypto_test',
    caseId: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
    recommendationId: 'rec-12345678',
    actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
    actionParameters: {
      varianceMinor: 1500,
      currency: 'USD',
      suggestedAction: 'CHECK_FEE_SCHEDULE',
    },
    caseVersion: 1,
    evidenceFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    createdAt: '2026-11-12T12:00:00.000Z',
    expiresAt: '2026-11-14T12:00:00.000Z',
  };

  it('generates a deterministic 64-character hex SHA-256 canonical binding hash', () => {
    const hash1 = computeCanonicalApprovalBindingHash(sampleBindingPayload);
    const hash2 = computeCanonicalApprovalBindingHash(sampleBindingPayload);

    expect(hash1).toHaveLength(64);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
    expect(hash1).toBe(hash2);
  });

  it('demonstrates RFC 8785 JSON canonicalization determinism across unordered keys', () => {
    const permutedPayload: CanonicalApprovalBindingPayload = {
      expiresAt: '2026-11-14T12:00:00.000Z',
      createdAt: '2026-11-12T12:00:00.000Z',
      evidenceFingerprint: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      caseVersion: 1,
      actionParameters: {
        suggestedAction: 'CHECK_FEE_SCHEDULE',
        currency: 'USD',
        varianceMinor: 1500,
      },
      actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
      recommendationId: 'rec-12345678',
      caseId: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
      merchantId: 'merchant_crypto_test',
      approvalRequestId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    };

    const hashOriginal = computeCanonicalApprovalBindingHash(sampleBindingPayload);
    const hashPermuted = computeCanonicalApprovalBindingHash(permutedPayload);

    expect(hashOriginal).toBe(hashPermuted);
  });

  it('detects tampering: altering any parameter changes the binding hash', () => {
    const originalHash = computeCanonicalApprovalBindingHash(sampleBindingPayload);

    // Tamper with action parameter
    const tamperedParams = {
      ...sampleBindingPayload,
      actionParameters: {
        ...sampleBindingPayload.actionParameters,
        varianceMinor: 999999, // tampered amount!
      },
    };
    expect(computeCanonicalApprovalBindingHash(tamperedParams)).not.toBe(originalHash);

    // Tamper with version
    const tamperedVersion = {
      ...sampleBindingPayload,
      caseVersion: 2,
    };
    expect(computeCanonicalApprovalBindingHash(tamperedVersion)).not.toBe(originalHash);

    // Tamper with evidence fingerprint
    const tamperedFingerprint = {
      ...sampleBindingPayload,
      evidenceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
    };
    expect(computeCanonicalApprovalBindingHash(tamperedFingerprint)).not.toBe(originalHash);
  });

  it('generates sequential audit event hashes chained from genesis', () => {
    const event1Time = '2026-11-12T12:00:00.000Z';
    const event1Hash = computeAuditEventHash(GENESIS_AUDIT_HASH, {
      approvalId: sampleBindingPayload.approvalRequestId,
      caseId: sampleBindingPayload.caseId,
      merchantId: sampleBindingPayload.merchantId,
      actorId: 'operator_1@closeloop.local',
      eventType: 'APPROVAL_REQUESTED',
      canonicalPayload: { reason: 'Initial submission' },
      createdAt: event1Time,
    });

    expect(event1Hash).toHaveLength(64);
    expect(event1Hash).toMatch(/^[0-9a-f]{64}$/);

    const event2Time = '2026-11-12T12:05:00.000Z';
    const event2Hash = computeAuditEventHash(event1Hash, {
      approvalId: sampleBindingPayload.approvalRequestId,
      caseId: sampleBindingPayload.caseId,
      merchantId: sampleBindingPayload.merchantId,
      actorId: 'operator_2@closeloop.local',
      eventType: 'APPROVAL_GRANTED',
      canonicalPayload: { reason: 'Reviewed and approved' },
      createdAt: event2Time,
    });

    expect(event2Hash).toHaveLength(64);
    expect(event2Hash).not.toBe(event1Hash);

    // Verify chain integrity
    const chain: ApprovalAuditEventRecord[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        merchantId: sampleBindingPayload.merchantId,
        caseId: sampleBindingPayload.caseId,
        approvalId: sampleBindingPayload.approvalRequestId,
        actorId: 'operator_1@closeloop.local',
        eventType: 'APPROVAL_REQUESTED',
        canonicalPayload: { reason: 'Initial submission' },
        previousEventHash: GENESIS_AUDIT_HASH,
        eventHash: event1Hash,
        createdAt: event1Time,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        merchantId: sampleBindingPayload.merchantId,
        caseId: sampleBindingPayload.caseId,
        approvalId: sampleBindingPayload.approvalRequestId,
        actorId: 'operator_2@closeloop.local',
        eventType: 'APPROVAL_GRANTED',
        canonicalPayload: { reason: 'Reviewed and approved' },
        previousEventHash: event1Hash,
        eventHash: event2Hash,
        createdAt: event2Time,
      },
    ];

    const verification = verifyAuditHashChain(chain);
    expect(verification.isValid).toBe(true);
    expect(verification.totalEvents).toBe(2);
  });

  it('detects tampering in audit chain: broken link between events', () => {
    const event1Time = '2026-11-12T12:00:00.000Z';
    const event1Hash = computeAuditEventHash(GENESIS_AUDIT_HASH, {
      approvalId: sampleBindingPayload.approvalRequestId,
      caseId: sampleBindingPayload.caseId,
      merchantId: sampleBindingPayload.merchantId,
      actorId: 'operator_1@closeloop.local',
      eventType: 'APPROVAL_REQUESTED',
      canonicalPayload: { reason: 'Initial submission' },
      createdAt: event1Time,
    });

    const event2Time = '2026-11-12T12:05:00.000Z';
    const event2Hash = computeAuditEventHash(event1Hash, {
      approvalId: sampleBindingPayload.approvalRequestId,
      caseId: sampleBindingPayload.caseId,
      merchantId: sampleBindingPayload.merchantId,
      actorId: 'operator_2@closeloop.local',
      eventType: 'APPROVAL_GRANTED',
      canonicalPayload: { reason: 'Reviewed and approved' },
      createdAt: event2Time,
    });

    // Forge previousEventHash in event 2
    const forgedChain: ApprovalAuditEventRecord[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        merchantId: sampleBindingPayload.merchantId,
        caseId: sampleBindingPayload.caseId,
        approvalId: sampleBindingPayload.approvalRequestId,
        actorId: 'operator_1@closeloop.local',
        eventType: 'APPROVAL_REQUESTED',
        canonicalPayload: { reason: 'Initial submission' },
        previousEventHash: GENESIS_AUDIT_HASH,
        eventHash: event1Hash,
        createdAt: event1Time,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        merchantId: sampleBindingPayload.merchantId,
        caseId: sampleBindingPayload.caseId,
        approvalId: sampleBindingPayload.approvalRequestId,
        actorId: 'operator_2@closeloop.local',
        eventType: 'APPROVAL_GRANTED',
        canonicalPayload: { reason: 'Reviewed and approved' },
        previousEventHash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', // broken link!
        eventHash: event2Hash,
        createdAt: event2Time,
      },
    ];

    const verification = verifyAuditHashChain(forgedChain);
    expect(verification.isValid).toBe(false);
    expect(verification.invalidEventIndex).toBe(1);
    expect(verification.failureReason).toContain('Broken link in hash chain');
  });

  it('detects tampering in audit chain: altered payload content', () => {
    const event1Time = '2026-11-12T12:00:00.000Z';
    const event1Hash = computeAuditEventHash(GENESIS_AUDIT_HASH, {
      approvalId: sampleBindingPayload.approvalRequestId,
      caseId: sampleBindingPayload.caseId,
      merchantId: sampleBindingPayload.merchantId,
      actorId: 'operator_1@closeloop.local',
      eventType: 'APPROVAL_REQUESTED',
      canonicalPayload: { reason: 'Legitimate reason' },
      createdAt: event1Time,
    });

    // Alter canonicalPayload while keeping old eventHash
    const tamperedChain: ApprovalAuditEventRecord[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        merchantId: sampleBindingPayload.merchantId,
        caseId: sampleBindingPayload.caseId,
        approvalId: sampleBindingPayload.approvalRequestId,
        actorId: 'operator_1@closeloop.local',
        eventType: 'APPROVAL_REQUESTED',
        canonicalPayload: { reason: 'TAMPERED REASON' }, // altered!
        previousEventHash: GENESIS_AUDIT_HASH,
        eventHash: event1Hash,
        createdAt: event1Time,
      },
    ];

    const verification = verifyAuditHashChain(tamperedChain);
    expect(verification.isValid).toBe(false);
    expect(verification.invalidEventIndex).toBe(0);
    expect(verification.failureReason).toContain('mismatch at event index 0');
  });
});
