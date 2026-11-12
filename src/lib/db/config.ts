import { z } from 'zod';

/**
 * Zod schema for PostgreSQL database configuration.
 */
const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required for database persistence.')
    .regex(
      /^(postgresql|postgres):\/\/.+/,
      'DATABASE_URL must be a valid PostgreSQL connection URI (e.g., postgresql://user:password@localhost:5432/dbname).'
    ),
  DATABASE_READER_URL: z
    .string()
    .regex(/^(postgresql|postgres):\/\/.+/, 'DATABASE_READER_URL must be a valid PostgreSQL URI.')
    .optional(),
  DATABASE_AUDITOR_URL: z
    .string()
    .regex(/^(postgresql|postgres):\/\/.+/, 'DATABASE_AUDITOR_URL must be a valid PostgreSQL URI.')
    .optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type DatabaseConfig = z.infer<typeof databaseEnvSchema>;

/**
 * Sanitizes and masks a database connection string to prevent credential leakage in logs.
 * e.g., postgresql://user:mysecretpassword@localhost:5432/closeloop -> postgresql://user:****@localhost:5432/closeloop
 */
export function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '****';
    }
    return parsed.toString();
  } catch {
    return 'postgresql://[invalid-url]';
  }
}

/**
 * Custom error thrown when the database is not configured.
 * Explicitly prevents silent in-memory fallback.
 */
export class DatabaseConfigurationError extends Error {
  readonly code = 'DATABASE_NOT_CONFIGURED';

  constructor(message?: string) {
    super(
      message ||
        'Database connection is not configured. Set "DATABASE_URL" in .env.local to enable durable storage (e.g. postgresql://postgres:password@localhost:5432/closeloop).'
    );
    this.name = 'DatabaseConfigurationError';
  }
}

/**
 * Checks whether the database connection is configured in the environment.
 */
export function isDatabaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  return Boolean(url && url.length > 0);
}

/**
 * Retrieves validated database configuration from environment.
 * Throws DatabaseConfigurationError if missing or invalid.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const rawUrl = process.env.DATABASE_URL?.trim();
  if (!rawUrl) {
    throw new DatabaseConfigurationError();
  }

  const result = databaseEnvSchema.safeParse({
    DATABASE_URL: rawUrl,
    DB_POOL_MAX: process.env.DB_POOL_MAX,
    DB_IDLE_TIMEOUT_MS: process.env.DB_IDLE_TIMEOUT_MS,
    DB_CONNECTION_TIMEOUT_MS: process.env.DB_CONNECTION_TIMEOUT_MS,
  });

  if (!result.success) {
    const issues = result.error.issues.map((i) => i.message).join(' ');
    throw new DatabaseConfigurationError(`Invalid database configuration: ${issues}`);
  }

  return result.data;
}

/**
 * Retrieves the restricted reader database connection URL.
 * Fails closed if not configured (F-33).
 */
export function getReaderDatabaseUrl(): string {
  const url = process.env.DATABASE_READER_URL?.trim();
  if (!url) {
    throw new DatabaseConfigurationError(
      'DATABASE_READER_URL is not configured. Reader operations require a dedicated least-privilege role.'
    );
  }
  return url;
}

/**
 * Retrieves the restricted auditor database connection URL.
 * Fails closed if not configured (F-33).
 */
export function getAuditorDatabaseUrl(): string {
  const url = process.env.DATABASE_AUDITOR_URL?.trim();
  if (!url) {
    throw new DatabaseConfigurationError(
      'DATABASE_AUDITOR_URL is not configured. Auditor operations require a dedicated least-privilege role.'
    );
  }
  return url;
}

