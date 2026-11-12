import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { getPool } from '@/lib/db/pool';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import {
  createApprovalRequest,
  decideApproval,
  getApprovalAuditTrail,
} from '../approvalRepository';

describe('Phase 3D.4: Approval Repository & Tamper-Evident Audit Suite', () => {
  let pool: Pool;
  const verifiedMerchantId = 'merchant_approval_repo_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    delete process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL;
    await setupTestDatabase();
    pool = getPool();
  });

  afterEach(async () => {
    delete process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL;
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string, merchantId = verifiedMerchantId): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_test_approval_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_approval_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 2000,
      expectedAmountMinor: 10000,
      actualAmountMinor: 8000,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-${suffix}`,
      merchantOrderId: `ORD-${suffix}`,
      paypalTransactionId: `TXN-${suffix}`,
      notes: 'Approval repository test case',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_approval_${suffix}`,
        payloadSnapshot: { orderId: `ORD-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  it('creates an approval request with canonical parameter binding and genesis audit event', async () => {
    const testCase = createTestCase('create_success');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_action_1',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { varianceMinor: 2000, currency: 'USD' },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_req@closeloop.local',
        expiresInHours: 24,
      },
      pool
    );

    expect(approval.id).toBeDefined();
    expect(approval.status).toBe('PENDING_APPROVAL');
    expect(approval.canonicalBindingHash).toHaveLength(64);
    expect(approval.caseVersion).toBe(1);

    // Verify genesis audit event was created
    const auditRes = await pool.query(
      `SELECT * FROM approval_audit_events WHERE approval_id = $1;`,
      [approval.id]
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0].event_type).toBe('APPROVAL_REQUESTED');
    expect(auditRes.rows[0].previous_event_hash).toBe(
      '0000000000000000000000000000000000000000000000000000000000000000'
    );
  });

  it('fails with 404 when parent exception case does not exist', async () => {
    const nonExistentCaseId = '99999999-9999-9999-9999-999999999999';

    await expect(
      createApprovalRequest(
        {
          merchantId: verifiedMerchantId,
          caseId: nonExistentCaseId,
          recommendationId: 'rec_not_found',
          actionId: 'REVIEW_CASE_EVIDENCE',
          caseVersion: 1,
          evidenceFingerprint: '0'.repeat(64),
          requestedBy: 'operator@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/not found/i);
  });

  it('rejects approval request when case version drifts', async () => {
    const testCase = createTestCase('version_drift');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    // Bump case version in DB to 2
    await pool.query(`UPDATE exception_cases SET version = 2 WHERE id = $1;`, [caseId]);

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 2, evidenceRes.rows);

    // Try to create approval request claiming version 1
    await expect(
      createApprovalRequest(
        {
          merchantId: verifiedMerchantId,
          caseId,
          recommendationId: 'rec_stale_ver',
          actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
          caseVersion: 1, // Stale!
          evidenceFingerprint: fingerprint,
          requestedBy: 'operator@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/drifted from v1 to v2/i);
  });

  it('rejects approval request when evidence fingerprint drifts', async () => {
    const testCase = createTestCase('fingerprint_drift');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const staleFingerprint = 'f'.repeat(64);

    await expect(
      createApprovalRequest(
        {
          merchantId: verifiedMerchantId,
          caseId,
          recommendationId: 'rec_stale_fp',
          actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
          caseVersion: 1,
          evidenceFingerprint: staleFingerprint, // Mismatch!
          requestedBy: 'operator@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/Live evidence items differ from the snapshot fingerprint/i);
  });

  it('prevents duplicate pending approval requests for the same recommendation', async () => {
    const testCase = createTestCase('duplicate_req');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_dup',
        actionId: 'WAIT_FOR_SETTLEMENT',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator@closeloop.local',
      },
      pool
    );

    // Second request with same recommendation ID
    await expect(
      createApprovalRequest(
        {
          merchantId: verifiedMerchantId,
          caseId,
          recommendationId: 'rec_dup',
          actionId: 'WAIT_FOR_SETTLEMENT',
          caseVersion: 1,
          evidenceFingerprint: fingerprint,
          requestedBy: 'operator2@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/pending approval request already exists/i);
  });

  it('atomically grants approval and appends to tamper-evident audit chain', async () => {
    const testCase = createTestCase('approve_success');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_approve',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { note: 'Sample action' },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_alice@closeloop.local',
      },
      pool
    );

    // Decide APPROVE
    const decided = await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'APPROVE',
        decidedBy: 'operator_bob@closeloop.local',
        decisionReason: 'Verified with OMS record.',
      },
      pool
    );

    expect(decided.status).toBe('APPROVED');
    expect(decided.decidedBy).toBe('operator_bob@closeloop.local');
    expect(decided.decisionReason).toBe('Verified with OMS record.');

    // Audit trail verification
    const auditData = await getApprovalAuditTrail(approval.id, verifiedMerchantId, pool);
    expect(auditData.events).toHaveLength(2);
    expect(auditData.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(auditData.events[1].eventType).toBe('APPROVAL_GRANTED');
    expect(auditData.chainVerification.isValid).toBe(true);
    expect(auditData.chainVerification.totalEvents).toBe(2);
  });

  it('atomically rejects approval request and appends to audit chain', async () => {
    const testCase = createTestCase('reject_success');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_reject',
        actionId: 'REQUEST_MERCHANT_DOCUMENTATION',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_alice@closeloop.local',
      },
      pool
    );

    // Decide REJECT
    const decided = await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'REJECT',
        decidedBy: 'operator_bob@closeloop.local',
        decisionReason: 'Documentation already on file.',
      },
      pool
    );

    expect(decided.status).toBe('REJECTED');
    expect(decided.decisionReason).toBe('Documentation already on file.');

    const auditData = await getApprovalAuditTrail(approval.id, verifiedMerchantId, pool);
    expect(auditData.events).toHaveLength(2);
    expect(auditData.events[1].eventType).toBe('APPROVAL_REJECTED');
    expect(auditData.chainVerification.isValid).toBe(true);
  });

  it('forbids transition from terminal states (cannot re-decide)', async () => {
    const testCase = createTestCase('terminal_state');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_terminal',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_alice@closeloop.local',
      },
      pool
    );

    // First decision: APPROVE
    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'APPROVE',
        decidedBy: 'operator_bob@closeloop.local',
        decisionReason: 'Initial approval.',
      },
      pool
    );

    // Second decision attempt: REJECT
    await expect(
      decideApproval(
        {
          approvalId: approval.id,
          merchantId: verifiedMerchantId,
          decision: 'REJECT',
          decidedBy: 'operator_carol@closeloop.local',
          decisionReason: 'Attempt to override terminal state.',
        },
        pool
      )
    ).rejects.toThrowError(/already in terminal state 'APPROVED'/i);
  });

  it('enforces dual control policy when enabled (rejects self-approval)', async () => {
    process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL = 'true';

    const testCase = createTestCase('dual_control');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_dual',
        actionId: 'VERIFY_PAYMENT_REFERENCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_same@closeloop.local',
      },
      pool
    );

    // Attempt self-approval
    await expect(
      decideApproval(
        {
          approvalId: approval.id,
          merchantId: verifiedMerchantId,
          decision: 'APPROVE',
          decidedBy: 'operator_same@closeloop.local', // Same operator!
          decisionReason: 'Self approval attempt.',
        },
        pool
      )
    ).rejects.toThrowError(/Dual control policy violation/i);
  });

  it('tracks audit events sequentially for each state transition', async () => {
    const testCase = createTestCase('audit_tracking');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_track',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator@closeloop.local',
      },
      pool
    );

    // Initial audit event: APPROVAL_REQUESTED
    const initialAudit = await getApprovalAuditTrail(approval.id, verifiedMerchantId, pool);
    expect(initialAudit.events).toHaveLength(1);
    expect(initialAudit.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(initialAudit.chainVerification.isValid).toBe(true);

    // After approval: APPROVAL_GRANTED
    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'APPROVE',
        decidedBy: 'decider@closeloop.local',
        decisionReason: 'Approved following OMS match.',
      },
      pool
    );

    const postDecisionAudit = await getApprovalAuditTrail(approval.id, verifiedMerchantId, pool);
    expect(postDecisionAudit.events).toHaveLength(2);
    expect(postDecisionAudit.events[1].eventType).toBe('APPROVAL_GRANTED');
    expect(postDecisionAudit.chainVerification.isValid).toBe(true);
  });
});
