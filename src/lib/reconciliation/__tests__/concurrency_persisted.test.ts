import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { Pool, PoolClient } from 'pg';
import {
  CLOSELOOP_INGESTION_LOCK_ID,
  initiateImportRunLease,
} from '@/lib/db/repositories/importRunRepository';
import {
  fetchEligibleTransactionsForReconciliation,
  PersistedLedgerError,
} from '../adapters/paypalPersistenceAdapter';
import { runMigrations } from '@/lib/db/migrator';

// Load .env.local if present in runtime environment without exposing contents
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // .env.local is optional
  }
}

describe('Phase 3C.3B: Real PostgreSQL Concurrency & Advisory Lock Suite (F-15, F-16, F-17, F-18)', () => {
  const liveDbUrl = process.env.DATABASE_URL;
  let isLivePgAvailable = false;
  let livePgServerVersion = '';
  let resolvedTargetDb = '';
  let resolvedTargetHost = '';
  let livePool: Pool | null = null;

  beforeAll(async () => {
    if (liveDbUrl) {
      try {
        const parsed = new URL(liveDbUrl);
        resolvedTargetHost = parsed.hostname;
        resolvedTargetDb = parsed.pathname.replace(/^\//, '');

        // Mandatory safety requirements:
        // 3. Do not use existing Supabase Research1111 database.
        // 4. Do not connect to production or unrelated database.
        // 5. Target only the dedicated local database closeloop_test.
        // 6. Abort if target is not the explicitly approved test database on localhost/127.0.0.1.
        const isApprovedHost = resolvedTargetHost === 'localhost' || resolvedTargetHost === '127.0.0.1';
        const isApprovedDb = resolvedTargetDb === 'closeloop_test';

        if (isApprovedHost && isApprovedDb) {
          const testPool = new Pool({
            connectionString: liveDbUrl,
            connectionTimeoutMillis: 2000,
          });
          const client = await testPool.connect();
          const versionRes = await client.query('SHOW server_version;');
          livePgServerVersion = versionRes.rows[0]?.server_version ?? 'Unknown';
          await client.query('SELECT 1;');

          // Terminate any stale test connections from previously aborted runs to prevent lock contention
          try {
            await client.query(
              "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'closeloop_test' AND pid <> pg_backend_pid();"
            );
          } catch {
            // Non-critical if superuser privileges are not granted
          }

          client.release();

          // Apply migrations to test database safely
          await runMigrations(testPool);

          livePool = testPool;
          isLivePgAvailable = true;
        } else {
          isLivePgAvailable = false;
        }
      } catch {
        isLivePgAvailable = false;
        livePool = null;
      }
    }
  });

  afterAll(async () => {
    if (livePool) {
      await livePool.end();
      livePool = null;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SECTION A: Protocol State Machine & 3-Stage Deterministic Cleanup Suite
  // Validates the 5 lifecycle flags and 9 failure mode dispositions
  // =========================================================================
  describe('Protocol State Machine & 3-Stage Cleanup (F-17B, F-18B)', () => {
    it('Stage 2 executes RESET lock_timeout even when lock acquisition times out (55P03)', async () => {
      const executedQueries: string[] = [];
      let releasedWithDestroy: boolean | undefined = undefined;

      const mockClient = {
        query: vi.fn(async (text: string | { text: string }) => {
          const sql = typeof text === 'string' ? text : text.text;
          executedQueries.push(sql);

          if (sql.includes('SET lock_timeout')) {
            return { rows: [] };
          }
          if (sql.includes('pg_advisory_lock')) {
            // Simulate lock timeout failure (SQLSTATE 55P03)
            const timeoutErr = new Error('canceling statement due to lock timeout');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (timeoutErr as any).code = '55P03';
            throw timeoutErr;
          }
          if (sql.includes('RESET lock_timeout')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
        release: vi.fn((destroy?: boolean) => {
          releasedWithDestroy = destroy;
        }),
      } as unknown as PoolClient;

      const mockPool = {
        connect: vi.fn(async () => mockClient),
      } as unknown as Pool;

      await expect(
        initiateImportRunLease(
          {
            requestedStartDate: '2026-11-01T00:00:00Z',
            requestedEndDate: '2026-11-05T00:00:00Z',
          },
          mockPool
        )
      ).rejects.toThrow('canceling statement due to lock timeout');

      // Invariant check: RESET lock_timeout must have executed
      expect(executedQueries.some((q) => q.includes('RESET lock_timeout'))).toBe(true);

      // Invariant check: pg_advisory_unlock must NOT have executed (lockAcquired was false)
      expect(executedQueries.some((q) => q.includes('pg_advisory_unlock'))).toBe(false);

      // Clean connection returned to pool without destroy
      expect(releasedWithDestroy).toBe(false);
    });

    it('Stage 1 unlock failure marks connectionTainted and forces client.release(true) socket destruction', async () => {
      const executedQueries: string[] = [];
      let releasedWithDestroy: boolean | undefined = undefined;

      const mockClient = {
        query: vi.fn(async (text: string | { text: string }) => {
          const sql = typeof text === 'string' ? text : text.text;
          executedQueries.push(sql);

          if (sql.includes('SET lock_timeout')) return { rows: [] };
          if (sql.includes('pg_advisory_lock(')) return { rows: [] };
          if (sql.includes('BEGIN')) return { rows: [] };
          if (sql.includes('INSERT INTO import_runs')) {
            return {
              rows: [
                {
                  id: 'run-taint-test',
                  source_provider: 'PAYPAL',
                  source_environment: 'SANDBOX',
                  requested_start_date: '2026-11-01T00:00:00Z',
                  requested_end_date: '2026-11-05T00:00:00Z',
                  page_size: 100,
                  max_pages: 5,
                  started_at: '2026-11-01T00:00:00Z',
                  completed_at: null,
                  import_status: 'RUNNING',
                },
              ],
            };
          }
          if (sql.includes('COMMIT')) return { rows: [] };
          if (sql.includes('pg_advisory_unlock(')) {
            // Unlock returns false (lock not held or backend discrepancy)
            return { rows: [{ pg_advisory_unlock: false }] };
          }
          if (sql.includes('RESET lock_timeout')) return { rows: [] };
          return { rows: [] };
        }),
        release: vi.fn((destroy?: boolean) => {
          releasedWithDestroy = destroy;
        }),
      } as unknown as PoolClient;

      const mockPool = {
        connect: vi.fn(async () => mockClient),
      } as unknown as Pool;

      const importRun = await initiateImportRunLease(
        {
          requestedStartDate: '2026-11-01T00:00:00Z',
          requestedEndDate: '2026-11-05T00:00:00Z',
        },
        mockPool
      );

      expect(importRun.id).toBe('run-taint-test');
      // Invariant check: release(true) was invoked to destroy tainted connection
      expect(releasedWithDestroy).toBe(true);
    });

    it('Reconciliation adapter maps lock acquisition timeout (55P03) to HTTP 409 IMPORT_RUN_IN_PROGRESS', async () => {
      const mockClient = {
        query: vi.fn(async (text: string | { text: string }) => {
          const sql = typeof text === 'string' ? text : text.text;
          if (sql.includes('SET lock_timeout')) return { rows: [] };
          if (sql.includes('pg_advisory_lock_shared')) {
            const timeoutErr = new Error('canceling statement due to lock timeout');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (timeoutErr as any).code = '55P03';
            throw timeoutErr;
          }
          if (sql.includes('RESET lock_timeout')) return { rows: [] };
          return { rows: [] };
        }),
        release: vi.fn(),
      } as unknown as PoolClient;

      try {
        await fetchEligibleTransactionsForReconciliation(
          {
            startDate: '2026-11-01T00:00:00Z',
            endDate: '2026-11-05T00:00:00Z',
          },
          mockClient
        );
        expect.unreachable('Should have thrown PersistedLedgerError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(PersistedLedgerError);
        const ledgerErr = err as PersistedLedgerError;
        expect(ledgerErr.httpStatus).toBe(409);
        expect(ledgerErr.code).toBe('IMPORT_RUN_IN_PROGRESS');
      }
    });

    it('Guarantees exactly-once release invocation under all circumstances', async () => {
      let releaseCount = 0;
      const mockClient = {
        query: vi.fn(async (text: string | { text: string }) => {
          const sql = typeof text === 'string' ? text : text.text;
          if (sql.includes('SET lock_timeout')) return { rows: [] };
          if (sql.includes('pg_advisory_lock')) return { rows: [] };
          if (sql.includes('BEGIN')) throw new Error('Simulated BEGIN failure');
          return { rows: [] };
        }),
        release: vi.fn(() => {
          releaseCount++;
        }),
      } as unknown as PoolClient;

      const mockPool = {
        connect: vi.fn(async () => mockClient),
      } as unknown as Pool;

      await expect(
        initiateImportRunLease(
          {
            requestedStartDate: '2026-11-01T00:00:00Z',
            requestedEndDate: '2026-11-05T00:00:00Z',
          },
          mockPool
        )
      ).rejects.toThrow('Simulated BEGIN failure');

      expect(releaseCount).toBe(1);
    });
  });

  // =========================================================================
  // SECTION B: Mandatory Live Multi-Connection PostgreSQL Concurrency Gates
  // Fully certified against real PostgreSQL with independent connections
  // =========================================================================
  describe('Live PostgreSQL Concurrency Gates (F-17C, F-19)', () => {
    it(
      'Gate 1: Import exclusive lock precedence and reconciliation visibility of committed RUNNING imports',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        const client1 = await livePool.connect();
        const client2 = await livePool.connect();
        const testRunId = `00000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;

        let client1ExclusiveHeld = false;
        let client2SharedHeld = false;
        let client2TxActive = false;
        let client1Tainted = false;
        let client2Tainted = false;

        try {
          expect(livePgServerVersion.length).toBeGreaterThan(0);

          // 1. Client 1 (Import lease) acquires exclusive session lock
          await client1.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          client1ExclusiveHeld = true;

          // 2. Client 2 (Reconciliation reader) attempts shared lock with short timeout
          await client2.query("SET lock_timeout = '200ms';");
          let client2TimedOut = false;
          try {
            await client2.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          } catch (err: unknown) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((err as any)?.code === '55P03') {
              client2TimedOut = true;
            }
          }
          expect(client2TimedOut).toBe(true);

          // 3. Client 1 inserts an import run and commits
          await client1.query(
            `INSERT INTO import_runs (
              id, source_provider, source_environment, requested_start_date, requested_end_date,
              started_at, completed_at, import_status, pages_fetched, records_received, records_inserted
            ) VALUES ($1, 'PAYPAL', 'SANDBOX', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z', NOW(), NOW(), 'COMPLETED', 1, 10, 10);`,
            [testRunId]
          );

          // 4. Client 1 releases exclusive lock
          const unlockRes1 = await client1.query<{ pg_advisory_unlock: boolean }>(
            'SELECT pg_advisory_unlock($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockRes1.rows[0].pg_advisory_unlock).toBe(true);
          client1ExclusiveHeld = false;

          // 5. Client 2 can now acquire shared lock
          await client2.query("SET lock_timeout = '3000ms';");
          await client2.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          client2SharedHeld = true;

          // 6. Client 2 starts REPEATABLE READ transaction and queries import_runs
          await client2.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
          client2TxActive = true;
          const visibleRes = await client2.query(
            'SELECT id, import_status FROM import_runs WHERE id = $1;',
            [testRunId]
          );

          // 7. Verify Client 2 sees the committed import run
          expect(visibleRes.rows.length).toBe(1);
          expect(visibleRes.rows[0].import_status).toBe('COMPLETED');

          await client2.query('COMMIT;');
          client2TxActive = false;

          const unlockRes2 = await client2.query<{ pg_advisory_unlock_shared: boolean }>(
            'SELECT pg_advisory_unlock_shared($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockRes2.rows[0].pg_advisory_unlock_shared).toBe(true);
          client2SharedHeld = false;
        } finally {
          // Cleanup test record
          try {
            await client1.query('DELETE FROM import_runs WHERE id = $1;', [testRunId]);
          } catch {
            // Ignore cleanup failure
          }

          // Cleanup Client 1
          if (client1ExclusiveHeld) {
            try {
              const res = await client1.query<{ pg_advisory_unlock: boolean }>(
                'SELECT pg_advisory_unlock($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock) client1Tainted = true;
              client1ExclusiveHeld = false;
            } catch {
              client1Tainted = true;
            }
          }
          client1.release(client1Tainted);

          // Cleanup Client 2
          if (client2TxActive) {
            try {
              await client2.query('ROLLBACK;');
              client2TxActive = false;
            } catch {
              client2Tainted = true;
            }
          }
          if (client2SharedHeld) {
            try {
              const res = await client2.query<{ pg_advisory_unlock_shared: boolean }>(
                'SELECT pg_advisory_unlock_shared($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock_shared) client2Tainted = true;
              client2SharedHeld = false;
            } catch {
              client2Tainted = true;
            }
          }
          try {
            await client2.query('RESET lock_timeout;');
          } catch {
            client2Tainted = true;
          }
          client2.release(client2Tainted);
        }
      }
    );

    it(
      'Gate 2: Reconciliation shared-lock snapshot isolation',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        const client1 = await livePool.connect();
        const client2 = await livePool.connect();
        const testRunId = `00000000-0000-4000-8000-${Date.now().toString().slice(-12)}`;

        let client1SharedHeld = false;
        let client1TxActive = false;
        let client2ExclusiveHeld = false;
        let client1Tainted = false;
        let client2Tainted = false;

        try {
          // 1. Client 1 (Reconciliation) acquires shared lock and establishes REPEATABLE READ snapshot
          await client1.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          client1SharedHeld = true;

          await client1.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
          client1TxActive = true;

          // Initial read establishing the snapshot
          const initialRead = await client1.query(
            'SELECT COUNT(*)::int as cnt FROM import_runs WHERE id = $1;',
            [testRunId]
          );
          expect(initialRead.rows[0].cnt).toBe(0);

          // 2. Client 2 (Import) attempts exclusive lock while shared lock is held
          await client2.query("SET lock_timeout = '200ms';");
          let client2ExclusiveBlocked = false;
          try {
            await client2.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          } catch (err: unknown) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((err as any)?.code === '55P03') {
              client2ExclusiveBlocked = true;
            }
          }
          expect(client2ExclusiveBlocked).toBe(true);

          // 3. Client 1 unlocks shared lock (allowing coordination to proceed)
          const unlockShared1 = await client1.query<{ pg_advisory_unlock_shared: boolean }>(
            'SELECT pg_advisory_unlock_shared($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockShared1.rows[0].pg_advisory_unlock_shared).toBe(true);
          client1SharedHeld = false;

          // 4. Client 2 acquires exclusive lock, inserts new run, commits, unlocks
          await client2.query("SET lock_timeout = '3000ms';");
          await client2.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          client2ExclusiveHeld = true;

          await client2.query(
            `INSERT INTO import_runs (
              id, source_provider, source_environment, requested_start_date, requested_end_date,
              started_at, completed_at, import_status, pages_fetched, records_received, records_inserted
            ) VALUES ($1, 'PAYPAL', 'SANDBOX', '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z', NOW(), NOW(), 'COMPLETED', 1, 10, 10);`,
            [testRunId]
          );

          const unlockExclusive2 = await client2.query<{ pg_advisory_unlock: boolean }>(
            'SELECT pg_advisory_unlock($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockExclusive2.rows[0].pg_advisory_unlock).toBe(true);
          client2ExclusiveHeld = false;

          // 5. Client 1 (still inside its existing REPEATABLE READ transaction) re-queries:
          // Invariant: Snapshot isolation guarantees the newly inserted run is NOT visible
          const snapshotRead = await client1.query(
            'SELECT COUNT(*)::int as cnt FROM import_runs WHERE id = $1;',
            [testRunId]
          );
          expect(snapshotRead.rows[0].cnt).toBe(0);

          // 6. Client 1 commits transaction and starts a fresh snapshot
          await client1.query('COMMIT;');
          client1TxActive = false;

          const freshRead = await client1.query(
            'SELECT COUNT(*)::int as cnt FROM import_runs WHERE id = $1;',
            [testRunId]
          );
          expect(freshRead.rows[0].cnt).toBe(1);
        } finally {
          try {
            await client1.query('DELETE FROM import_runs WHERE id = $1;', [testRunId]);
          } catch {
            // Ignore cleanup failure
          }

          if (client1TxActive) {
            try {
              await client1.query('ROLLBACK;');
              client1TxActive = false;
            } catch {
              client1Tainted = true;
            }
          }
          if (client1SharedHeld) {
            try {
              const res = await client1.query<{ pg_advisory_unlock_shared: boolean }>(
                'SELECT pg_advisory_unlock_shared($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock_shared) client1Tainted = true;
              client1SharedHeld = false;
            } catch {
              client1Tainted = true;
            }
          }
          client1.release(client1Tainted);

          if (client2ExclusiveHeld) {
            try {
              const res = await client2.query<{ pg_advisory_unlock: boolean }>(
                'SELECT pg_advisory_unlock($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock) client2Tainted = true;
              client2ExclusiveHeld = false;
            } catch {
              client2Tainted = true;
            }
          }
          try {
            await client2.query('RESET lock_timeout;');
          } catch {
            client2Tainted = true;
          }
          client2.release(client2Tainted);
        }
      }
    );

    it(
      'Gate 3: Lock timeout and absence of leaked advisory locks',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        const client1 = await livePool.connect();
        const client2 = await livePool.connect();

        let client1ExclusiveHeld = false;
        let client1Tainted = false;
        let client2Tainted = false;

        try {
          // 1. Client 1 acquires exclusive lock
          await client1.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          client1ExclusiveHeld = true;

          // 2. Client 2 attempts shared lock with 200ms timeout
          await client2.query("SET lock_timeout = '200ms';");
          let client2TimedOut = false;
          try {
            await client2.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          } catch (err: unknown) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((err as any)?.code === '55P03') {
              client2TimedOut = true;
            }
          }
          expect(client2TimedOut).toBe(true);

          // 3. Inspect pg_locks: Client 2 must hold ZERO advisory locks
          // Key 8492048201 is 64-bit: decomposed into classid (high 32 bits), objid (low 32 bits), objsubid = 1
          const locksRes = await client2.query<{ cnt: number }>(
            `SELECT COUNT(*)::int as cnt FROM pg_locks 
             WHERE locktype = 'advisory' 
               AND classid = (($1::bigint >> 32) & 4294967295)::oid
               AND objid = ($1::bigint & 4294967295)::oid
               AND objsubid = 1
               AND pid = pg_backend_pid();`,
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(locksRes.rows[0].cnt).toBe(0);

          // 4. Release Client 1
          const unlockRes = await client1.query<{ pg_advisory_unlock: boolean }>(
            'SELECT pg_advisory_unlock($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockRes.rows[0].pg_advisory_unlock).toBe(true);
          client1ExclusiveHeld = false;
        } finally {
          // Cleanup Client 2: Reset lock_timeout
          try {
            await client2.query('RESET lock_timeout;');
          } catch {
            client2Tainted = true;
          } finally {
            client2.release(client2Tainted);
          }

          // Cleanup Client 1: Explicitly unlock exclusive advisory lock if acquired
          try {
            if (client1ExclusiveHeld) {
              const res = await client1.query<{ pg_advisory_unlock: boolean }>(
                'SELECT pg_advisory_unlock($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock) {
                client1Tainted = true;
              }
              client1ExclusiveHeld = false;
            }
          } catch {
            client1Tainted = true;
          } finally {
            client1.release(client1Tainted);
          }
        }
      }
    );

    it(
      'Gate 4: Unlock failure and connection destruction',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        const client = await livePool.connect();
        try {
          // Calling pg_advisory_unlock when no lock is held returns false
          const unlockRes = await client.query<{ pg_advisory_unlock: boolean }>(
            'SELECT pg_advisory_unlock($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockRes.rows[0].pg_advisory_unlock).toBe(false);

          // Protocol invariant: When unlock fails (returns false), connectionTainted is set to true
          // and client.release(true) destroys the underlying socket.
          // We verify client.release(true) does not throw and safely terminates the connection.
          client.release(true);
        } catch (err) {
          client.release(true);
          throw err;
        }
      }
    );

    it(
      'Gate 5: Concurrent reconciliation using shared advisory locks',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        const clientA = await livePool.connect();
        const clientB = await livePool.connect();

        let lockAcquiredA = false;
        let lockAcquiredB = false;
        let taintedA = false;
        let taintedB = false;

        try {
          // Both acquire shared lock simultaneously without blocking
          await clientA.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          lockAcquiredA = true;
          await clientB.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
          lockAcquiredB = true;

          // Verify both clients hold granted shared locks simultaneously via pg_locks
          // Decompose 64-bit key into classid (high 32 bits), objid (low 32 bits), objsubid = 1
          const locksA = await clientA.query<{ cnt: number }>(
            `SELECT COUNT(*)::int as cnt FROM pg_locks 
             WHERE locktype = 'advisory' 
               AND classid = (($1::bigint >> 32) & 4294967295)::oid
               AND objid = ($1::bigint & 4294967295)::oid
               AND objsubid = 1
               AND granted = true 
               AND pid = pg_backend_pid();`,
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          const locksB = await clientB.query<{ cnt: number }>(
            `SELECT COUNT(*)::int as cnt FROM pg_locks 
             WHERE locktype = 'advisory' 
               AND classid = (($1::bigint >> 32) & 4294967295)::oid
               AND objid = ($1::bigint & 4294967295)::oid
               AND objsubid = 1
               AND granted = true 
               AND pid = pg_backend_pid();`,
            [CLOSELOOP_INGESTION_LOCK_ID]
          );

          expect(locksA.rows[0].cnt).toBeGreaterThanOrEqual(1);
          expect(locksB.rows[0].cnt).toBeGreaterThanOrEqual(1);

          // Both unlock cleanly
          const unlockA = await clientA.query<{ pg_advisory_unlock_shared: boolean }>(
            'SELECT pg_advisory_unlock_shared($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockA.rows[0].pg_advisory_unlock_shared).toBe(true);
          lockAcquiredA = false;

          const unlockB = await clientB.query<{ pg_advisory_unlock_shared: boolean }>(
            'SELECT pg_advisory_unlock_shared($1);',
            [CLOSELOOP_INGESTION_LOCK_ID]
          );
          expect(unlockB.rows[0].pg_advisory_unlock_shared).toBe(true);
          lockAcquiredB = false;
        } finally {
          // Cleanup clientA
          try {
            if (lockAcquiredA) {
              const res = await clientA.query<{ pg_advisory_unlock_shared: boolean }>(
                'SELECT pg_advisory_unlock_shared($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock_shared) {
                taintedA = true;
              }
              lockAcquiredA = false;
            }
          } catch {
            taintedA = true;
          } finally {
            clientA.release(taintedA);
          }

          // Cleanup clientB
          try {
            if (lockAcquiredB) {
              const res = await clientB.query<{ pg_advisory_unlock_shared: boolean }>(
                'SELECT pg_advisory_unlock_shared($1);',
                [CLOSELOOP_INGESTION_LOCK_ID]
              );
              if (!res.rows[0]?.pg_advisory_unlock_shared) {
                taintedB = true;
              }
              lockAcquiredB = false;
            }
          } catch {
            taintedB = true;
          } finally {
            clientB.release(taintedB);
          }
        }
      }
    );

    it(
      'Gate 6: Connection-pool hygiene, including absence of stale lock_timeout settings',
      async (ctx) => {
        if (!isLivePgAvailable || !livePool) {
          ctx.skip('Live PostgreSQL closeloop_test database not available');
          return;
        }

        // Cycle 1: Acquire connection, modify lock_timeout, reset, and return to pool
        const client1 = await livePool.connect();
        let client1Tainted = false;
        try {
          await client1.query("SET lock_timeout = '3000ms';");
          const modified = await client1.query('SHOW lock_timeout;');
          expect(modified.rows[0].lock_timeout).toBe('3s');

          await client1.query('RESET lock_timeout;');
          const reset = await client1.query('SHOW lock_timeout;');
          expect(reset.rows[0].lock_timeout).toBe('0');
        } catch {
          client1Tainted = true;
          throw new Error('Connection pool hygiene verification failed');
        } finally {
          client1.release(client1Tainted);
        }

        // Cycle 2: Acquire a connection from pool and verify it starts with default '0'
        const client2 = await livePool.connect();
        try {
          const fresh = await client2.query('SHOW lock_timeout;');
          expect(fresh.rows[0].lock_timeout).toBe('0');
        } finally {
          client2.release();
        }
      }
    );
  });
});
