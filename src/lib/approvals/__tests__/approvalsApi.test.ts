import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { getPool } from '@/lib/db/pool';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { computeEvidenceFingerprint } from '@/lib/ai/contextBuilder';
import {
  POST as postCaseApprovalsHandler,
  GET as getCaseApprovalsHandler,
} from '@/app/api/exceptions/cases/[id]/approvals/route';
import { POST as postApproveHandler } from '@/app/api/exceptions/approvals/[approvalId]/approve/route';
import { POST as postRejectHandler } from '@/app/api/exceptions/approvals/[approvalId]/reject/route';
import { GET as getAuditHandler } from '@/app/api/exceptions/approvals/[approvalId]/audit/route';
import {
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '../types';

describe('Phase 3D.4: Approvals API Routes Integration Suite', () => {
  const verifiedMerchantId = 'merchant_approval_api_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    delete process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL;
    await setupTestDatabase();
  });

  afterEach(async () => {
    delete process.env.CLOSELOOP_ENFORCE_DUAL_CONTROL;
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string, merchantId = verifiedMerchantId): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_test_approval_api_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_approval_api_${suffix}`,
      discrepancyType: 'AMOUNT_MISMATCH',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 1500,
      expectedAmountMinor: 10000,
      actualAmountMinor: 8500,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-${suffix}`,
      merchantOrderId: `ORD-${suffix}`,
      paypalTransactionId: `TXN-${suffix}`,
      notes: 'Approval API test case',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_approval_api_${suffix}`,
        payloadSnapshot: { orderId: `ORD-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-order-${suffix}`.padStart(64, '0'),
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

  it('submits an approval request via POST /api/exceptions/cases/[id]/approvals', async () => {
    const pool = getPool();
    const testCase = createTestCase('post_approval');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const req = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_api_1',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        actionParameters: { varianceMinor: 1500 },
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
        expiresInHours: 48,
      },
      { 'x-operator-id': 'operator_req@closeloop.local' }
    );

    const res = await postCaseApprovalsHandler(req, { params: Promise.resolve({ id: caseId }) });
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.approval.id).toBeDefined();
    expect(json.approval.status).toBe('PENDING_APPROVAL');
    expect(json.approval.canonicalBindingHash).toHaveLength(64);
    expect(json.approval.disclaimer).toBe(MANDATORY_APPROVAL_DISCLAIMER);
  });

  it('lists approval requests via GET /api/exceptions/cases/[id]/approvals', async () => {
    const pool = getPool();
    const testCase = createTestCase('list_approvals');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    // Create an approval request first
    const createReq = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_list_1',
        actionId: 'WAIT_FOR_SETTLEMENT',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
      }
    );
    await postCaseApprovalsHandler(createReq, { params: Promise.resolve({ id: caseId }) });

    // List approvals
    const listReq = makeRequest(`http://localhost/api/exceptions/cases/${caseId}/approvals`, 'GET');
    const res = await getCaseApprovalsHandler(listReq, { params: Promise.resolve({ id: caseId }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.approvals).toHaveLength(1);
    expect(json.approvals[0].actionId).toBe('WAIT_FOR_SETTLEMENT');
  });

  it('approves an approval request via POST /api/exceptions/approvals/[approvalId]/approve', async () => {
    const pool = getPool();
    const testCase = createTestCase('approve_api');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const createReq = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_approve_api',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
      },
      { 'x-operator-id': 'operator_submitter@closeloop.local' }
    );
    const createRes = await postCaseApprovalsHandler(createReq, { params: Promise.resolve({ id: caseId }) });
    const createJson = await createRes.json();
    const approvalId = createJson.approval.id;

    // Approve the request
    const approveReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approvalId}/approve`,
      'POST',
      {
        reason: 'Authorized following cross-examination of PayPal ledger.',
      },
      { 'x-operator-id': 'operator_approver@closeloop.local' }
    );

    const approveRes = await postApproveHandler(approveReq, {
      params: Promise.resolve({ approvalId }),
    });
    expect(approveRes.status).toBe(200);

    const approveJson = await approveRes.json();
    expect(approveJson.success).toBe(true);
    expect(approveJson.approval.status).toBe('APPROVED');
    expect(approveJson.approval.displayLabel).toBe(APPROVED_AWAITING_EXECUTION_LABEL);
    expect(approveJson.approval.disclaimer).toBe(MANDATORY_APPROVAL_DISCLAIMER);
    expect(approveJson.message).toBe(MANDATORY_APPROVAL_DISCLAIMER);
  });

  it('rejects an approval request via POST /api/exceptions/approvals/[approvalId]/reject', async () => {
    const pool = getPool();
    const testCase = createTestCase('reject_api');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const createReq = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_reject_api',
        actionId: 'REQUEST_MERCHANT_DOCUMENTATION',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
      }
    );
    const createRes = await postCaseApprovalsHandler(createReq, { params: Promise.resolve({ id: caseId }) });
    const createJson = await createRes.json();
    const approvalId = createJson.approval.id;

    // Reject the request
    const rejectReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approvalId}/reject`,
      'POST',
      {
        reason: 'Operator rejected after contacting vendor directly.',
      }
    );

    const rejectRes = await postRejectHandler(rejectReq, {
      params: Promise.resolve({ approvalId }),
    });
    expect(rejectRes.status).toBe(200);

    const rejectJson = await rejectRes.json();
    expect(rejectJson.success).toBe(true);
    expect(rejectJson.approval.status).toBe('REJECTED');
  });

  it('retrieves audit trail and cryptographic hash-chain verification via GET /api/exceptions/approvals/[approvalId]/audit', async () => {
    const pool = getPool();
    const testCase = createTestCase('audit_api');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const evidenceRes = await pool.query(
      `SELECT id, content_hash AS "contentHash" FROM case_evidence_items WHERE case_id = $1;`,
      [caseId]
    );
    const fingerprint = computeEvidenceFingerprint(caseId, 1, evidenceRes.rows);

    const createReq = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_audit_api',
        actionId: 'INVESTIGATE_AMOUNT_VARIANCE',
        caseVersion: 1,
        evidenceFingerprint: fingerprint,
      }
    );
    const createRes = await postCaseApprovalsHandler(createReq, { params: Promise.resolve({ id: caseId }) });
    const createJson = await createRes.json();
    const approvalId = createJson.approval.id;

    // Fetch audit trail
    const auditReq = makeRequest(
      `http://localhost/api/exceptions/approvals/${approvalId}/audit`,
      'GET'
    );
    const auditRes = await getAuditHandler(auditReq, {
      params: Promise.resolve({ approvalId }),
    });
    expect(auditRes.status).toBe(200);

    const auditJson = await auditRes.json();
    expect(auditJson.success).toBe(true);
    expect(auditJson.events).toHaveLength(1);
    expect(auditJson.events[0].eventType).toBe('APPROVAL_REQUESTED');
    expect(auditJson.chainVerification.isValid).toBe(true);
    expect(auditJson.chainVerification.totalEvents).toBe(1);
  });

  it('enforces tenant boundary: rejects spoofed x-merchant-id header with 403', async () => {
    const pool = getPool();
    const testCase = createTestCase('spoof_tenant');
    const persisted = await persistExceptionCases(pool, [testCase]);
    const caseId = persisted.caseIds[0];

    const spoofedReq = makeRequest(
      `http://localhost/api/exceptions/cases/${caseId}/approvals`,
      'POST',
      {
        recommendationId: 'rec_spoof',
        actionId: 'WAIT_FOR_SETTLEMENT',
        caseVersion: 1,
        evidenceFingerprint: '0'.repeat(64),
      },
      { 'x-merchant-id': 'attacker_merchant_id' }
    );

    const res = await postCaseApprovalsHandler(spoofedReq, { params: Promise.resolve({ id: caseId }) });
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.code).toBe('SPOOFED_TENANT_IDENTITY');
  });
});
