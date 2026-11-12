import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { runMigrations } from '@/lib/db/migrator';
import { persistExceptionCases, findCaseById } from '@/lib/exceptions/repository';
import { ExtractedCaseWithEvidence } from '@/lib/exceptions/types';
import { investigateCase } from '../investigationService';
import { MockAIProviderClient } from '../mockProvider';
import {
  persistInvestigation,
  findLatestInvestigationByCaseId,
  listInvestigationsByCaseId,
} from '../investigationRepository';

// Load .env.local if present in runtime environment without exposing contents
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local is optional
  }
}

describe('Phase 3D.2: Real PostgreSQL AI Investigation Acceptance Gates', () => {
  const liveDbUrl = process.env.DATABASE_URL;
  const liveReaderUrl = process.env.DATABASE_READER_URL;
  const liveAuditorUrl = process.env.DATABASE_AUDITOR_URL;

  let isLivePgAvailable = false;
  let livePool: Pool | null = null;
  let liveReaderPool: Pool | null = null;
  let liveAuditorPool: Pool | null = null;

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

          // Prevent unhandled error events on idle clients
          testPool.on('error', () => {});

          const client = await testPool.connect();
          await client.query('SELECT 1;');

          // Apply migrations to test database safely (including migrations 011 and 012)
          await runMigrations(testPool);

          // Configure least-privilege investigation roles with LOGIN for F-33 testing
          try {
            await client.query(`
              DO $$
              BEGIN
                IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'closeloop_investigation_reader') THEN
                  CREATE ROLE closeloop_investigation_reader WITH LOGIN PASSWORD 'ReaderPass_184_Secure!';
                ELSE
                  ALTER ROLE closeloop_investigation_reader WITH LOGIN;
                END IF;

                IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'closeloop_investigation_auditor') THEN
                  CREATE ROLE closeloop_investigation_auditor WITH LOGIN PASSWORD 'AuditorPass_184_Secure!';
                ELSE
                  ALTER ROLE closeloop_investigation_auditor WITH LOGIN;
                END IF;
              END $$;

              GRANT USAGE ON SCHEMA public TO closeloop_investigation_reader;
              GRANT SELECT ON exception_cases, case_evidence_items, paypal_imported_transactions, import_runs, case_investigations TO closeloop_investigation_reader;
              REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM closeloop_investigation_reader;

              GRANT USAGE ON SCHEMA public TO closeloop_investigation_auditor;
              GRANT SELECT ON exception_cases, case_investigations TO closeloop_investigation_auditor;
              GRANT INSERT ON case_investigations TO closeloop_investigation_auditor;
              REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON exception_cases, case_evidence_items, paypal_imported_transactions, import_runs FROM closeloop_investigation_auditor;
              REVOKE UPDATE, DELETE, TRUNCATE ON case_investigations FROM closeloop_investigation_auditor;
            `);
          } catch {
            // Role creation optional if superuser privileges are not granted
          }

          client.release();

          livePool = testPool;
          isLivePgAvailable = true;

          // Connect with dedicated restricted reader and auditor pools if URLs configured
          if (liveReaderUrl) {
            liveReaderPool = new Pool({ connectionString: liveReaderUrl });
            liveReaderPool.on('error', () => {});
          }
          if (liveAuditorUrl) {
            liveAuditorPool = new Pool({ connectionString: liveAuditorUrl });
            liveAuditorPool.on('error', () => {});
          }
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
    if (liveReaderPool) {
      await liveReaderPool.end();
      liveReaderPool = null;
    }
    if (liveAuditorPool) {
      await liveAuditorPool.end();
      liveAuditorPool = null;
    }
  });

  const generateLiveCase = (
    suffix: string,
    merchantId = 'merchant_live_ai_test'
  ): ExtractedCaseWithEvidence => {
    const uniqueSuffix = `${suffix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      caseRecord: {
        merchantId,
        caseKey: `v1_live_ai_case_${uniqueSuffix}_1111222233334444555566667777888899990000aaaabbbbcccc`,
        reconciliationRunId: `run_live_ai_${uniqueSuffix}`,
        discrepancyType: 'FEE_VARIANCE',
        status: 'OPEN',
        version: 1,
        varianceAmountMinor: 45,
        expectedAmountMinor: 290,
        actualAmountMinor: 335,
        currency: 'USD',
        currencyPrecision: 2,
        primaryReference: `ORD-${uniqueSuffix}`,
        merchantOrderId: `ORD-${uniqueSuffix}`,
        paypalTransactionId: `TXN-${uniqueSuffix}`,
        notes: 'Live PostgreSQL AI investigation acceptance test case.',
      },
      evidenceItems: [
        {
          merchantId,
          evidenceType: 'MERCHANT_ORDER',
          sourceSystem: 'MERCHANT_CSV',
          sourceTable: 'in_memory_orders',
          sourceRecordId: `ORD-${uniqueSuffix}`,
          sourceTransactionId: null,
          reconciliationRunId: `run_live_ai_${uniqueSuffix}`,
          payloadSnapshot: { orderId: `ORD-${uniqueSuffix}`, amountMinor: 10000 },
          contentHash: `hash-order-${uniqueSuffix}`.padStart(64, '0'),
          isObservedFact: true,
        },
        {
          merchantId,
          evidenceType: 'PAYPAL_TRANSACTION',
          sourceSystem: 'PAYPAL_DURABLE_LEDGER',
          sourceTable: 'paypal_imported_transactions',
          sourceRecordId: `TXN-${uniqueSuffix}`,
          sourceTransactionId: null,
          reconciliationRunId: `run_live_ai_${uniqueSuffix}`,
          payloadSnapshot: { transactionId: `TXN-${uniqueSuffix}`, feeMinor: 335 },
          contentHash: `hash-txn-${uniqueSuffix}`.padStart(64, '0'),
          isObservedFact: true,
        },
      ],
    };
  };

  it('Gate 1: Multi-Tenant Foreign Key Integrity (Cross-Tenant Investigation Rejection)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate1_tenant';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate1', testMerchant)]);
    const caseId = persisted.caseIds[0];

    const client = await livePool.connect();
    try {
      // Attempt to insert an investigation referencing the valid caseId but with a mismatched merchant_id
      await expect(
        client.query(
          `INSERT INTO case_investigations (
            case_id, merchant_id, case_version, evidence_fingerprint,
            provider, model, prompt_version, schema_version, status, investigation_result
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            caseId,
            'spoofed_attacker_merchant', // Mismatched tenant
            1,
            'fingerprint_gate1',
            'mock',
            'mock-v1',
            'v1.0',
            '1.0',
            'COMPLETED',
            JSON.stringify({}),
          ]
        )
      ).rejects.toMatchObject({
        code: '23503', // foreign_key_violation
      });
    } finally {
      client.release();
    }
  });

  it('Gate 2: Non-Cascading Deletion Rejection (ON DELETE RESTRICT)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate2_restrict';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate2', testMerchant)]);
    const caseId = persisted.caseIds[0];

    // Run investigation to create dependent case_investigations row
    const mockProvider = new MockAIProviderClient();
    await investigateCase(caseId, testMerchant, { providerOverride: mockProvider }, livePool);

    const client = await livePool.connect();
    try {
      // Attempt to delete parent exception_cases row
      await expect(
        client.query(`DELETE FROM exception_cases WHERE id = $1;`, [caseId])
      ).rejects.toSatisfy((err: unknown) => {
        const pgErr = err as { code?: string };
        return pgErr.code === '23001' || pgErr.code === '23503';
      });
    } finally {
      client.release();
    }
  });

  it('Gate 3: Read-Only Invariant (Case record status and amounts strictly unchanged)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate3_readonly';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate3', testMerchant)]);
    const caseId = persisted.caseIds[0];

    // Snapshot before state
    const beforeCase = await findCaseById(livePool, caseId, testMerchant);
    expect(beforeCase).not.toBeNull();

    // Execute investigation
    const mockProvider = new MockAIProviderClient();
    await investigateCase(caseId, testMerchant, { providerOverride: mockProvider }, livePool);

    // Snapshot after state
    const afterCase = await findCaseById(livePool, caseId, testMerchant);
    expect(afterCase).not.toBeNull();

    // Invariant assertions: zero mutation of financial facts or case status
    expect(afterCase?.status).toBe(beforeCase?.status);
    expect(afterCase?.status).toBe('OPEN');
    expect(afterCase?.version).toBe(beforeCase?.version);
    expect(afterCase?.varianceAmount.amountMinor).toBe(beforeCase?.varianceAmount.amountMinor);
    expect(afterCase?.expectedAmount.amountMinor).toBe(beforeCase?.expectedAmount.amountMinor);
    expect(afterCase?.actualAmount.amountMinor).toBe(beforeCase?.actualAmount.amountMinor);
    expect(afterCase?.updatedAt).toBe(beforeCase?.updatedAt);
  });

  it('Gate 4: Append-Only Investigation Audit Logging (Multiple investigations persist distinct history)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate4_append_only';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate4', testMerchant)]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient();

    // Run first investigation
    const inv1 = await investigateCase(caseId, testMerchant, { providerOverride: mockProvider }, livePool);
    // Run second investigation
    const inv2 = await investigateCase(caseId, testMerchant, { providerOverride: mockProvider }, livePool);

    const history = await listInvestigationsByCaseId(livePool, caseId, testMerchant);
    expect(history.length).toBe(2);
    expect(history.map((h) => h.id)).toContain(inv1.investigationId);
    expect(history.map((h) => h.id)).toContain(inv2.investigationId);

    // Verify chronological order (latest first)
    expect(history[0].id).toBe(inv2.investigationId);
    expect(history[1].id).toBe(inv1.investigationId);
  });

  it('Gate 5: Database Check Constraint Enforcement on status (Migration 012)', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate5_chk';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate5', testMerchant)]);
    const caseId = persisted.caseIds[0];

    const client = await livePool.connect();
    try {
      // Attempt to insert invalid status 'RESOLVED' into case_investigations
      await expect(
        client.query(
          `INSERT INTO case_investigations (
            case_id, merchant_id, case_version, evidence_fingerprint,
            provider, model, prompt_version, schema_version, status, investigation_result
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);`,
          [
            caseId,
            testMerchant,
            1,
            'fingerprint_gate5',
            'mock',
            'mock-v1',
            'v1.0',
            '1.0',
            'RESOLVED', // Invalid status per chk_case_investigations_status
            JSON.stringify({}),
          ]
        )
      ).rejects.toMatchObject({
        code: '23514', // check_violation
      });
    } finally {
      client.release();
    }
  });

  it('Gate 6 (F-31): Database Immutability Triggers Actively Block UPDATE, DELETE, and TRUNCATE', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate6_immutability';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate6', testMerchant)]);
    const caseId = persisted.caseIds[0];

    const mockProvider = new MockAIProviderClient();
    const invResult = await investigateCase(caseId, testMerchant, { providerOverride: mockProvider }, livePool);

    const client = await livePool.connect();
    try {
      // 1. UPDATE must be actively blocked by trg_prevent_case_investigations_update
      await expect(
        client.query(`UPDATE case_investigations SET status = 'FAILED' WHERE id = $1;`, [
          invResult.investigationId,
        ])
      ).rejects.toMatchObject({
        code: '23514', // check_violation raised by trigger function
      });

      // 2. DELETE must be actively blocked by trg_prevent_case_investigations_delete
      await expect(
        client.query(`DELETE FROM case_investigations WHERE id = $1;`, [invResult.investigationId])
      ).rejects.toMatchObject({
        code: '23514', // check_violation raised by trigger function
      });

      // 3. TRUNCATE must be actively blocked by trg_prevent_case_investigations_truncate
      await expect(client.query(`TRUNCATE case_investigations;`)).rejects.toMatchObject({
        code: '23514',
      });

      // Verify that the record remains completely unchanged
      const checkRes = await client.query(`SELECT status FROM case_investigations WHERE id = $1;`, [
        invResult.investigationId,
      ]);
      expect(checkRes.rows.length).toBe(1);
      expect(checkRes.rows[0].status).toBe('COMPLETED');
    } finally {
      client.release();
    }
  });

  it('Gate 7 (F-33): Genuine Runtime Least-Privilege Role Separation (Reader and Auditor Pools)', async (ctx) => {
    if (!isLivePgAvailable || !livePool || !liveReaderPool || !liveAuditorPool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate7_genuine_roles';
    const persisted = await persistExceptionCases(livePool, [generateLiveCase('gate7', testMerchant)]);
    const caseId = persisted.caseIds[0];

    // 1. Verify Reader Pool Authenticates as closeloop_investigation_reader
    const readerClient = await liveReaderPool.connect();
    try {
      const whoami = await readerClient.query('SELECT current_user, session_user, current_database();');
      expect(whoami.rows[0].current_user).toBe('closeloop_investigation_reader');
      expect(whoami.rows[0].session_user).toBe('closeloop_investigation_reader');
      expect(whoami.rows[0].current_database).toBe('closeloop_test');

      // Reader can SELECT from financial records
      const readRes = await readerClient.query('SELECT id, status FROM exception_cases WHERE id = $1;', [caseId]);
      expect(readRes.rows.length).toBe(1);

      // Reader CANNOT mutate financial tables
      await expect(
        readerClient.query("UPDATE exception_cases SET status = 'INVESTIGATING' WHERE id = $1;", [caseId])
      ).rejects.toMatchObject({
        code: '42501', // insufficient_privilege
      });

      await expect(
        readerClient.query('DELETE FROM exception_cases WHERE id = $1;', [caseId])
      ).rejects.toMatchObject({
        code: '42501',
      });

      // Reader CANNOT alter tables or disable triggers
      await expect(
        readerClient.query('ALTER TABLE case_investigations DISABLE TRIGGER ALL;')
      ).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      readerClient.release();
    }

    // 2. Verify Auditor Pool Authenticates as closeloop_investigation_auditor
    const auditorClient = await liveAuditorPool.connect();
    try {
      const whoami = await auditorClient.query('SELECT current_user, session_user, current_database();');
      expect(whoami.rows[0].current_user).toBe('closeloop_investigation_auditor');
      expect(whoami.rows[0].session_user).toBe('closeloop_investigation_auditor');
      expect(whoami.rows[0].current_database).toBe('closeloop_test');

      // Auditor can SELECT parent case for foreign key verification
      const caseCheck = await auditorClient.query('SELECT id, version FROM exception_cases WHERE id = $1;', [caseId]);
      expect(caseCheck.rows.length).toBe(1);

      // Auditor can INSERT into case_investigations
      const auditInsert = await auditorClient.query(
        `INSERT INTO case_investigations (
          case_id, merchant_id, case_version, evidence_fingerprint,
          provider, model, prompt_version, schema_version, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id;`,
        [caseId, testMerchant, 1, 'fingerprint_auditor_gate7', 'mock', 'mock-v1', 'v1.0', '1.0', 'COMPLETED']
      );
      expect(auditInsert.rows.length).toBe(1);

      // Auditor CANNOT mutate or delete from case_investigations (blocked by triggers and grants)
      await expect(
        auditorClient.query(`UPDATE case_investigations SET status = 'FAILED' WHERE id = $1;`, [auditInsert.rows[0].id])
      ).rejects.toSatisfy((err: unknown) => {
        const pgErr = err as { code?: string };
        return pgErr.code === '42501' || pgErr.code === '23514';
      });

      // Auditor CANNOT write to financial tables
      await expect(
        auditorClient.query("UPDATE exception_cases SET status = 'INVESTIGATING' WHERE id = $1;", [caseId])
      ).rejects.toMatchObject({
        code: '42501',
      });

      // Auditor CANNOT alter tables or drop triggers
      await expect(
        auditorClient.query('DROP TRIGGER trg_prevent_case_investigations_update ON case_investigations;')
      ).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      auditorClient.release();
    }
  });

  it('Gate 8 (F-35): Atomic TOCTOU Persistence & Dynamic Staleness Evaluation', async (ctx) => {
    if (!isLivePgAvailable || !livePool) {
      ctx.skip();
      return;
    }

    const testMerchant = 'merchant_gate8_staleness';
    const originalCase = generateLiveCase('gate8', testMerchant);
    const persisted = await persistExceptionCases(livePool, [originalCase]);
    const caseId = persisted.caseIds[0];

    // 1. Initial investigation against Version 1 is fresh
    const inv1 = await persistInvestigation(livePool, {
      caseId,
      merchantId: testMerchant,
      caseVersion: 1,
      evidenceFingerprint: 'fingerprint_v1',
      provider: 'mock',
      model: 'mock-v1',
      promptVersion: 'v1.0',
      schemaVersion: '1.0',
      status: 'COMPLETED',
      isStale: false,
    });
    expect(inv1.isStale).toBe(false);

    // Initial read is fresh
    const readInitial = await findLatestInvestigationByCaseId(livePool, caseId, testMerchant);
    expect(readInitial).not.toBeNull();
    expect(readInitial?.isStale).toBe(false);
    expect(readInitial?.status).toBe('COMPLETED');

    // 2. Parent case advances to Version 2
    const updatedCase = {
      ...originalCase,
      caseRecord: {
        ...originalCase.caseRecord,
        varianceAmountMinor: 999, // Mutated variance
      },
    };
    await persistExceptionCases(livePool, [updatedCase]);

    // 3. Dynamic Read Staleness: Reading the historical v1 investigation now dynamically reports STALE_SNAPSHOT
    const readAfterAdvance = await findLatestInvestigationByCaseId(livePool, caseId, testMerchant);
    expect(readAfterAdvance).not.toBeNull();
    expect(readAfterAdvance?.isStale).toBe(true);
    expect(readAfterAdvance?.status).toBe('STALE_SNAPSHOT');
    expect(readAfterAdvance?.caseVersion).toBe(1); // Historical record version preserved
    expect(readAfterAdvance?.snapshotMetadata?.currentVersion).toBe(2);

    // 4. Atomic Concurrency Guard at Persistence: Attempting to persist a v1 investigation when case is v2
    // is atomically converted to STALE_SNAPSHOT inside the commit transaction
    const invStaleAttempt = await persistInvestigation(livePool, {
      caseId,
      merchantId: testMerchant,
      caseVersion: 1, // Stale version
      evidenceFingerprint: 'fingerprint_v1_stale',
      provider: 'mock',
      model: 'mock-v1',
      promptVersion: 'v1.0',
      schemaVersion: '1.0',
      status: 'COMPLETED', // Caller thought it was completed
      isStale: false,
    });

    expect(invStaleAttempt.isStale).toBe(true);
    expect(invStaleAttempt.status).toBe('STALE_SNAPSHOT');
    expect(invStaleAttempt.snapshotMetadata?.currentVersion).toBe(2);
  });
});
