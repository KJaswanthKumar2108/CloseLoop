import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import {
  POST as postRecommendationsHandler,
  GET as getRecommendationsHandler,
} from '@/app/api/exceptions/cases/[id]/recommendations/route';
import { MANDATORY_RESOLUTION_DISCLAIMER } from '@/lib/resolution/types';

describe('Phase 3D.3: Recommendations API Route Integration Suite', () => {
  const verifiedMerchantId = 'merchant_rec_api_test';

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
      caseKey: `v1_test_rec_api_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_rec_api_${suffix}`,
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
      notes: 'API recommendations test',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_rec_api_${suffix}`,
        payloadSnapshot: { orderId: `ORD-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
      {
        merchantId,
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: `TXN-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_rec_api_${suffix}`,
        payloadSnapshot: { transactionId: `TXN-${suffix}`, amountMinor: 8500 },
        contentHash: `hash-txn-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  const makeRequest = (url: string, method: string, headers: Record<string, string> = {}) => {
    return new NextRequest(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
    });
  };

  it('generates and returns deterministic recommendations via POST', async () => {
    const testCase = createTestCase('post_rec_1');
    const persisted = await persistExceptionCases(undefined, [testCase]);
    const caseId = persisted.caseIds[0];

    const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/recommendations`, 'POST');
    const res = await postRecommendationsHandler(req, { params: Promise.resolve({ id: caseId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.caseId).toBe(caseId);
    expect(body.merchantId).toBe(verifiedMerchantId);
    expect(body.disclaimer).toBe(MANDATORY_RESOLUTION_DISCLAIMER);
    expect(body.recommendations).toBeInstanceOf(Array);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations[0].actionId).toBe('INVESTIGATE_AMOUNT_VARIANCE');
    expect(body.recommendations[0].isPrimary).toBe(true);
  });

  it('retrieves deterministic recommendations via GET', async () => {
    const testCase = createTestCase('get_rec_1');
    const persisted = await persistExceptionCases(undefined, [testCase]);
    const caseId = persisted.caseIds[0];

    const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/recommendations`, 'GET');
    const res = await getRecommendationsHandler(req, { params: Promise.resolve({ id: caseId }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.caseId).toBe(caseId);
    expect(body.recommendations[0].actionId).toBe('INVESTIGATE_AMOUNT_VARIANCE');
  });

  it('rejects invalid UUID case IDs with 400 Bad Request', async () => {
    const req = makeRequest('http://localhost:3000/api/exceptions/cases/invalid-uuid-format/recommendations', 'GET');
    const res = await getRecommendationsHandler(req, { params: Promise.resolve({ id: 'invalid-uuid-format' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_CASE_ID');
  });

  it('rejects spoofed client tenant headers with 403 Forbidden', async () => {
    const testCase = createTestCase('spoof_rec_1');
    const persisted = await persistExceptionCases(undefined, [testCase]);
    const caseId = persisted.caseIds[0];

    const req = makeRequest(
      `http://localhost:3000/api/exceptions/cases/${caseId}/recommendations`,
      'POST',
      { 'x-merchant-id': 'attacker_merchant' }
    );
    const res = await postRecommendationsHandler(req, { params: Promise.resolve({ id: caseId }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('SPOOFED_TENANT_IDENTITY');
  });

  it('enforces cross-merchant isolation returning 404 for another merchant case', async () => {
    const otherMerchant = 'other_merchant_secret';
    const testCase = createTestCase('cross_rec_1', otherMerchant);
    const persisted = await persistExceptionCases(undefined, [testCase]);
    const caseId = persisted.caseIds[0];

    // Authenticated as verifiedMerchantId, attempting to access otherMerchant's case
    const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/recommendations`, 'GET');
    const res = await getRecommendationsHandler(req, { params: Promise.resolve({ id: caseId }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('CASE_NOT_FOUND');
  });
});
