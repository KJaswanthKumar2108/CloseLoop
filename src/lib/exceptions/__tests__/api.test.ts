import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createCasesHandler, GET as listCasesHandler } from '@/app/api/exceptions/cases/route';
import { GET as getCaseByIdHandler } from '@/app/api/exceptions/cases/[id]/route';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';

describe('Phase 3D.1: Exception Cases API Integration Suite (Hardened per F-23)', () => {
  const verifiedMerchantId = 'test_merchant_authoritative';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const validReconRun = {
    id: 'run_api_test_01',
    startedAt: '2026-11-01T10:00:00Z',
    completedAt: '2026-11-01T10:01:00Z',
    totalOrders: 1,
    totalTransactions: 1,
    matchedCount: 1,
    unmatchedOrderCount: 0,
    unmatchedTransactionCount: 0,
    exceptionCount: 1,
    status: 'COMPLETED',
    records: [
      {
        id: 'rec_01',
        orderId: 'ORD-API-01',
        transactionIds: ['TXN-API-01'],
        matchStatus: 'DISCREPANCY',
        discrepancyType: 'FEE_VARIANCE',
        confidence: 'EXACT_AUTHORITATIVE',
        matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
        expectedAmount: { amountMinor: 290, currency: 'USD', precision: 2 },
        actualAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
        varianceAmount: { amountMinor: 35, currency: 'USD', precision: 2 },
        currency: 'USD',
        evidence: {
          orderId: 'ORD-API-01',
          transactionIds: ['TXN-API-01'],
          matchingMethod: 'AUTHORITATIVE_IDENTIFIER',
          matchingRule: 'RULE_EXACT_ORDER_ID',
          comparedFields: [],
          amountComparison: {
            expectedAmountMinor: 290,
            actualAmountMinor: 325,
            varianceMinor: 35,
            currency: 'USD',
            isExactMatch: false,
          },
          currencyComparison: { orderCurrency: 'USD', transactionCurrency: 'USD', matches: true },
          reasonsForAccepting: [],
          reasonsForRejectingCandidates: [],
        },
        createdAt: '2026-11-01T10:05:00Z',
      },
    ],
  };

  const sampleOrder = {
    id: 'ord-api-1',
    merchantOrderId: 'ORD-API-01',
    externalReference: 'EXT-API-01',
    expectedAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
    currency: 'USD',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    orderStatus: 'CONFIRMED',
    paymentStatus: 'PAID',
    source: 'TEST',
    metadata: {},
  };

  const sampleTxn = {
    id: 'txn-api-1',
    paypalTransactionId: 'TXN-API-01',
    grossAmount: { amountMinor: 10000, currency: 'USD', precision: 2 },
    feeAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
    netAmount: { amountMinor: 9675, currency: 'USD', precision: 2 },
    currency: 'USD',
    transactionType: 'CAPTURE',
    transactionStatus: 'COMPLETED',
    transactionTime: '2026-11-01T10:00:05Z',
    source: 'PAYPAL_API',
    rawReference: 'raw-api-1',
  };

  const makeJsonPostRequest = (url: string, body: unknown, headers: Record<string, string> = {}) => {
    return new NextRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  };

  describe('Anti-Spoofing & Trusted Tenant Identity (F-23)', () => {
    it('fails closed with 500 Internal Server Error when CLOSELOOP_MERCHANT_ID is unconfigured', async () => {
      delete process.env.CLOSELOOP_MERCHANT_ID;

      const req = makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
        reconciliationRun: validReconRun,
        orders: [sampleOrder],
        transactions: [sampleTxn],
      });

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.code).toBe('MISSING_MERCHANT_CONFIGURATION');
      expect(data.message).toContain('Server must fail closed');
    });

    it('rejects client attempts to supply a spoofed x-merchant-id header with 403 Forbidden', async () => {
      const req = makeJsonPostRequest(
        'http://localhost:3000/api/exceptions/cases',
        {
          reconciliationRun: validReconRun,
          orders: [sampleOrder],
          transactions: [sampleTxn],
        },
        { 'x-merchant-id': 'unauthorized_attacker_merchant' }
      );

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
      expect(data.message).toContain('Cross-tenant access forbidden');
    });

    it('rejects client attempts to supply a spoofed merchantId in request body with 403 Forbidden', async () => {
      const req = makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
        reconciliationRun: validReconRun,
        merchantId: 'malicious_body_merchant',
        orders: [sampleOrder],
        transactions: [sampleTxn],
      });

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });

    it('rejects simultaneous mismatched header and body with 403 Forbidden', async () => {
      const req = makeJsonPostRequest(
        'http://localhost:3000/api/exceptions/cases',
        {
          reconciliationRun: validReconRun,
          merchantId: 'spoofed_body_merchant',
          orders: [sampleOrder],
          transactions: [sampleTxn],
        },
        { 'x-merchant-id': 'spoofed_header_merchant' }
      );

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });

    it('rejects spoofed body merchantId even when header matches server identity', async () => {
      const req = makeJsonPostRequest(
        'http://localhost:3000/api/exceptions/cases',
        {
          reconciliationRun: validReconRun,
          merchantId: 'spoofed_body_merchant',
          orders: [sampleOrder],
          transactions: [sampleTxn],
        },
        { 'x-merchant-id': verifiedMerchantId }
      );

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });

    it('rejects spoofed header merchantId even when body matches server identity', async () => {
      const req = makeJsonPostRequest(
        'http://localhost:3000/api/exceptions/cases',
        {
          reconciliationRun: validReconRun,
          merchantId: verifiedMerchantId,
          orders: [sampleOrder],
          transactions: [sampleTxn],
        },
        { 'x-merchant-id': 'spoofed_header_merchant' }
      );

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });

    it('accepts matching client header and body under valid configuration', async () => {
      const req = makeJsonPostRequest(
        'http://localhost:3000/api/exceptions/cases',
        {
          reconciliationRun: validReconRun,
          merchantId: verifiedMerchantId,
          orders: [sampleOrder],
          transactions: [sampleTxn],
        },
        { 'x-merchant-id': verifiedMerchantId }
      );

      const res = await createCasesHandler(req);
      expect(res.status).toBe(201);
    });

    it('rejects spoofed x-merchant-id on GET /api/exceptions/cases/:id with 403 Forbidden', async () => {
      const validUuid = '11111111-2222-3333-4444-555555555555';
      const req = new NextRequest(`http://localhost:3000/api/exceptions/cases/${validUuid}`, {
        method: 'GET',
        headers: { 'x-merchant-id': 'spoofed_tenant' },
      });

      const res = await getCaseByIdHandler(req, { params: Promise.resolve({ id: validUuid }) });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.code).toBe('SPOOFED_TENANT_IDENTITY');
    });
  });

  describe('POST /api/exceptions/cases', () => {
    it('extracts and persists exception cases from a valid run under verified server identity (201 Created)', async () => {
      const req = makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
        reconciliationRun: validReconRun,
        orders: [sampleOrder],
        transactions: [sampleTxn],
      });

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.merchantId).toBe(verifiedMerchantId);
      expect(data.casesExtracted).toBe(1);
      expect(data.casesCreated).toBe(1);
      expect(data.caseIds).toHaveLength(1);
      expect(data.evidenceItemsInserted).toBeGreaterThanOrEqual(1);
    });

    it('rejects unsupported media type with 415 when Content-Type is missing or not application/json', async () => {
      const req = new NextRequest('http://localhost:3000/api/exceptions/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'invalid plain text',
      });

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(415);
      expect(data.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('validates request payload and returns 400 VALIDATION_ERROR on malformed run', async () => {
      const req = makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
        reconciliationRun: { invalid: 'payload' },
      });

      const res = await createCasesHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/exceptions/cases/:id', () => {
    it('retrieves an existing case with its full evidence graph (200 OK)', async () => {
      // 1. Create a case under verified merchant
      const createReq = makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
        reconciliationRun: validReconRun,
        orders: [sampleOrder],
        transactions: [sampleTxn],
      });
      const createRes = await createCasesHandler(createReq);
      const createData = await createRes.json();
      const caseId = createData.caseIds[0];

      // 2. Fetch the case
      const getReq = new NextRequest(`http://localhost:3000/api/exceptions/cases/${caseId}`, {
        method: 'GET',
      });
      const getRes = await getCaseByIdHandler(getReq, { params: Promise.resolve({ id: caseId }) });
      const getData = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getData.success).toBe(true);
      expect(getData.case.id).toBe(caseId);
      expect(getData.case.merchantId).toBe(verifiedMerchantId);
      expect(getData.case.discrepancyType).toBe('FEE_VARIANCE');
      expect(getData.case.evidence.length).toBeGreaterThanOrEqual(2);
    });

    it('returns 400 INVALID_CASE_ID when path parameter is not a valid UUID', async () => {
      const getReq = new NextRequest('http://localhost:3000/api/exceptions/cases/not-a-valid-uuid', {
        method: 'GET',
      });
      const getRes = await getCaseByIdHandler(getReq, {
        params: Promise.resolve({ id: 'not-a-valid-uuid' }),
      });
      const getData = await getRes.json();

      expect(getRes.status).toBe(400);
      expect(getData.code).toBe('INVALID_CASE_ID');
    });

    it('returns 404 CASE_NOT_FOUND when case does not exist', async () => {
      const nonExistentUuid = '00000000-0000-4000-8000-000000000000';
      const getReq = new NextRequest(`http://localhost:3000/api/exceptions/cases/${nonExistentUuid}`, {
        method: 'GET',
      });
      const getRes = await getCaseByIdHandler(getReq, { params: Promise.resolve({ id: nonExistentUuid }) });
      const getData = await getRes.json();

      expect(getRes.status).toBe(404);
      expect(getData.code).toBe('CASE_NOT_FOUND');
    });
  });

  describe('GET /api/exceptions/cases', () => {
    it('lists cases scoped strictly to the authoritative merchant', async () => {
      // Create case
      await createCasesHandler(
        makeJsonPostRequest('http://localhost:3000/api/exceptions/cases', {
          reconciliationRun: validReconRun,
          orders: [sampleOrder],
          transactions: [sampleTxn],
        })
      );

      const listReq = new NextRequest('http://localhost:3000/api/exceptions/cases?limit=10', {
        method: 'GET',
      });
      const listRes = await listCasesHandler(listReq);
      const listData = await listRes.json();

      expect(listRes.status).toBe(200);
      expect(listData.total).toBe(1);
      expect(listData.cases).toHaveLength(1);
      expect(listData.cases[0].merchantId).toBe(verifiedMerchantId);
    });
  });
});
