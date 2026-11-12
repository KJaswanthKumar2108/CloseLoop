import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { persistExceptionCases, findCaseById } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { investigateCase } from '../investigationService';
import { MockAIProviderClient } from '../mockProvider';
import {
  findLatestInvestigationByCaseId,
  listInvestigationsByCaseId,
} from '../investigationRepository';
import { GroundingValidationError } from '../schemas';
import { AIProviderError, AIProviderClient, AIProviderRequest } from '../types';

describe('Phase 3D.2: Investigation Orchestration Service Suite', () => {
  const verifiedMerchantId = 'merchant_service_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const createTestCase = (suffix: string): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId: verifiedMerchantId,
      caseKey: `v1_test_case_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_${suffix}`,
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
      notes: 'Investigation service orchestration test',
    },
    evidenceItems: [
      {
        merchantId: verifiedMerchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_${suffix}`,
        payloadSnapshot: { orderId: `ORD-${suffix}`, amountMinor: 10000 },
        contentHash: `hash-order-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
      {
        merchantId: verifiedMerchantId,
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: `TXN-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_${suffix}`,
        payloadSnapshot: { transactionId: `TXN-${suffix}`, feeMinor: 325 },
        contentHash: `hash-txn-${suffix}`.padStart(64, '0'),
        isObservedFact: true,
      },
    ],
  });

  it('orchestrates read-only investigation end-to-end and persists COMPLETED audit record', async () => {
    const persisted = await persistExceptionCases(undefined, [createTestCase('orch_success')]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient();
    const result = await investigateCase(caseId, verifiedMerchantId, {
      providerOverride: mockProvider,
    });

    expect(result.investigationId).toBeDefined();
    expect(result.caseId).toBe(caseId);
    expect(result.merchantId).toBe(verifiedMerchantId);
    expect(result.caseVersion).toBe(1);
    expect(result.provider).toBe('mock');
    expect(result.investigation.summary.primaryDiscrepancyCategory).toBe('FEE_VARIANCE');
    expect(result.investigation.establishedFacts.length).toBeGreaterThan(0);

    // Verify audit log row in case_investigations
    const latest = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe('COMPLETED');
    expect(latest?.investigationResult?.schemaVersion).toBe('1.0');

    // Strict Read-Only Verification: Check that exception_case was NOT mutated
    const currentCase = await findCaseById(undefined, caseId, verifiedMerchantId);
    expect(currentCase).not.toBeNull();
    expect(currentCase?.status).toBe('OPEN');
    expect(currentCase?.version).toBe(1);
    expect(currentCase?.varianceAmount.amountMinor).toBe(35);
    expect(currentCase?.expectedAmount.amountMinor).toBe(290);
    expect(currentCase?.actualAmount.amountMinor).toBe(325);
  });

  it('persists FAILED audit record when provider encounters timeout', async () => {
    const persisted = await persistExceptionCases(undefined, [createTestCase('orch_timeout')]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient({ simulateTimeout: true });

    await expect(
      investigateCase(caseId, verifiedMerchantId, { providerOverride: mockProvider })
    ).rejects.toThrow(AIProviderError);

    // Verify FAILED record logged in case_investigations
    const latest = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe('FAILED');
    expect(latest?.safeErrorCode).toBe('PROVIDER_TIMEOUT');
    expect(latest?.safeErrorMessage).toContain('timed out');
  });

  it('persists FAILED audit record when provider returns ungrounded hallucinated citations', async () => {
    const persisted = await persistExceptionCases(undefined, [createTestCase('orch_hallucinate')]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient({ simulateHallucinatedCitation: true });

    await expect(
      investigateCase(caseId, verifiedMerchantId, { providerOverride: mockProvider })
    ).rejects.toThrow(GroundingValidationError);

    // Verify FAILED record logged in case_investigations
    const latest = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe('FAILED');
    expect(latest?.safeErrorCode).toBe('GROUNDING_VALIDATION_FAILED');
  });

  it('records multiple investigations as append-only audit trail', async () => {
    const persisted = await persistExceptionCases(undefined, [createTestCase('orch_append_only')]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient();

    // Run first investigation
    const res1 = await investigateCase(caseId, verifiedMerchantId, {
      providerOverride: mockProvider,
    });

    // Run second investigation
    const res2 = await investigateCase(caseId, verifiedMerchantId, {
      providerOverride: mockProvider,
    });

    expect(res1.investigationId).not.toBe(res2.investigationId);

    const history = await listInvestigationsByCaseId(undefined, caseId, verifiedMerchantId);
    expect(history.length).toBe(2);
    // Ordered descending by created_at
    expect(history[0].id).toBe(res2.investigationId);
    expect(history[1].id).toBe(res1.investigationId);
  });

  it('F-35: detects case evolution during model execution and flags result as STALE_SNAPSHOT', async () => {
    const originalCase = createTestCase('stale_test');
    const persisted = await persistExceptionCases(undefined, [originalCase]);
    const caseId = persisted.caseIds[0];

    // Create a mock provider that mutates the case to version 2 while the investigation is in-flight
    const evolvingMockProvider: AIProviderClient = {
      providerName: 'mock-evolving',
      modelName: 'mock-v1',
      async investigate(req: AIProviderRequest) {
        // While model is thinking, another process re-observes and updates the case to version 2
        const updatedObservation = {
          ...originalCase,
          caseRecord: {
            ...originalCase.caseRecord,
            varianceAmountMinor: 50, // Updated variance
          },
        };
        await persistExceptionCases(undefined, [updatedObservation]);

        // Standard mock response
        const baseMock = new MockAIProviderClient();
        return baseMock.investigate(req);
      },
    };

    const result = await investigateCase(caseId, verifiedMerchantId, {
      providerOverride: evolvingMockProvider,
    });

    // 1. Returned result must be explicitly identified as stale
    expect(result.isStale).toBe(true);
    expect(result.caseVersion).toBe(1); // Reflects the analyzed snapshot version
    expect(result.snapshotMetadata).toBeDefined();
    expect(result.snapshotMetadata?.analyzedVersion).toBe(1);
    expect(result.snapshotMetadata?.currentVersion).toBe(2);

    // 2. Persisted record in database must have STALE_SNAPSHOT status and is_stale: true
    const latest = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(latest).not.toBeNull();
    expect(latest?.status).toBe('STALE_SNAPSHOT');
    expect(latest?.isStale).toBe(true);
  });

  it('F-35: dynamically reports staleness on read when parent case advances after investigation was persisted', async () => {
    const testCase = createTestCase('dynamic_stale');
    const persisted = await persistExceptionCases(undefined, [testCase]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient();
    const result = await investigateCase(caseId, verifiedMerchantId, { providerOverride: mockProvider });
    expect(result.isStale).toBe(false);

    // Initial read is fresh
    const initialRead = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(initialRead?.isStale).toBe(false);
    expect(initialRead?.status).toBe('COMPLETED');

    // Case advances to version 2 later
    const updatedCase = {
      ...testCase,
      caseRecord: {
        ...testCase.caseRecord,
        varianceAmountMinor: 99,
      },
    };
    await persistExceptionCases(undefined, [updatedCase]);

    // Subsequent read dynamically evaluates staleness against liveCaseVersion
    const updatedRead = await findLatestInvestigationByCaseId(undefined, caseId, verifiedMerchantId);
    expect(updatedRead).not.toBeNull();
    expect(updatedRead?.isStale).toBe(true);
    expect(updatedRead?.status).toBe('STALE_SNAPSHOT');
    expect(updatedRead?.caseVersion).toBe(1); // Original historical snapshot preserved
    expect(updatedRead?.snapshotMetadata?.currentVersion).toBe(2);

    // Historical list also reflects dynamic staleness
    const history = await listInvestigationsByCaseId(undefined, caseId, verifiedMerchantId);
    expect(history.length).toBe(1);
    expect(history[0].isStale).toBe(true);
    expect(history[0].status).toBe('STALE_SNAPSHOT');
    expect(updatedRead?.isStale).toBe(true);
    expect(updatedRead?.snapshotMetadata?.analyzedVersion).toBe(1);
    expect(updatedRead?.snapshotMetadata?.currentVersion).toBe(2);

    // 3. Strict Read-Only Verification: Original case status remains untouched
    const currentCase = await findCaseById(undefined, caseId, verifiedMerchantId);
    expect(currentCase?.status).toBe('OPEN');
    expect(currentCase?.version).toBe(2);
  });
});
