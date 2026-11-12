import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from '@/lib/db/testHarness';
import {
  persistExceptionCases,
  findCaseById,
  listCases,
  transitionCaseStatus,
} from '../repository';
import { ExtractedCaseWithEvidence } from '../types';
import { InvalidStatusTransitionError, VersionConflictError } from '../lifecycle';

describe('Phase 3D.1: Exception Cases & Evidence Repository Suite (Hardened per F-24, F-26, F-30)', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await teardownTestDatabase();
  });

  const sampleCaseWithEvidence: ExtractedCaseWithEvidence = {
    caseRecord: {
      merchantId: 'tenant_acme',
      caseKey: 'v1_1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
      reconciliationRunId: 'run-100',
      discrepancyType: 'FEE_VARIANCE',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 35,
      expectedAmountMinor: 290,
      actualAmountMinor: 325,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: 'ORD-1001',
      merchantOrderId: 'ORD-1001',
      paypalTransactionId: '9XY111',
      notes: 'Fee variance of 35 minor units detected.',
    },
    evidenceItems: [
      {
        merchantId: 'tenant_acme',
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: 'ORD-1001',
        sourceTransactionId: null,
        reconciliationRunId: 'run-100',
        payloadSnapshot: { orderId: 'ORD-1001', amount: 10000 },
        contentHash: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
        isObservedFact: true,
      },
      {
        merchantId: 'tenant_acme',
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: '9XY111',
        sourceTransactionId: null,
        reconciliationRunId: 'run-100',
        payloadSnapshot: { paypalTransactionId: '9XY111', fee: 325 },
        contentHash: 'b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef01',
        isObservedFact: true,
      },
    ],
  };

  describe('Transactional Persistence, Idempotency & Historical Integrity (F-26)', () => {
    it('persists a new exception case, setting initial_variance_amount_minor permanently', async () => {
      const result = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);

      expect(result.casesCreated).toBe(1);
      expect(result.casesUpdated).toBe(0);
      expect(result.caseIds).toHaveLength(1);
      expect(result.evidenceItemsInserted).toBe(2);

      const caseId = result.caseIds[0];
      const detail = await findCaseById(undefined, caseId, 'tenant_acme');

      expect(detail).not.toBeNull();
      expect(detail?.id).toBe(caseId);
      expect(detail?.version).toBe(1);
      expect(detail?.varianceAmount.amountMinor).toBe(35);
      expect(detail?.evidenceCount).toBe(2);
    });

    it('handles identical re-observations idempotently without version bump or duplicate evidence', async () => {
      // First observation
      const firstRun = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = firstRun.caseIds[0];

      // Second identical observation (same amounts)
      const secondRun = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      expect(secondRun.casesCreated).toBe(0);
      expect(secondRun.casesUpdated).toBe(1);
      expect(secondRun.caseIds[0]).toBe(caseId);
      expect(secondRun.evidenceItemsInserted).toBe(0); // Zero duplicate evidence items

      // Case version remains 1
      const detail = await findCaseById(undefined, caseId, 'tenant_acme');
      expect(detail?.version).toBe(1);
      expect(detail?.evidenceCount).toBe(2);
    });

    it('handles material financial changes across runs by atomically incrementing version and appending snapshot evidence (F-26)', async () => {
      // 1. Initial observation: Variance is 35
      const firstRun = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = firstRun.caseIds[0];

      // 2. Material change: Subsequent run observes updated variance of 50
      const updatedRunCase: ExtractedCaseWithEvidence = {
        ...sampleCaseWithEvidence,
        caseRecord: {
          ...sampleCaseWithEvidence.caseRecord,
          reconciliationRunId: 'run-101-updated',
          varianceAmountMinor: 50, // Material change: 35 -> 50
          actualAmountMinor: 340,
        },
        evidenceItems: [],
      };

      const secondRun = await persistExceptionCases(undefined, [updatedRunCase]);
      expect(secondRun.casesCreated).toBe(0);
      expect(secondRun.casesUpdated).toBe(1);
      expect(secondRun.caseIds[0]).toBe(caseId);

      // Verify case state in database
      const detail = await findCaseById(undefined, caseId, 'tenant_acme');
      expect(detail?.version).toBe(2); // Atomically incremented
      expect(detail?.varianceAmount.amountMinor).toBe(50); // Updated to latest
      expect(detail?.evidenceCount).toBe(3); // 2 initial + 1 material change snapshot

      const snapshotEvidence = detail?.evidence.find((e) =>
        e.sourceRecordId.includes('_v2')
      );
      expect(snapshotEvidence).toBeDefined();
      expect(snapshotEvidence?.payloadSnapshot.event).toBe('MATERIAL_FINANCIAL_OBSERVATION_UPDATED');
      expect(snapshotEvidence?.payloadSnapshot.priorVarianceMinor).toBe(35);
      expect(snapshotEvidence?.payloadSnapshot.newVarianceMinor).toBe(50);
    });
  });

  describe('Lifecycle State Machine Transitions (F-30)', () => {
    it('executes valid sequential status transitions atomically (OPEN -> INVESTIGATING -> PENDING_APPROVAL -> RESOLVED)', async () => {
      const res = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = res.caseIds[0];

      // 1. Transition OPEN -> INVESTIGATING
      const step1 = await transitionCaseStatus(
        undefined,
        caseId,
        'tenant_acme',
        'INVESTIGATING',
        'AI investigation triggered'
      );
      expect(step1.status).toBe('INVESTIGATING');
      expect(step1.version).toBe(2);

      // 2. Transition INVESTIGATING -> PENDING_APPROVAL
      const step2 = await transitionCaseStatus(
        undefined,
        caseId,
        'tenant_acme',
        'PENDING_APPROVAL',
        'Recommendation formulated'
      );
      expect(step2.status).toBe('PENDING_APPROVAL');
      expect(step2.version).toBe(3);

      // 3. Transition PENDING_APPROVAL -> RESOLVED
      const step3 = await transitionCaseStatus(
        undefined,
        caseId,
        'tenant_acme',
        'RESOLVED',
        'Operator approved action'
      );
      expect(step3.status).toBe('RESOLVED');
      expect(step3.version).toBe(4);
      expect(step3.notes).toContain('[RESOLVED_OPERATIONAL]');
      expect(step3.notes).toContain('Administrative resolution; no automated financial ledger movement');
    });

    it('enforces optimistic concurrency control with expectedVersion and rejects stale updates', async () => {
      const res = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = res.caseIds[0];

      // Initial version is 1. Transition with correct expectedVersion succeeds
      const step1 = await transitionCaseStatus(
        undefined,
        caseId,
        'tenant_acme',
        'INVESTIGATING',
        'Starting investigation',
        1 // expectedVersion
      );
      expect(step1.version).toBe(2);

      // Attempting next transition with stale expectedVersion (1 instead of 2) throws VersionConflictError
      await expect(
        transitionCaseStatus(
          undefined,
          caseId,
          'tenant_acme',
          'PENDING_APPROVAL',
          'Recommendation formulated',
          1 // Stale expectedVersion
        )
      ).rejects.toThrow(VersionConflictError);

      // Providing correct expectedVersion (2) succeeds
      const step2 = await transitionCaseStatus(
        undefined,
        caseId,
        'tenant_acme',
        'PENDING_APPROVAL',
        'Recommendation formulated',
        2 // Current expectedVersion
      );
      expect(step2.version).toBe(3);
    });

    it('rejects unauthorized or invalid status jumps with InvalidStatusTransitionError (e.g. OPEN -> RESOLVED)', async () => {
      const res = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = res.caseIds[0];

      // Attempting to jump directly from OPEN to RESOLVED bypasses investigation/approval
      await expect(
        transitionCaseStatus(undefined, caseId, 'tenant_acme', 'RESOLVED')
      ).rejects.toThrow(InvalidStatusTransitionError);

      // Verify case status remains safely OPEN
      const detail = await findCaseById(undefined, caseId, 'tenant_acme');
      expect(detail?.status).toBe('OPEN');
    });

    it('prohibits mutating a terminal CLOSED_DISMISSED case', async () => {
      const res = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = res.caseIds[0];

      // Dismiss case (terminal closure)
      await transitionCaseStatus(undefined, caseId, 'tenant_acme', 'CLOSED_DISMISSED', 'Non-actionable variance');

      // Attempting to reopen or change terminal case fails
      await expect(
        transitionCaseStatus(undefined, caseId, 'tenant_acme', 'INVESTIGATING')
      ).rejects.toThrow(InvalidStatusTransitionError);
    });
  });

  describe('Tenant Boundary Isolation (F-23, F-24)', () => {
    it('rejects cross-tenant access and returns null without leaking case existence', async () => {
      const res = await persistExceptionCases(undefined, [sampleCaseWithEvidence]);
      const caseId = res.caseIds[0];

      // Accessing with correct tenant succeeds
      const acmeCase = await findCaseById(undefined, caseId, 'tenant_acme');
      expect(acmeCase).not.toBeNull();

      // Accessing same caseId under another tenant returns null (404-equivalent)
      const rivalCase = await findCaseById(undefined, caseId, 'tenant_rival');
      expect(rivalCase).toBeNull();
    });

    it('scopes listCases strictly to the requesting tenant', async () => {
      const rivalCaseWithEvidence: ExtractedCaseWithEvidence = {
        ...sampleCaseWithEvidence,
        caseRecord: {
          ...sampleCaseWithEvidence.caseRecord,
          merchantId: 'tenant_rival',
          caseKey: 'v1_9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff',
        },
        evidenceItems: [],
      };

      await persistExceptionCases(undefined, [sampleCaseWithEvidence, rivalCaseWithEvidence]);

      const acmeList = await listCases(undefined, { merchantId: 'tenant_acme' });
      expect(acmeList.total).toBe(1);
      expect(acmeList.cases[0].merchantId).toBe('tenant_acme');

      const rivalList = await listCases(undefined, { merchantId: 'tenant_rival' });
      expect(rivalList.total).toBe(1);
      expect(rivalList.cases[0].merchantId).toBe('tenant_rival');
    });
  });
});
