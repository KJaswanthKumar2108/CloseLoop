import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { getPool } from '@/lib/db/pool';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import { createApprovalRequest, decideApproval } from '@/lib/approvals/approvalRepository';
import {
  POST as postExecuteHandler,
  GET as getExecuteEligibilityHandler,
} from '@/app/api/exceptions/approvals/[approvalId]/execute/route';
import { GET as getExecutionsHandler } from '@/app/api/exceptions/approvals/[approvalId]/executions/route';
import { MANDATORY_SIMULATION_DISCLAIMER } from '../types';

describe('Phase 3D.5: Execution API Routes Integration Suite', () => {
  const verifiedMerchantId = 'merchant_exec_api_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string, merchantId = verifiedMerchantId): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_test_exec_api_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_exec_api_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 1500,
      expectedAmountMinor: 10000,
      actualAmountMinor: 8500,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-API-${suffix}`,
      merchantOrderId: `ORD-API-${suffix}`,
      paypalTransactionId: `TXN-API-${suffix}`,
      notes: 'Execution API integration test',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-API-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_exec_api_${suffix}`,
        payloadSnapshot: { orderId: `ORD-API-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-exec-api-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  const makeRequest = (
    url: string,
    method: string,
    body?: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) => {
    return new NextRequest(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  async function createApprovedAction(suffix: string) {
    const pool = getPool();
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
        recommendationId: `rec_api_${suffix}`,
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { varianceMinor: 1500 },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        requestedBy: 'operator_submitter@closeloop.local',
      },
      pool
    );

    const approved = await decideApproval(
      {
        approvalId: approval.id,
        merchantId: verifiedMerchantId,
        decision: 'APPROVE',
        decidedBy: 'supervisor@closeloop.local',
        decisionReason: 'Approved following invoice match.',
      },
      pool
    );

    return { approved, caseId };
  }

  it('checks execution eligibility via GET /api/exceptions/approvals/[approvalId]/execute', async () => {
    const { approved } = await createApprovedAction('eligibility_check');

    const req = makeRequest(
      `http://localhost/api/exceptions/approvals/${approved.id}/execute`,
      'GET'
    );

    const res = await getExecuteEligibilityHandler(req, {
      params: Promise.resolve({ approvalId: approved.id }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.eligibility.isEligible).toBe(true);
    expect(json.disclaimer).toBe(MANDATORY_SIMULATION_DISCLAIMER);
  });

  it('executes controlled DRY_RUN simulation via POST /api/exceptions/approvals/[approvalId]/execute', async () => {
    const { approved } = await createApprovedAction('execute_action');

    const req = makeRequest(
      `http://localhost/api/exceptions/approvals/${approved.id}/execute`,
      'POST',
      {
        executionMode: 'DRY_RUN',
        idempotencyKey: 'api_idem_101',
      },
      { 'x-operator-id': 'operator_runner@closeloop.local' }
    );

    const res = await postExecuteHandler(req, {
      params: Promise.resolve({ approvalId: approved.id }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.execution.status).toBe('SIMULATED');
    expect(json.execution.executionMode).toBe('DRY_RUN');
    expect(json.disclaimer).toBe(MANDATORY_SIMULATION_DISCLAIMER);
    expect(json.message).toBe(MANDATORY_SIMULATION_DISCLAIMER);
  });

  it('lists executions via GET /api/exceptions/approvals/[approvalId]/executions', async () => {
    const { approved } = await createApprovedAction('list_execs');

    // Run execution
    const execReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approved.id}/execute`,
      'POST',
      { executionMode: 'DRY_RUN' }
    );
    await postExecuteHandler(execReq, {
      params: Promise.resolve({ approvalId: approved.id }),
    });

    // List executions
    const listReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approved.id}/executions`,
      'GET'
    );
    const res = await getExecutionsHandler(listReq, {
      params: Promise.resolve({ approvalId: approved.id }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.executions).toHaveLength(1);
    expect(json.executions[0].status).toBe('SIMULATED');
  });

  it('enforces tenant boundary: rejects spoofed x-merchant-id header with 403', async () => {
    const { approved } = await createApprovedAction('tenant_spoof');

    const spoofedReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approved.id}/execute`,
      'POST',
      { executionMode: 'DRY_RUN' },
      { 'x-merchant-id': 'attacker_merchant_id' }
    );

    const res = await postExecuteHandler(spoofedReq, {
      params: Promise.resolve({ approvalId: approved.id }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('SPOOFED_TENANT_IDENTITY');
  });
});

