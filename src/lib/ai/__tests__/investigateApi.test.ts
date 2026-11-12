import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { POST as runInvestigationHandler, GET as getInvestigationHistoryHandler } from '@/app/api/exceptions/cases/[id]/investigate/route';

describe('Phase 3D.2: Investigation API Route Integration Suite', () => {
  const verifiedMerchantId = 'merchant_api_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    process.env.CLOSELOOP_AI_PROVIDER = 'mock';
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string, merchantId = verifiedMerchantId): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_test_api_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_api_${suffix}`,
      discrepancyType: 'FEE_VARIANCE',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 35,
      expectedAmountMinor: 290,
      actualAmountMinor: 325,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-${suffix}`,
      merchantOrderId: `ORD-${suffix}`,
      paypalTransactionId: `TXN-${suffix}`,
      notes: 'API investigation test',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_api_${suffix}`,
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
        reconciliationRunId: `run_api_${suffix}`,
        payloadSnapshot: { transactionId: `TXN-${suffix}`, feeMinor: 325 },
        contentHash: `hash-txn-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  const makeRequest = (url: string, method: string, headers: Record<string, string> = {}) => {
    return new NextRequest(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    });
  };

  describe('POST /api/exceptions/cases/[id]/investigate', () => {
    it('fails closed with 500 when CLOSELOOP_MERCHANT_ID is missing', async () => {
      delete process.env.CLOSELOOP_MERCHANT_ID;
      const fakeUuid = '00000000-0000-4000-8000-000000000001';
      const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${fakeUuid}/investigate`, 'POST');
      const res = await runInvestigationHandler(req, { params: Promise.resolve({ id: fakeUuid }) });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.code).toBe('MISSING_MERCHANT_CONFIGURATION');
    });

    it('rejects spoofed x-merchant-id header with 403 Forbidden', async () => {
      const fakeUuid = '00000000-0000-4000-8000-000000000001';
      const req = makeRequest(
        `http://localhost:3000/api/exceptions/cases/${fakeUuid}/investigate`,
        'POST',
        { 'x-merchant-id': 'spoofed_attacker' }
      );
      const res = await runInvestigationHandler(req, { params: Promise.resolve({ id: fakeUuid }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });

    it('rejects malformed non-UUID case ID with 400 Bad Request', async () => {
      const req = makeRequest('http://localhost:3000/api/exceptions/cases/not-a-uuid/investigate', 'POST');
      const res = await runInvestigationHandler(req, { params: Promise.resolve({ id: 'not-a-uuid' }) });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('INVALID_CASE_ID');
    });

    it('returns 404 when case does not exist or belongs to another merchant', async () => {
      const unownedUuid = '00000000-0000-4000-8000-000000000099';
      const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${unownedUuid}/investigate`, 'POST');
      const res = await runInvestigationHandler(req, { params: Promise.resolve({ id: unownedUuid }) });
      const data = await res.json();

      expect(res.status).toBe(404);
      expect(data.code).toBe('CASE_NOT_FOUND');
    });

    it('executes investigation and returns 200 with structured analysis', async () => {
      const persisted = await persistExceptionCases(undefined, [createTestCase('api_success')]);
      const caseId = persisted.caseIds[0];

      const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/investigate`, 'POST');
      const res = await runInvestigationHandler(req, { params: Promise.resolve({ id: caseId }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.investigationId).toBeDefined();
      expect(data.caseId).toBe(caseId);
      expect(data.merchantId).toBe(verifiedMerchantId);
      expect(data.investigation.schemaVersion).toBe('1.0');
      expect(data.investigation.establishedFacts.length).toBeGreaterThan(0);
      expect(data.investigation.disclaimer).toContain('advisory and require human verification');
    });
  });

  describe('GET /api/exceptions/cases/[id]/investigate', () => {
    it('returns 200 with empty array when no investigations have run yet', async () => {
      const persisted = await persistExceptionCases(undefined, [createTestCase('api_get_empty')]);
      const caseId = persisted.caseIds[0];

      const req = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/investigate`, 'GET');
      const res = await getInvestigationHistoryHandler(req, { params: Promise.resolve({ id: caseId }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.caseId).toBe(caseId);
      expect(data.investigations).toEqual([]);
    });

    it('returns 200 with historical investigations ordered descending by date', async () => {
      const persisted = await persistExceptionCases(undefined, [createTestCase('api_get_history')]);
      const caseId = persisted.caseIds[0];

      // Trigger two investigations
      const postReq = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/investigate`, 'POST');
      await runInvestigationHandler(postReq, { params: Promise.resolve({ id: caseId }) });
      await runInvestigationHandler(postReq, { params: Promise.resolve({ id: caseId }) });

      const getReq = makeRequest(`http://localhost:3000/api/exceptions/cases/${caseId}/investigate`, 'GET');
      const res = await getInvestigationHistoryHandler(getReq, { params: Promise.resolve({ id: caseId }) });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.caseId).toBe(caseId);
      expect(data.investigations.length).toBe(2);
      expect(data.investigations[0].status).toBe('COMPLETED');
    });
  });
});
