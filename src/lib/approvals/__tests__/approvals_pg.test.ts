import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '@/lib/db/migrator';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import {
  createApprovalRequest,
  decideApproval,
  getApprovalAuditTrail,
} from '../approvalRepository';

// Load .env.local if present
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // optional
  }
}

describe('Phase 3D.4: Real PostgreSQL Immutability Triggers & Role Boundaries', () => {
  const liveDbUrl = process.env.DATABASE_URL;
  let isLivePgAvailable = false;
  let livePool: Pool | null = null;
  const testMerchant = 'merchant_approval_pg_test';

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
      caseKey: `v1_test_pg_approval_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_pg_approval_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 1000,
      expectedAmountMinor: 5000,
      actualAmountMinor: 4000,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-PG-${suffix}`,
      merchantOrderId: `ORD-PG-${suffix}`,
      paypalTransactionId: `TXN-PG-${suffix}`,
      notes: 'Real PG approval test case',
    },
    evidenceItems: [
      {
        merchantId: testMerchant,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-PG-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_pg_approval_${suffix}`,
        payloadSnapshot: { orderId: `ORD-PG-${suffix}`, amountMinor: 5000 },
        contentHash: `hash-pg-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  it('Gate 1: PostgreSQL trigger trg_prevent_approval_audit_update actively blocks UPDATE (SQLSTATE 23514)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`trg_up_${runId}`);
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
        recommendationId: `rec_pg_update_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_pg@closeloop.local',
      },
      livePool
    );

    // Direct UPDATE on approval_audit_events must raise SQLSTATE 23514
    await expect(
      livePool.query(
        `UPDATE approval_audit_events SET actor_id = 'malicious_actor' WHERE approval_id = $1;`,
        [approval.id]
      )
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('Gate 2: PostgreSQL trigger trg_prevent_approval_audit_delete actively blocks DELETE (SQLSTATE 23514)', async (ctx) => {
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
        recommendationId: `rec_pg_delete_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_pg@closeloop.local',
      },
      livePool
    );

    // Direct DELETE on approval_audit_events must raise SQLSTATE 23514
    await expect(
      livePool.query(
        `DELETE FROM approval_audit_events WHERE approval_id = $1;`,
        [approval.id]
      )
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('Gate 3: PostgreSQL trigger trg_prevent_case_approvals_delete actively blocks DELETE (SQLSTATE 23514)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`trg_app_del_${runId}`);
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
        recommendationId: `rec_pg_app_delete_${runId}`,
        actionId: 'WAIT_FOR_SETTLEMENT',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_pg@closeloop.local',
      },
      livePool
    );

    // Direct DELETE on case_approvals must raise SQLSTATE 23514
    await expect(
      livePool.query(`DELETE FROM case_approvals WHERE id = $1;`, [approval.id])
    ).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('Gate 4: Real PostgreSQL End-to-End Cryptographic Chain Integrity Verification', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const runId = Math.random().toString(36).substring(2, 9);
    const testCase = createTestCase(`e2e_chain_${runId}`);
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
        recommendationId: `rec_pg_e2e_${runId}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { note: 'Live PG test parameter binding' },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_live_1@closeloop.local',
      },
      livePool
    );

    // Operator grants approval
    await decideApproval(
      {
        approvalId: approval.id,
        merchantId: testMerchant,
        decision: 'APPROVE',
        decidedBy: 'operator_live_2@closeloop.local',
        decisionReason: 'Verified against PayPal live settlement table.',
      },
      livePool
    );

    // Verify chain integrity in PostgreSQL
    const auditData = await getApprovalAuditTrail(approval.id, testMerchant, livePool);
    expect(auditData.chainVerification.isValid).toBe(true);
    expect(auditData.chainVerification.totalEvents).toBe(2);
    expect(auditData.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(auditData.events[1].eventType).toBe('APPROVAL_GRANTED');
  });
});
