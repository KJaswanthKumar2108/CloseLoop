import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '@/lib/db/migrator';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import { createApprovalRequest, decideApproval, getApprovalAuditTrail } from '@/lib/approvals/approvalRepository';
import { executeControlledAction } from '../executionEngine';

// Load .env.local if present
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // optional
  }
}

describe('Phase 3D.5: Real PostgreSQL Execution Triggers & Chain Continuity', () => {
  const liveDbUrl = process.env.DATABASE_URL;
  let isLivePgAvailable = false;
  let livePool: Pool | null = null;
  const testMerchant = 'merchant_exec_pg_test';

  beforeAll(async () => {
    if (liveDbUrl) {
      try {
        const parsed = new URL(liveDbUrl);
        const isApprovedHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
        const isApprovedDb = parsed.pathname.replace(/^\//, '') === 'closeloop_test';

        if (isApprovedHost && isApprovedDb) {
          const testPool = new Pool({
            connectionString: liveDbUrl,
            connectionTimeoutMillis: 2000,
          });
          testPool.on('error', () => {});

          const client = await testPool.connect();
          await client.query('SELECT 1;');
          await runMigrations(testPool);
          client.release();

          livePool = testPool;
          isLivePgAvailable = true;
        }
      } catch {
        isLivePgAvailable = false;
      }
    }
  });

  afterAll(async () => {
    if (livePool) {
      await livePool.end();
    }
  });

  const createTestCase = (suffix: string): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId: testMerchant,
      caseKey: `v1_test_pg_exec_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_pg_exec_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 1200,
      expectedAmountMinor: 6000,
      actualAmountMinor: 4800,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-PG-EXEC-${suffix}`,
      merchantOrderId: `ORD-PG-EXEC-${suffix}`,
      paypalTransactionId: `TXN-PG-EXEC-${suffix}`,
      notes: 'Real PG execution test case',
    },
    evidenceItems: [
      {
        merchantId: testMerchant,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-PG-EXEC-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_pg_exec_${suffix}`,
        payloadSnapshot: { orderId: `ORD-PG-EXEC-${suffix}`, amountMinor: 6000 },
        contentHash: `hash-pg-exec-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  it('Gate 1: PostgreSQL trigger trg_prevent_case_executions_delete actively blocks DELETE (SQLSTATE 23514)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`trg_del_${runId}`);
    const persisted = await persistExceptionCases(livePool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await livePool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: testMerchant,
        caseId,
        recommendationId: `rec_pg_exec_del_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_pg@closeloop.local',
      },
      livePool
    );

    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        decision: 'APPROVE',
        decidedBy: 'supervisor_pg@closeloop.local',
        decisionReason: 'Live PG approved.',
      },
      livePool
    );

    const execution = await executeControlledAction(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        executionMode: 'DRY_RUN',
        idempotencyKey: `idem_pg_del_${runId}`,
        operatorId: 'operator_pg@closeloop.local',
      },
      livePool
    );

    // Direct DELETE on case_executions must raise SQLSTATE 23514
    await expect(
      livePool.query(`DELETE FROM case_executions WHERE id = $1;`, [execution.id])
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('Gate 2: PostgreSQL trigger trg_prevent_terminal_execution_update actively blocks UPDATE on SIMULATED (SQLSTATE 23514)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`trg_upd_${runId}`);
    const persisted = await persistExceptionCases(livePool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await livePool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const approval = await createApprovalRequest(
      {
        merchantId: testMerchant,
        caseId,
        recommendationId: `rec_pg_exec_upd_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_pg@closeloop.local',
      },
      livePool
    );

    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        decision: 'APPROVE',
        decidedBy: 'supervisor_pg@closeloop.local',
        decisionReason: 'Live PG approved.',
      },
      livePool
    );

    const execution = await executeControlledAction(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        executionMode: 'DRY_RUN',
        idempotencyKey: `idem_pg_upd_${runId}`,
        operatorId: 'operator_pg@closeloop.local',
      },
      livePool
    );

    // Direct UPDATE on terminal execution must raise SQLSTATE 23514
    await expect(
      livePool.query(
        `UPDATE case_executions SET status = 'SUCCEEDED' WHERE id = $1;`,
        [execution.id]
      )
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('Gate 3: Full End-to-End Cryptographic Audit Chain Continuity in Real PostgreSQL', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`chain_cont_${runId}`);
    const persisted = await persistExceptionCases(livePool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await livePool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    // 1. APPROVAL_REQUESTED
    const approval = await createApprovalRequest(
      {
        merchantId: testMerchant,
        caseId,
        recommendationId: `rec_pg_chain_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_1@closeloop.local',
      },
      livePool
    );

    // 2. APPROVAL_GRANTED
    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        decision: 'APPROVE',
        decidedBy: 'operator_2@closeloop.local',
        decisionReason: 'Grounded against live ledger.',
      },
      livePool
    );

    // 3. EXECUTION_SIMULATED
    await executeControlledAction(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        executionMode: 'DRY_RUN',
        idempotencyKey: `idem_chain_${runId}`,
        operatorId: 'operator_3@closeloop.local',
      },
      livePool
    );

    // Fetch and verify 3-stage chain
    const auditData = await getApprovalAuditTrail(approval.id, testMerchant, livePool);
    expect(auditData.chainVerification.isValid).toBe(true);
    expect(auditData.chainVerification.totalEvents).toBe(3);
    expect(auditData.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(auditData.events[1].eventType).toBe('APPROVAL_GRANTED');
    expect(auditData.events[2].eventType).toBe('EXECUTION_SIMULATED');
  });
});

