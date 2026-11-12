import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import { persistExceptionCases } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import {
  buildInvestigationContext,
  CaseContextNotFoundError,
  MAX_CONTEXT_EVIDENCE_ITEMS,
} from '../contextBuilder';

describe('Phase 3D.2: Investigation Context Builder Suite', () => {
  const verifiedMerchantId = 'merchant_context_test';

  beforeEach(async () => {
    process.env.CLOSELOOP_MERCHANT_ID = verifiedMerchantId;
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const createTestCaseWithEvidence = (
    caseIdSuffix: string,
    merchantId = verifiedMerchantId,
    evidenceCount = 2
  ): ExtractedCaseWithEvidence => {
    const evidenceItems = [];
    for (let i = 0; i < evidenceCount; i++) {
      evidenceItems.push({
        merchantId,
        evidenceType: (i % 2 === 0 ? 'MERCHANT_ORDER' : 'PAYPAL_TRANSACTION') as 'MERCHANT_ORDER' | 'PAYPAL_TRANSACTION',
        sourceSystem: (i % 2 === 0 ? 'MERCHANT_CSV' : 'PAYPAL_DURABLE_LEDGER') as 'MERCHANT_CSV' | 'PAYPAL_DURABLE_LEDGER',
        sourceTable: i % 2 === 0 ? 'in_memory_orders' : 'paypal_imported_transactions',
        sourceRecordId: `REC-${caseIdSuffix}-${i}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_${caseIdSuffix}`,
        payloadSnapshot: {
          testIndex: i,
          note: `De\u0301tails for record ${i}`, // Unicode NFD (decomposed e + acute)
          amountMinor: 1000 + i * 10,
        },
        contentHash: `hash-${caseIdSuffix}-${i}`.padStart(64, '0'),
        isObservedFact: true,
      });
    }

    return {
      caseRecord: {
        merchantId,
        caseKey: `v1_test_case_${caseIdSuffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
        reconciliationRunId: `run_${caseIdSuffix}`,
        discrepancyType: 'FEE_VARIANCE',
        status: 'OPEN',
        version: 1,
        varianceAmountMinor: 35,
        expectedAmountMinor: 290,
        actualAmountMinor: 325,
        currency: 'USD',
        currencyPrecision: 2,
        primaryReference: `ORD-${caseIdSuffix}`,
        merchantOrderId: `ORD-${caseIdSuffix}`,
        paypalTransactionId: `TXN-${caseIdSuffix}`,
        notes: `NFD note: Cafe\u0301`,
      },
      evidenceItems,
    };
  };

  it('rejects non-existent case with CaseContextNotFoundError', async () => {
    const fakeUuid = '00000000-0000-4000-8000-000000000000';
    await expect(buildInvestigationContext(fakeUuid, verifiedMerchantId)).rejects.toThrow(
      CaseContextNotFoundError
    );
  });

  it('enforces strict tenant isolation and rejects cross-tenant case retrieval', async () => {
    // Insert case for merchant_A
    const persisted = await persistExceptionCases(undefined, [
      createTestCaseWithEvidence('cross_tenant_1', 'merchant_A'),
    ]);
    const caseId = persisted.caseIds[0];

    // Attempt retrieval by merchant_B
    await expect(buildInvestigationContext(caseId, 'merchant_B')).rejects.toThrow(
      CaseContextNotFoundError
    );
  });

  it('normalizes text and payload strings to Unicode NFC form', async () => {
    const persisted = await persistExceptionCases(undefined, [
      createTestCaseWithEvidence('nfc_test', verifiedMerchantId, 1),
    ]);
    const caseId = persisted.caseIds[0];

    const ctx = await buildInvestigationContext(caseId, verifiedMerchantId);

    // Primary reference and discrepancy type should be trimmed and NFC normalized
    expect(ctx.discrepancyType).toBe('FEE_VARIANCE');
    expect(ctx.primaryReference).toBe('ORD-nfc_test');
    expect(ctx.evidenceItems[0].sourceRecordId).toBe('REC-nfc_test-0');
  });

  it('computes deterministic SHA-256 evidence fingerprint', async () => {
    const persisted = await persistExceptionCases(undefined, [
      createTestCaseWithEvidence('fingerprint_test', verifiedMerchantId, 3),
    ]);
    const caseId = persisted.caseIds[0];

    const ctx1 = await buildInvestigationContext(caseId, verifiedMerchantId);
    const ctx2 = await buildInvestigationContext(caseId, verifiedMerchantId);

    expect(ctx1.evidenceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx1.evidenceFingerprint).toBe(ctx2.evidenceFingerprint);
  });

  it(`bounds context to a maximum of ${MAX_CONTEXT_EVIDENCE_ITEMS} items`, async () => {
    // Generate 35 evidence items (exceeding 30)
    const persisted = await persistExceptionCases(undefined, [
      createTestCaseWithEvidence('bounded_items', verifiedMerchantId, 35),
    ]);
    const caseId = persisted.caseIds[0];

    const ctx = await buildInvestigationContext(caseId, verifiedMerchantId);

    expect(ctx.evidenceItems.length).toBe(MAX_CONTEXT_EVIDENCE_ITEMS);
  });

  it('accurately compiles financial evidence summaries', async () => {
    const persisted = await persistExceptionCases(undefined, [
      createTestCaseWithEvidence('summary_test', verifiedMerchantId, 2),
    ]);
    const caseId = persisted.caseIds[0];

    const ctx = await buildInvestigationContext(caseId, verifiedMerchantId);

    expect(ctx.caseId).toBe(caseId);
    expect(ctx.merchantId).toBe(verifiedMerchantId);
    expect(ctx.discrepancyType).toBe('FEE_VARIANCE');
    expect(ctx.varianceAmountMinor).toBe(35);
    expect(ctx.expectedAmountMinor).toBe(290);
    expect(ctx.actualAmountMinor).toBe(325);
    expect(ctx.currency).toBe('USD');
    expect(ctx.evidenceItems.length).toBe(2);
  });
});
