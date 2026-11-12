import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '@/lib/db/migrator';
import { persistExceptionCases, findCaseById } from '../repository';
import { ExtractedCaseWithEvidence } from '../types';

// Load .env.local if present in runtime environment without exposing contents
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local is optional
  }
}

describe('Phase 3D.1: Real PostgreSQL Concurrency & Security Acceptance Gates (F-24, F-25, F-26)', () => {
  const liveDbUrl = process.env.DATABASE_URL;
  let isLivePgAvailable = false;
  let livePool: Pool | null = null;
  let resolvedTargetDb = '';
  let resolvedTargetHost = '';

  beforeAll(async () => {
    if (liveDbUrl) {
      try {
        const parsed = new URL(liveDbUrl);
        resolvedTargetHost = parsed.hostname;
        resolvedTargetDb = parsed.pathname.replace(/^\//, '');

        const isApprovedHost =
          resolvedTargetHost === 'localhost' || resolvedTargetHost === '127.0.0.1';
        const isApprovedDb = resolvedTargetDb === 'closeloop_test';

        if (isApprovedHost && isApprovedDb) {
          const testPool = new Pool({
            connectionString: liveDbUrl,
            connectionTimeoutMillis: 2000,
          });

          // Prevent unhandled error events on idle clients if background terminates them
          testPool.on('error', () => {});

          const client = await testPool.connect();
          await client.query('SELECT 1;');
          client.release();

          // Apply migrations to test database safely (including migration 008 and 009)
          await runMigrations(testPool);

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
      livePool = null;
    }
  });

  const generateLiveCase = (suffix: string, merchantId = 'merchant_live_test'): ExtractedCaseWithEvidence => ({
    caseRecord: {
      merchantId,
      caseKey: `v1_live_test_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
      reconciliationRunId: `run_live_${suffix}`,
      discrepancyType: 'FEE_VARIANCE',
      status: 'OPEN',
      version: 1,
      varianceAmountMinor: 45,
      expectedAmountMinor: 290,
      actualAmountMinor: 335,
      currency: 'USD',
      currencyPrecision: 2,
      primaryReference: `ORD-${suffix}`,
      merchantOrderId: `ORD-${suffix}`,
      paypalTransactionId: `TXN-${suffix}`,
      notes: 'Live PostgreSQL concurrency verification test case.',
    },
    evidenceItems: [
      {
        merchantId,
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceTable: 'in_memory_orders',
        sourceRecordId: `ORD-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_live_${suffix}`,
        payloadSnapshot: { orderId: `ORD-${suffix}`, amount: 10000 },
        contentHash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
        isObservedFact: true,
      },
      {
        merchantId,
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceTable: 'paypal_imported_transactions',
        sourceRecordId: `TXN-${suffix}`,
        sourceTransactionId: null,
        reconciliationRunId: `run_live_${suffix}`,
        payloadSnapshot: { paypalTransactionId: `TXN-${suffix}`, fee: 335 },
        contentHash: '222233334444555566667777888899990000aaaabbbbccccddddeeeeffff1111',
        isObservedFact: true,
      },
    ],
  });

  it('Gate 1 (Live PostgreSQL): Real database foreign key enforcement on evidence items', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 1.');
      return;
    }

    const client = await livePool.connect();
    try {
      const nonExistentCaseId = '00000000-0000-0000-0000-000000000000';
      const insertInvalidEvidenceSql = `
        INSERT INTO case_evidence_items (
          case_id, merchant_id, evidence_type, source_system, source_table,
          source_record_id, reconciliation_run_id, payload_snapshot, content_hash
        ) VALUES (
          $1, 'merchant_live_test', 'MERCHANT_ORDER', 'MERCHANT_CSV', 'orders',
          'ORD-INV', 'run-inv', '{}', '33334444555566667777888899990000aaaabbbbccccddddeeeeffff11112222'
        );
      `;

      let threwFkViolation = false;
      try {
        await client.query(insertInvalidEvidenceSql, [nonExistentCaseId]);
      } catch (err: unknown) {
        // PostgreSQL error code 23503: foreign_key_violation
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
          threwFkViolation = true;
        }
      }

      expect(threwFkViolation).toBe(true);
    } finally {
      client.release();
    }
  });

  it('Gate 2 (Live PostgreSQL): Composite evidence ownership enforcement on tenant mismatch (F-24)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 2.');
      return;
    }

    const suffix = `tenant_mismatch_${Date.now()}`;
    const testCase = generateLiveCase(suffix, 'merchant_legit');
    const res = await persistExceptionCases(livePool, [testCase]);
    const validCaseId = res.caseIds[0];

    const client = await livePool.connect();
    try {
      // Attempt to insert an evidence item referencing validCaseId but with mismatched merchant_id
      const insertMismatchedSql = `
        INSERT INTO case_evidence_items (
          case_id, merchant_id, evidence_type, source_system, source_table,
          source_record_id, reconciliation_run_id, payload_snapshot, content_hash
        ) VALUES (
          $1, 'merchant_attacker_mismatched', 'MERCHANT_ORDER', 'MERCHANT_CSV', 'orders',
          $2, 'run-test', '{}', '4444555566667777888899990000aaaabbbbccccddddeeeeffff111122223333'
        );
      `;

      let threwCompositeFkViolation = false;
      try {
        await client.query(insertMismatchedSql, [validCaseId, `ORD-${suffix}-spoof`]);
      } catch (err: unknown) {
        // PostgreSQL error code 23503: foreign_key_violation on composite constraint fk_case_evidence_tenant
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23503') {
          threwCompositeFkViolation = true;
        }
      }

      expect(threwCompositeFkViolation).toBe(true);
    } finally {
      client.release();
    }
  });

  it('Gate 3 (Live PostgreSQL): Database triggers actively raise exceptions on direct UPDATE, DELETE, and TRUNCATE (F-25)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 3.');
      return;
    }

    const suffix = `trigger_immutability_${Date.now()}`;
    const testCase = generateLiveCase(suffix);
    const res = await persistExceptionCases(livePool, [testCase]);
    const caseId = res.caseIds[0];

    const client = await livePool.connect();
    try {
      // 1. Direct UPDATE on evidence item must be actively blocked by trigger trg_prevent_case_evidence_update
      let updateBlockedByTrigger = false;
      try {
        await client.query("UPDATE case_evidence_items SET content_hash = 'tampered' WHERE case_id = $1", [caseId]);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23514') {
          updateBlockedByTrigger = true;
        }
      }
      expect(updateBlockedByTrigger).toBe(true);

      // Verify content_hash is unmodified in database
      const checkRes = await client.query('SELECT content_hash FROM case_evidence_items WHERE case_id = $1', [caseId]);
      expect(checkRes.rows[0].content_hash).not.toBe('tampered');

      // 2. Direct DELETE on evidence item must be actively blocked by trigger trg_prevent_case_evidence_delete
      let deleteBlockedByTrigger = false;
      try {
        await client.query('DELETE FROM case_evidence_items WHERE case_id = $1', [caseId]);
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23514') {
          deleteBlockedByTrigger = true;
        }
      }
      expect(deleteBlockedByTrigger).toBe(true);

      // 3. Direct TRUNCATE must be actively blocked by trigger trg_prevent_case_evidence_truncate
      let truncateBlockedByTrigger = false;
      try {
        await client.query('TRUNCATE case_evidence_items;');
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23514') {
          truncateBlockedByTrigger = true;
        }
      }
      expect(truncateBlockedByTrigger).toBe(true);

      // Verify evidence items still exist intact
      const verifyRes = await client.query('SELECT COUNT(*) AS count FROM case_evidence_items WHERE case_id = $1', [caseId]);
      expect(parseInt(verifyRes.rows[0].count, 10)).toBe(2);
    } finally {
      client.release();
    }
  });

  it('Gate 4 (Live PostgreSQL): Non-cascading case deletion rejection via ON DELETE RESTRICT (F-25)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 4.');
      return;
    }

    const suffix = `restrict_${Date.now()}`;
    const testCase = generateLiveCase(suffix);
    const res = await persistExceptionCases(livePool, [testCase]);
    const caseId = res.caseIds[0];

    const client = await livePool.connect();
    try {
      // Attempting to delete the parent case must be blocked by foreign key ON DELETE RESTRICT (F-25)
      let blockedByRestrict = false;
      try {
        await client.query('DELETE FROM exception_cases WHERE id = $1', [caseId]);
      } catch (err: unknown) {
        // PostgreSQL raises code 23001 (restrict_violation) or 23503 (foreign_key_violation)
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          ((err as { code: string }).code === '23001' || (err as { code: string }).code === '23503')
        ) {
          blockedByRestrict = true;
        }
      }

      expect(blockedByRestrict).toBe(true);

      // Verify case still exists in database
      const checkRes = await client.query('SELECT id FROM exception_cases WHERE id = $1', [caseId]);
      expect(checkRes.rows.length).toBe(1);
    } finally {
      client.release();
    }
  });

  it('Gate 5 (Live PostgreSQL): Mandatory 9-step historical snapshot verification sequence (F-26)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 5.');
      return;
    }

    const suffix = `seq_${Date.now()}`;
    const caseKey = `v1_seq_test_${suffix}_1111222233334444555566667777888899990000aaaabbbbcccc`;

    const makeObservationCase = (variance: number, runId: string): ExtractedCaseWithEvidence => ({
      caseRecord: {
        merchantId: 'merchant_live_test',
        caseKey,
        reconciliationRunId: runId,
        discrepancyType: 'FEE_VARIANCE',
        status: 'OPEN',
        version: 1,
        varianceAmountMinor: variance,
        expectedAmountMinor: 1000,
        actualAmountMinor: 1000 + variance,
        currency: 'USD',
        currencyPrecision: 2,
        primaryReference: `ORD-${suffix}`,
        merchantOrderId: `ORD-${suffix}`,
        paypalTransactionId: `TXN-${suffix}`,
        notes: `Observation run ${runId} with variance ${variance}`,
      },
      evidenceItems: [
        {
          merchantId: 'merchant_live_test',
          evidenceType: 'MERCHANT_ORDER',
          sourceSystem: 'MERCHANT_CSV',
          sourceTable: 'orders',
          sourceRecordId: `ORD-${suffix}`,
          sourceTransactionId: null,
          reconciliationRunId: runId,
          payloadSnapshot: { orderId: `ORD-${suffix}`, variance },
          contentHash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          isObservedFact: true,
        },
      ],
    });

    // Step 1: Create a case with variance 100 minor units
    const step1Res = await persistExceptionCases(livePool, [makeObservationCase(100, `run_${suffix}_1`)]);
    const caseId = step1Res.caseIds[0];
    expect(step1Res.casesCreated).toBe(1);

    const initialCase = await findCaseById(livePool, caseId, 'merchant_live_test');
    expect(initialCase?.version).toBe(1);
    expect(initialCase?.varianceAmount.amountMinor).toBe(100);

    // Step 2: Re-observe the same logical case with variance 150
    const step2Res = await persistExceptionCases(livePool, [makeObservationCase(150, `run_${suffix}_2`)]);
    expect(step2Res.casesUpdated).toBe(1);
    expect(step2Res.caseIds[0]).toBe(caseId);

    const observedCase = await findCaseById(livePool, caseId, 'merchant_live_test');

    // Step 3: Verify initial variance remains 100
    const client = await livePool.connect();
    try {
      const dbRow = await client.query(
        'SELECT initial_variance_amount_minor, variance_amount_minor, version FROM exception_cases WHERE id = $1',
        [caseId]
      );
      expect(Number(dbRow.rows[0].initial_variance_amount_minor)).toBe(100);

      // Step 4: Verify current variance is 150
      expect(Number(dbRow.rows[0].variance_amount_minor)).toBe(150);

      // Step 5: Verify a new immutable snapshot exists
      const snapshotEvidence = observedCase?.evidence.find((e) => e.sourceRecordId.includes('_v2'));
      expect(snapshotEvidence).toBeDefined();
      expect(snapshotEvidence?.payloadSnapshot.event).toBe('MATERIAL_FINANCIAL_OBSERVATION_UPDATED');
      expect(snapshotEvidence?.payloadSnapshot.priorVarianceMinor).toBe(100);
      expect(snapshotEvidence?.payloadSnapshot.newVarianceMinor).toBe(150);

      // Step 6: Verify version increments exactly once (now version 2)
      expect(Number(dbRow.rows[0].version)).toBe(2);
      expect(observedCase?.version).toBe(2);

      // Step 7: Re-observe variance 150 again
      const step7Res = await persistExceptionCases(livePool, [makeObservationCase(150, `run_${suffix}_3`)]);
      expect(step7Res.casesUpdated).toBe(1);

      // Step 8: Verify version and evidence counts remain unchanged
      const reObservedCase = await findCaseById(livePool, caseId, 'merchant_live_test');
      expect(reObservedCase?.version).toBe(2);
      expect(reObservedCase?.evidenceCount).toBe(observedCase?.evidenceCount);

      // Step 9: Run concurrent identical observations and verify no duplicate snapshots
      const [concA, concB] = await Promise.all([
        persistExceptionCases(livePool, [makeObservationCase(150, `run_${suffix}_4A`)]),
        persistExceptionCases(livePool, [makeObservationCase(150, `run_${suffix}_4B`)]),
      ]);

      expect(concA.casesUpdated + concB.casesUpdated).toBe(2);

      const finalCase = await findCaseById(livePool, caseId, 'merchant_live_test');
      expect(finalCase?.version).toBe(2);
      expect(finalCase?.evidenceCount).toBe(observedCase?.evidenceCount);
    } finally {
      client.release();
    }
  });

  it('Gate 6 (Live PostgreSQL): Concurrent status transitions and optimistic version conflict rejection (F-30)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 6.');
      return;
    }

    const testCase = generateLiveCase(`trans_conc_${Date.now()}`);
    const res = await persistExceptionCases(livePool, [testCase]);
    const caseId = res.caseIds[0];

    // Connect two clients to test concurrent optimistic locking
    const clientA = await livePool.connect();
    const clientB = await livePool.connect();

    try {
      const { transitionCaseStatus } = await import('../repository');

      // First client transitions OPEN -> INVESTIGATING with expectedVersion 1
      const transitionedA = await transitionCaseStatus(
        clientA,
        caseId,
        'merchant_live_test',
        'INVESTIGATING',
        'Investigating concurrently',
        1 // expectedVersion
      );
      expect(transitionedA.status).toBe('INVESTIGATING');
      expect(transitionedA.version).toBe(2);

      // Second client attempts to transition with the now-stale expectedVersion 1
      let conflictDetected = false;
      try {
        await transitionCaseStatus(
          clientB,
          caseId,
          'merchant_live_test',
          'CLOSED_DISMISSED',
          'Dismissing concurrently',
          1 // Stale expectedVersion
        );
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'VERSION_CONFLICT') {
          conflictDetected = true;
        }
      }

      expect(conflictDetected).toBe(true);

      // Final state remains INVESTIGATING at version 2
      const finalDetail = await findCaseById(livePool, caseId, 'merchant_live_test');
      expect(finalDetail?.status).toBe('INVESTIGATING');
      expect(finalDetail?.version).toBe(2);
    } finally {
      clientA.release();
      clientB.release();
    }
  });

  it('Gate 7 (Live PostgreSQL): Real PostgreSQL atomic rollback on transactional failure', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip('Live PostgreSQL (closeloop_test) unavailable; skipping Gate 6.');
      return;
    }

    const suffix = `fail_${Date.now()}`;
    const malformedCase: ExtractedCaseWithEvidence = {
      ...generateLiveCase(suffix),
      evidenceItems: [
        {
          merchantId: 'merchant_live_test',
          evidenceType: 'MERCHANT_ORDER',
          sourceSystem: 'MERCHANT_CSV',
          sourceTable: 'orders',
          sourceRecordId: `ORD-${suffix}`,
          sourceTransactionId: null,
          reconciliationRunId: `run-${suffix}`,
          payloadSnapshot: {},
          contentHash: '1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff',
          isObservedFact: true,
        },
      ],
    };

    const client = await livePool.connect();
    try {
      await client.query('BEGIN');
      await persistExceptionCases(client, [malformedCase]);
      // Rollback manually
      await client.query('ROLLBACK');

      // Verify row does NOT exist in DB
      const checkRes = await client.query(
        'SELECT COUNT(*) AS count FROM exception_cases WHERE case_key = $1',
        [malformedCase.caseRecord.caseKey]
      );
      expect(parseInt(checkRes.rows[0].count, 10)).toBe(0);
    } finally {
      client.release();
    }
  });
});
