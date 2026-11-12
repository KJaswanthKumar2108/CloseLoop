import { Pool, PoolClient } from 'pg';
import {
  getDatabaseConfig,
  getReaderDatabaseUrl,
  getAuditorDatabaseUrl,
  isDatabaseConfigured,
  DatabaseConfigurationError,
} from './config';

// Ensure this module is never bundled into client-side code
if (typeof window !== 'undefined') {
  throw new Error('Database pool cannot be initialized in client-side code.');
}

let activePool: Pool | null = null;
let readerPool: Pool | null = null;
let auditorPool: Pool | null = null;

let testPoolOverride: Pool | null = null;
let testReaderPoolOverride: Pool | null = null;
let testAuditorPoolOverride: Pool | null = null;

/**
 * Injects test pools (e.g. pg-mem) for isolated Vitest executions.
 */
export function setTestPool(pool: Pool | null): void {
  testPoolOverride = pool;
  if (!pool) {
    testReaderPoolOverride = null;
    testAuditorPoolOverride = null;
  }
}

export function setTestReaderPool(pool: Pool | null): void {
  testReaderPoolOverride = pool;
}

export function setTestAuditorPool(pool: Pool | null): void {
  testAuditorPoolOverride = pool;
}

/**
 * Retrieves the migration / administrative database connection pool.
 * Only used for migrations, administrative tasks, and table provisioning.
 * Never used by investigation runtime routes.
 */
export function getPool(): Pool {
  if (testPoolOverride) {
    return testPoolOverride;
  }

  if (activePool) {
    return activePool;
  }

  if (!isDatabaseConfigured()) {
    throw new DatabaseConfigurationError();
  }

  const config = getDatabaseConfig();

  // Create persistent connection pool
  activePool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    ssl:
      process.env.DATABASE_SSL === 'true' || config.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
  });

  activePool.on('error', (err) => {
    console.error('Unexpected error on idle database client:', err.message);
  });

  return activePool;
}

/**
 * Retrieves the restricted reader connection pool (F-33).
 * Authenticates as closeloop_investigation_reader with SELECT-only privileges.
 * Fails closed if DATABASE_READER_URL is not configured.
 */
export function getReaderPool(): Pool {
  if (testReaderPoolOverride) {
    return testReaderPoolOverride;
  }
  if (testPoolOverride) {
    return testPoolOverride;
  }

  if (readerPool) {
    return readerPool;
  }

  const readerUrl = getReaderDatabaseUrl();
  const config = getDatabaseConfig();

  readerPool = new Pool({
    connectionString: readerUrl,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    ssl:
      process.env.DATABASE_SSL === 'true' || readerUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
  });

  readerPool.on('error', (err) => {
    console.error('Unexpected error on idle reader database client:', err.message);
  });

  return readerPool;
}

/**
 * Retrieves the restricted auditor connection pool (F-33).
 * Authenticates as closeloop_investigation_auditor with INSERT-only privileges on case_investigations.
 * Fails closed if DATABASE_AUDITOR_URL is not configured.
 */
export function getAuditorPool(): Pool {
  if (testAuditorPoolOverride) {
    return testAuditorPoolOverride;
  }
  if (testPoolOverride) {
    return testPoolOverride;
  }

  if (auditorPool) {
    return auditorPool;
  }

  const auditorUrl = getAuditorDatabaseUrl();
  const config = getDatabaseConfig();

  auditorPool = new Pool({
    connectionString: auditorUrl,
    max: config.DB_POOL_MAX,
    idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
    ssl:
      process.env.DATABASE_SSL === 'true' || auditorUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : undefined,
  });

  auditorPool.on('error', (err) => {
    console.error('Unexpected error on idle auditor database client:', err.message);
  });

  return auditorPool;
}

/**
 * Checks connectivity to the database by executing a lightweight ping.
 */
export async function checkDatabaseHealth(): Promise<{
  isHealthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const pool = getPool();
    const res = await pool.query('SELECT 1 AS ping');
    if (res.rows[0]?.ping === 1 || res.rows[0]?.ping === '1') {
      return { isHealthy: true, latencyMs: Date.now() - start };
    }
    return { isHealthy: false, latencyMs: Date.now() - start, error: 'Unexpected ping response' };
  } catch (err: unknown) {
    return {
      isHealthy: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown database connection error',
    };
  }
}

/**
 * Closes all active database connection pools during shutdown or between tests.
 */
export async function closePool(): Promise<void> {
  if (activePool) {
    await activePool.end();
    activePool = null;
  }
  if (readerPool) {
    await readerPool.end();
    readerPool = null;
  }
  if (auditorPool) {
    await auditorPool.end();
    auditorPool = null;
  }
  if (testPoolOverride) {
    await testPoolOverride.end();
    testPoolOverride = null;
  }
  if (testReaderPoolOverride) {
    await testReaderPoolOverride.end();
    testReaderPoolOverride = null;
  }
  if (testAuditorPoolOverride) {
    await testAuditorPoolOverride.end();
    testAuditorPoolOverride = null;
  }
}

/**
 * Helper to run a callback inside a client checkout from the migration pool.
 */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
