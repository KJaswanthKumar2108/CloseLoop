import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { getPool } from '@/lib/db/pool';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import { createApprovalRequest, decideApproval } from '@/lib/approvals/approvalRepository';
import { getApprovalAuditTrail } from '@/lib/approvals/approvalRepository';
import {
  checkExecutionEligibility,
  executeControlledAction,
} from '../executionEngine';
import { MANDATORY_SIMULATION_DISCLAIMER } from '../types';

describe('Phase 3D.5: Controlled Execution Engine Unit Suite', () => {
  let pool: Pool;
  const verifiedMerchantId = 'merchant_exec_engine_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    await setupTestDatabase();
    pool = getPool();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string, merchantId = verifiedMerchantId): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_test_exec_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_exec_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 1500,
      expectedAmountMinor: 10000,
      actualAmountMinor: 8500,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-EXEC-${suffix}`,
      merchantOrderId: `ORD-EXEC-${suffix}`,
      paypalTransactionId: `TXN-EXEC-${suffix}`,
      notes: 'Execution engine test case',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-EXEC-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_exec_${suffix}`,
        payloadSnapshot: { orderId: `ORD-EXEC-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-exec-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  async function createApprovedAction(suffix: string) {
    const testCase = createTestCase(suffix);
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
        recommendationId: `rec_exec_${suffix}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { varianceMinor: 1500, currency: 'USD' },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_1@closeloop.local',
      },
      pool
    );

    const approved = await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'APPROVE',
        decidedBy: 'supervisor@closeloop.local',
        decisionReason: 'Verified fee breakdown with invoice proof.',
      },
      pool
    );

    return { approved, caseId, fingerprint };
  }

  it('rejects execution when approval is not yet approved (PENDING_APPROVAL)', async () => {
    const testCase = createTestCase('pending_rej');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const pendingApproval = await createApprovalRequest(
      {
        merchantId: verifiedMerchantId,
        caseId,
        recommendationId: 'rec_pending',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_1@closeloop.local',
      },
      pool
    );

    const eligibility = await checkExecutionEligibility(pendingApproval.id, verifiedMerchantId, pool);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.rejectionCode).toBe('APPROVAL_NOT_GRANTED');

    await expect(
      executeControlledAction(
        {
          approvalId: pendingApproval.id,
          merchantId: verifiedMerchantId,
          operatorId: 'operator_test@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/must be 'APPROVED'/i);
  });

  it('rejects execution when case version drifts', async () => {
    const { approved, caseId } = await createApprovedAction('ver_drift');

    // Progress case version in database
    await pool.query(`UPDATE exception_cases SET version = 2 WHERE id = $1;`, [caseId]);

    const eligibility = await checkExecutionEligibility(approved.id, verifiedMerchantId, pool);
    expect(eligibility.isEligible).toBe(false);
    expect(eligibility.rejectionCode).toBe('VERSION_DRIFT_DETECTED');

    await expect(
      executeControlledAction(
        {
          approvalId: approved.id,
          merchantId: verifiedMerchantId,
          operatorId: 'operator_test@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/Case version progressed/i);
  });

  it('rejects LIVE execution mode strictly (fails closed)', async () => {
    const { approved } = await createApprovedAction('live_rej');

    await expect(
      executeControlledAction(
        {
          approvalId: approved.id,
          merchantId: verifiedMerchantId,
          executionMode: 'LIVE',
          operatorId: 'operator_test@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/Live financial execution is strictly disabled/i);
  });

  it('rejects PAYPAL_SANDBOX mode with unavailable scope notice', async () => {
    const { approved } = await createApprovedAction('sbx_rej');

    await expect(
      executeControlledAction(
        {
          approvalId: approved.id,
          merchantId: verifiedMerchantId,
          executionMode: 'PAYPAL_SANDBOX',
          operatorId: 'operator_test@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/PayPal Sandbox Write API is unavailable/i);
  });

  it('successfully executes DRY_RUN simulation with explicit disclaimer and audit event', async () => {
    const { approved, caseId } = await createApprovedAction('dry_run_success');

    const execution = await executeControlledAction(
      {
        approvalId: approved.id,
        merchantId: verifiedMerchantId,
        executionMode: 'DRY_RUN',
        idempotencyKey: 'idem_key_test_1',
        operatorId: 'operator_exec@closeloop.local',
      },
      pool
    );

    expect(execution.id).toBeDefined();
    expect(execution.status).toBe('SIMULATED');
    expect(execution.executionMode).toBe('DRY_RUN');
    expect(execution.resultSummary.isSimulated).toBe(true);
    expect(execution.resultSummary.disclaimer).toBe(MANDATORY_SIMULATION_DISCLAIMER);
    expect(execution.resultSummary.simulatedLedgerImpact).toBeDefined();

    // Verify parent case status is NOT resolved (safety rule 7)
    const caseRes = await pool.query(`SELECT status FROM exception_cases WHERE id = $1;`, [caseId]);
    expect(caseRes.rows[0].status).toBe('OPEN');

    // Verify audit trail hash chain has EXECUTION_SIMULATED event appended
    const audit = await getApprovalAuditTrail(approved.id, verifiedMerchantId, pool);
    expect(audit.events).toHaveLength(3);
    expect(audit.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(audit.events[1].eventType).toBe('APPROVAL_GRANTED');
    expect(audit.events[2].eventType).toBe('EXECUTION_SIMULATED');
    expect(audit.chainVerification.isValid).toBe(true);
  });

  it('prevents duplicate execution of already executed approved action', async () => {
    const { approved } = await createApprovedAction('dup_exec');

    // First execution
    await executeControlledAction(
      {
        approvalId: approved.id,
        merchantId: verifiedMerchantId,
        idempotencyKey: 'first_run_key',
        operatorId: 'operator_exec@closeloop.local',
      },
      pool
    );

    // Second execution attempt
    await expect(
      executeControlledAction(
        {
          approvalId: approved.id,
          merchantId: verifiedMerchantId,
          idempotencyKey: 'second_run_key',
          operatorId: 'operator_exec@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/Action has already been executed/i);
  });

  it('enforces idempotency key collision prevention', async () => {
    const { approved } = await createApprovedAction('idem_collision');

    // Consume idempotency key
    await executeControlledAction(
      {
        approvalId: approved.id,
        merchantId: verifiedMerchantId,
        idempotencyKey: 'unique_key_101',
        operatorId: 'operator_exec@closeloop.local',
      },
      pool
    );

    // Create another approved action
    const { approved: approved2 } = await createApprovedAction('idem_collision_2');

    // Attempt to reuse the same idempotency key
    await expect(
      executeControlledAction(
        {
          approvalId: approved2.id,
          merchantId: verifiedMerchantId,
          idempotencyKey: 'unique_key_101', // Reused key!
          operatorId: 'operator_exec@closeloop.local',
        },
        pool
      )
    ).rejects.toThrowError(/Idempotency key 'unique_key_101' has already been processed/i);
  });
});

