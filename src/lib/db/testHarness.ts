import { newDb, IMemoryDb } from 'pg-mem';
import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';
import { runMigrations } from './migrator';
import { setTestPool, closePool } from './pool';

export interface TestDatabaseContext {
  db: IMemoryDb;
  pool: Pool;
}

/**
 * Creates an isolated in-memory PostgreSQL database instance for Vitest.
 * Registers cryptographic random UUID function and runs DDL migrations.
 */
export async function setupTestDatabase(): Promise<TestDatabaseContext> {
  // Disable pg-mem strict AST coverage check so standard PostgreSQL DDL executes cleanly
  process.env.NOCHECKFULLQUERYUSAGE = 'true';

  const db = newDb({
    autoCreateForeignKeyIndices: true,
  });

  // Register impure gen_random_uuid so each call produces a distinct UUID
  db.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => crypto.randomUUID(),
  });

  const { Pool: MemPool } = db.adapters.createPg();

  // Wrap pool.connect() to provide transaction rollback fidelity with db.backup()
  class TransactionalTestPool extends MemPool {
    async connect(): Promise<PoolClient> {
      const client = (await super.connect()) as PoolClient;
      let transactionBackup: ReturnType<typeof db.backup> | null = null;
      const originalQuery = client.query.bind(client);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.query = async (text: any, params?: any) => {
        const sql =
          typeof text === 'string'
            ? text.trim().toUpperCase()
            : text?.text?.trim()?.toUpperCase() || '';

        if (sql === 'BEGIN') {
          transactionBackup = db.backup();
          return originalQuery(text, params);
        }
        if (sql === 'ROLLBACK') {
          if (transactionBackup) {
            transactionBackup.restore();
          }
          transactionBackup = null;
          return originalQuery(text, params);
        }
        if (sql === 'COMMIT') {
          transactionBackup = null;
          return originalQuery(text, params);
        }

        // Mock advisory locking and session settings for pg-mem compatibility
        if (sql.startsWith('SET LOCK_TIMEOUT') || sql.startsWith('RESET LOCK_TIMEOUT')) {
          return { rows: [], rowCount: 0, command: 'SET', oid: 0, fields: [] };
        }
        if (
          sql.startsWith('CREATE RULE') ||
          sql.startsWith('CREATE OR REPLACE RULE') ||
          sql.startsWith('DROP RULE') ||
          sql.startsWith('CREATE TRIGGER') ||
          sql.startsWith('DROP TRIGGER') ||
          sql.startsWith('CREATE OR REPLACE FUNCTION') ||
          sql.startsWith('DROP FUNCTION') ||
          sql.startsWith('REVOKE') ||
          sql.startsWith('GRANT')
        ) {
          return { rows: [], rowCount: 0, command: 'CREATE', oid: 0, fields: [] };
        }
        if (sql.includes('PG_ADVISORY_')) {
          if (sql.includes('UNLOCK_SHARED')) {
            return { rows: [{ pg_advisory_unlock_shared: true }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
          }
          if (sql.includes('UNLOCK')) {
            return { rows: [{ pg_advisory_unlock: true }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
          }
          return { rows: [{ pg_advisory_lock: true, pg_advisory_lock_shared: true }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
        }

        return originalQuery(text, params);
      };

      return client;
    }
  }

  const pool = new TransactionalTestPool() as unknown as Pool;

  // Run initial migrations
  await runMigrations(pool);

  // Set as test pool override
  setTestPool(pool);

  return { db, pool };
}

/**
 * Tears down test database and resets pool state.
 */
export async function teardownTestDatabase(): Promise<void> {
  await closePool();
  setTestPool(null);
}
