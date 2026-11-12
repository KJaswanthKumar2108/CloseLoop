import { Pool, PoolClient } from 'pg';
import { getPool } from './pool';

export interface MigrationDefinition {
  version: string;
  name: string;
  upSql: string;
  downSql: string;
}

// Embedded migrations registry ensures zero filesystem resolution errors in serverless / bundled runtimes
export const MIGRATIONS: MigrationDefinition[] = [
  {
    version: '001_initial_schema',
    name: 'Create initial schema for import runs, paypal imported transactions, rejected records, and collision logs',
    upSql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS import_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_provider VARCHAR(50) NOT NULL DEFAULT 'PAYPAL',
        source_environment VARCHAR(50) NOT NULL DEFAULT 'SANDBOX',
        requested_start_date TIMESTAMPTZ NOT NULL,
        requested_end_date TIMESTAMPTZ NOT NULL,
        page_size INTEGER NOT NULL DEFAULT 100,
        max_pages INTEGER NOT NULL DEFAULT 5,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        import_status VARCHAR(50) NOT NULL DEFAULT 'RUNNING',
        pages_fetched INTEGER NOT NULL DEFAULT 0,
        records_received INTEGER NOT NULL DEFAULT 0,
        records_inserted INTEGER NOT NULL DEFAULT 0,
        records_already_present INTEGER NOT NULL DEFAULT 0,
        records_rejected INTEGER NOT NULL DEFAULT 0,
        identity_collisions_detected INTEGER NOT NULL DEFAULT 0,
        safe_error_code VARCHAR(100),
        safe_error_message TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_import_runs_status ON import_runs(import_status);
      CREATE INDEX IF NOT EXISTS idx_import_runs_started ON import_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS paypal_imported_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        paypal_transaction_id VARCHAR(100) NOT NULL,
        fingerprint VARCHAR(500) NOT NULL UNIQUE,
        transaction_event_code VARCHAR(20) NOT NULL,
        transaction_type VARCHAR(50) NOT NULL,
        transaction_status VARCHAR(50) NOT NULL,
        gross_amount_minor BIGINT NOT NULL,
        currency CHAR(3) NOT NULL,
        currency_precision INTEGER NOT NULL DEFAULT 2,
        fee_amount_minor BIGINT,
        net_amount_minor BIGINT,
        transaction_time TIMESTAMPTZ NOT NULL,
        paypal_reference_id VARCHAR(100),
        paypal_reference_type VARCHAR(50),
        paypal_order_id VARCHAR(100),
        paypal_capture_id VARCHAR(100),
        invoice_id VARCHAR(200),
        merchant_reference VARCHAR(200),
        source_environment VARCHAR(50) NOT NULL DEFAULT 'SANDBOX',
        source_provider VARCHAR(50) NOT NULL DEFAULT 'PAYPAL',
        first_imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_import_run_id UUID NOT NULL REFERENCES import_runs(id),
        last_import_run_id UUID NOT NULL REFERENCES import_runs(id),
        reconciliation_eligible BOOLEAN NOT NULL DEFAULT FALSE,
        reconciliation_eligibility_status VARCHAR(50) NOT NULL DEFAULT 'INELIGIBLE_NON_SETTLED',
        identity_collision_status VARCHAR(50) NOT NULL DEFAULT 'NONE',
        raw_reference VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_paypal_tx_paypal_id ON paypal_imported_transactions(paypal_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_paypal_tx_fingerprint ON paypal_imported_transactions(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_paypal_tx_currency ON paypal_imported_transactions(currency);
      CREATE INDEX IF NOT EXISTS idx_paypal_tx_time ON paypal_imported_transactions(transaction_time);
      CREATE INDEX IF NOT EXISTS idx_paypal_tx_first_run ON paypal_imported_transactions(first_import_run_id);
      CREATE INDEX IF NOT EXISTS idx_paypal_tx_eligibility ON paypal_imported_transactions(reconciliation_eligible, reconciliation_eligibility_status);

      CREATE TABLE IF NOT EXISTS paypal_rejected_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        import_run_id UUID NOT NULL REFERENCES import_runs(id),
        paypal_transaction_id VARCHAR(100),
        transaction_event_code VARCHAR(20),
        rejection_reason VARCHAR(100) NOT NULL,
        rejection_message TEXT NOT NULL,
        raw_payload JSONB NOT NULL,
        rejected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_paypal_rejected_run_id ON paypal_rejected_records(import_run_id);
      CREATE INDEX IF NOT EXISTS idx_paypal_rejected_reason ON paypal_rejected_records(rejection_reason);

      CREATE TABLE IF NOT EXISTS identity_collision_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        import_run_id UUID NOT NULL REFERENCES import_runs(id),
        fingerprint VARCHAR(500) NOT NULL,
        paypal_transaction_id VARCHAR(100) NOT NULL,
        collision_type VARCHAR(50) NOT NULL,
        details TEXT NOT NULL,
        raw_payload JSONB NOT NULL,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_collision_fingerprint ON identity_collision_logs(fingerprint);
      CREATE INDEX IF NOT EXISTS idx_collision_run_id ON identity_collision_logs(import_run_id);
    `,
    downSql: `
      DROP TABLE IF EXISTS identity_collision_logs CASCADE;
      DROP TABLE IF EXISTS paypal_rejected_records CASCADE;
      DROP TABLE IF EXISTS paypal_imported_transactions CASCADE;
      DROP TABLE IF EXISTS import_runs CASCADE;
    `,
  },
  {
    version: '008_exception_cases_and_evidence',
    name: 'Create exception_cases and case_evidence_items tables with indexes and constraints',
    upSql: `
      CREATE TABLE IF NOT EXISTS exception_cases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(100) NOT NULL DEFAULT 'default',
        case_key VARCHAR(255) NOT NULL,
        reconciliation_run_id VARCHAR(100) NOT NULL,
        discrepancy_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
        version INTEGER NOT NULL DEFAULT 1,
        variance_amount_minor BIGINT NOT NULL DEFAULT 0,
        expected_amount_minor BIGINT NOT NULL DEFAULT 0,
        actual_amount_minor BIGINT NOT NULL DEFAULT 0,
        currency CHAR(3) NOT NULL,
        currency_precision INTEGER NOT NULL DEFAULT 2,
        primary_reference VARCHAR(255) NOT NULL,
        merchant_order_id VARCHAR(255),
        paypal_transaction_id VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_exception_cases_tenant_case_key UNIQUE (merchant_id, case_key),
        CONSTRAINT chk_exception_cases_status CHECK (status IN ('OPEN', 'INVESTIGATING', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED_DISMISSED', 'ESCALATED'))
      );

      CREATE INDEX IF NOT EXISTS idx_exception_cases_merchant_status ON exception_cases(merchant_id, status);
      CREATE INDEX IF NOT EXISTS idx_exception_cases_recon_run ON exception_cases(reconciliation_run_id);
      CREATE INDEX IF NOT EXISTS idx_exception_cases_primary_ref ON exception_cases(merchant_id, primary_reference);
      CREATE INDEX IF NOT EXISTS idx_exception_cases_created ON exception_cases(created_at DESC);

      CREATE TABLE IF NOT EXISTS case_evidence_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL REFERENCES exception_cases(id) ON DELETE CASCADE,
        merchant_id VARCHAR(100) NOT NULL DEFAULT 'default',
        evidence_type VARCHAR(50) NOT NULL,
        source_system VARCHAR(50) NOT NULL,
        source_table VARCHAR(100),
        source_record_id VARCHAR(255) NOT NULL,
        source_transaction_id UUID REFERENCES paypal_imported_transactions(id),
        reconciliation_run_id VARCHAR(100) NOT NULL,
        payload_snapshot JSONB NOT NULL,
        content_hash CHAR(64) NOT NULL,
        is_observed_fact BOOLEAN NOT NULL DEFAULT TRUE,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_case_evidence_item UNIQUE (case_id, evidence_type, source_record_id)
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_case_id ON case_evidence_items(case_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_source_txn ON case_evidence_items(source_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_source_lookup ON case_evidence_items(source_system, source_record_id);
      CREATE INDEX IF NOT EXISTS idx_evidence_merchant_case ON case_evidence_items(merchant_id, case_id);
    `,
    downSql: `
      DROP TABLE IF EXISTS case_evidence_items;
      DROP TABLE IF EXISTS exception_cases;
    `,
  },
  {
    version: '009_exception_safety_hardening',
    name: 'Add composite tenant evidence ownership, non-cascading restriction, evidence immutability rules, and initial variance tracking',
    upSql: `
      ALTER TABLE exception_cases
        ADD CONSTRAINT uq_exception_cases_id_merchant UNIQUE (id, merchant_id);

      ALTER TABLE exception_cases
        ADD COLUMN IF NOT EXISTS initial_variance_amount_minor BIGINT;

      UPDATE exception_cases
      SET initial_variance_amount_minor = variance_amount_minor
      WHERE initial_variance_amount_minor IS NULL;

      ALTER TABLE case_evidence_items
        DROP CONSTRAINT IF EXISTS case_evidence_items_case_id_fkey;

      ALTER TABLE case_evidence_items
        ADD CONSTRAINT fk_case_evidence_tenant FOREIGN KEY (case_id, merchant_id)
        REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT;

      CREATE OR REPLACE RULE no_update_case_evidence AS
      ON UPDATE TO case_evidence_items DO INSTEAD NOTHING;

      CREATE OR REPLACE RULE no_delete_case_evidence AS
      ON DELETE TO case_evidence_items DO INSTEAD NOTHING;
    `,
    downSql: `
      DROP RULE IF EXISTS no_delete_case_evidence ON case_evidence_items;
      DROP RULE IF EXISTS no_update_case_evidence ON case_evidence_items;

      ALTER TABLE case_evidence_items
        DROP CONSTRAINT IF EXISTS fk_case_evidence_tenant;

      ALTER TABLE case_evidence_items
        ADD CONSTRAINT case_evidence_items_case_id_fkey FOREIGN KEY (case_id)
        REFERENCES exception_cases(id) ON DELETE RESTRICT;

      ALTER TABLE exception_cases
        DROP CONSTRAINT IF EXISTS uq_exception_cases_id_merchant;
    `,
  },
  {
    version: '010_database_immutability_triggers',
    name: 'Add exception-raising database triggers for evidence immutability and revoke modification privileges (F-25)',
    upSql: `
      DROP RULE IF EXISTS no_update_case_evidence ON case_evidence_items;
      DROP RULE IF EXISTS no_delete_case_evidence ON case_evidence_items;

      CREATE OR REPLACE FUNCTION prevent_case_evidence_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'case_evidence_items is immutable: % operation is strictly forbidden on financial evidence audit trail', TG_OP
          USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_update ON case_evidence_items;
      CREATE TRIGGER trg_prevent_case_evidence_update
      BEFORE UPDATE ON case_evidence_items
      FOR EACH ROW EXECUTE FUNCTION prevent_case_evidence_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_delete ON case_evidence_items;
      CREATE TRIGGER trg_prevent_case_evidence_delete
      BEFORE DELETE ON case_evidence_items
      FOR EACH ROW EXECUTE FUNCTION prevent_case_evidence_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_truncate ON case_evidence_items;
      CREATE TRIGGER trg_prevent_case_evidence_truncate
      BEFORE TRUNCATE ON case_evidence_items
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_evidence_mutation();

      REVOKE UPDATE, DELETE, TRUNCATE ON case_evidence_items FROM PUBLIC;
    `,
    downSql: `
      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_truncate ON case_evidence_items;
      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_delete ON case_evidence_items;
      DROP TRIGGER IF EXISTS trg_prevent_case_evidence_update ON case_evidence_items;
      DROP FUNCTION IF EXISTS prevent_case_evidence_mutation();
    `,
  },
  {
    version: '011_case_investigations',
    name: 'Create case_investigations audit table with composite tenant foreign key and indexes (Phase 3D.2)',
    upSql: `
      CREATE TABLE IF NOT EXISTS case_investigations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id UUID NOT NULL,
        merchant_id VARCHAR(100) NOT NULL,
        case_version INTEGER NOT NULL,
        evidence_fingerprint VARCHAR(64) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        model VARCHAR(100) NOT NULL,
        prompt_version VARCHAR(20) NOT NULL,
        schema_version VARCHAR(20) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
        investigation_result JSONB,
        safe_error_code VARCHAR(100),
        safe_error_message TEXT,
        tokens_used JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_case_investigations_tenant FOREIGN KEY (case_id, merchant_id)
          REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT,
        CONSTRAINT chk_case_investigations_status CHECK (status IN ('COMPLETED', 'FAILED'))
      );

      CREATE INDEX IF NOT EXISTS idx_case_investigations_lookup ON case_investigations(merchant_id, case_id);
      CREATE INDEX IF NOT EXISTS idx_case_investigations_created ON case_investigations(case_id, created_at DESC);
    `,
    downSql: `
      DROP TABLE IF EXISTS case_investigations;
    `,
  },
  {
    version: '012_case_investigations_immutability',
    name: 'Add immutability triggers and snapshot consistency metadata to case_investigations (Phase 3D.2 F-31/F-35)',
    upSql: `
      ALTER TABLE case_investigations 
        ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE case_investigations 
        ADD COLUMN IF NOT EXISTS snapshot_metadata JSONB;

      ALTER TABLE case_investigations 
        DROP CONSTRAINT IF EXISTS chk_case_investigations_status;

      ALTER TABLE case_investigations 
        ADD CONSTRAINT chk_case_investigations_status 
        CHECK (status IN ('COMPLETED', 'FAILED', 'STALE_SNAPSHOT'));

      CREATE OR REPLACE FUNCTION prevent_case_investigations_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'case_investigations is append-only: % operation is strictly forbidden on AI investigation audit trail', TG_OP
          USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_update ON case_investigations;
      CREATE TRIGGER trg_prevent_case_investigations_update
      BEFORE UPDATE ON case_investigations
      FOR EACH ROW EXECUTE FUNCTION prevent_case_investigations_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_delete ON case_investigations;
      CREATE TRIGGER trg_prevent_case_investigations_delete
      BEFORE DELETE ON case_investigations
      FOR EACH ROW EXECUTE FUNCTION prevent_case_investigations_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_truncate ON case_investigations;
      CREATE TRIGGER trg_prevent_case_investigations_truncate
      BEFORE TRUNCATE ON case_investigations
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_investigations_mutation();

      REVOKE UPDATE, DELETE, TRUNCATE ON case_investigations FROM PUBLIC;
    `,
    downSql: `
      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_truncate ON case_investigations;
      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_delete ON case_investigations;
      DROP TRIGGER IF EXISTS trg_prevent_case_investigations_update ON case_investigations;
      DROP FUNCTION IF EXISTS prevent_case_investigations_mutation();

      ALTER TABLE case_investigations DROP CONSTRAINT IF EXISTS chk_case_investigations_status;
      ALTER TABLE case_investigations ADD CONSTRAINT chk_case_investigations_status CHECK (status IN ('COMPLETED', 'FAILED'));

      ALTER TABLE case_investigations DROP COLUMN IF EXISTS snapshot_metadata;
      ALTER TABLE case_investigations DROP COLUMN IF EXISTS is_stale;
    `,
  },
  {
    version: '013_case_approvals_and_audit',
    name: 'Add case_approvals and tamper-evident hash-chained approval_audit_events tables (Phase 3D.4)',
    upSql: `
      CREATE TABLE IF NOT EXISTS case_approvals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(100) NOT NULL,
        case_id UUID NOT NULL,
        recommendation_id VARCHAR(64) NOT NULL,
        action_id VARCHAR(100) NOT NULL,
        action_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
        case_version INTEGER NOT NULL,
        evidence_fingerprint VARCHAR(64) NOT NULL,
        canonical_binding_hash VARCHAR(64) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING_APPROVAL',
        requested_by VARCHAR(100) NOT NULL,
        decided_by VARCHAR(100),
        decision_reason TEXT,
        decision_timestamp TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT fk_case_approvals_tenant FOREIGN KEY (case_id, merchant_id)
          REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT,
        CONSTRAINT chk_case_approvals_status CHECK (
          status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED')
        )
      );

      CREATE INDEX IF NOT EXISTS idx_case_approvals_case ON case_approvals(case_id, merchant_id);
      CREATE INDEX IF NOT EXISTS idx_case_approvals_status ON case_approvals(merchant_id, status);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_case_approvals_pending ON case_approvals(merchant_id, case_id, recommendation_id, canonical_binding_hash)
      WHERE status = 'PENDING_APPROVAL';

      CREATE TABLE IF NOT EXISTS approval_audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(100) NOT NULL,
        case_id UUID NOT NULL,
        approval_id UUID NOT NULL REFERENCES case_approvals(id) ON DELETE RESTRICT,
        actor_id VARCHAR(100) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        canonical_payload JSONB NOT NULL,
        previous_event_hash VARCHAR(64) NOT NULL,
        event_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_approval_audit_event_type CHECK (
          event_type IN (
            'APPROVAL_REQUESTED',
            'APPROVAL_GRANTED',
            'APPROVAL_REJECTED',
            'APPROVAL_EXPIRED',
            'APPROVAL_INVALIDATED',
            'APPROVAL_STALE'
          )
        )
      );

      CREATE INDEX IF NOT EXISTS idx_approval_audit_approval ON approval_audit_events(approval_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_approval_audit_case ON approval_audit_events(case_id, created_at ASC);

      CREATE OR REPLACE FUNCTION prevent_approval_audit_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'approval_audit_events is append-only: % operation is strictly forbidden on tamper-evident audit trail', TG_OP
          USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_update ON approval_audit_events;
      CREATE TRIGGER trg_prevent_approval_audit_update
      BEFORE UPDATE ON approval_audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_approval_audit_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_delete ON approval_audit_events;
      CREATE TRIGGER trg_prevent_approval_audit_delete
      BEFORE DELETE ON approval_audit_events
      FOR EACH ROW EXECUTE FUNCTION prevent_approval_audit_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_truncate ON approval_audit_events;
      CREATE TRIGGER trg_prevent_approval_audit_truncate
      BEFORE TRUNCATE ON approval_audit_events
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_approval_audit_mutation();

      CREATE OR REPLACE FUNCTION prevent_case_approvals_deletion()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'case_approvals does not allow % operation: approvals are permanent records', TG_OP
          USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_case_approvals_delete ON case_approvals;
      CREATE TRIGGER trg_prevent_case_approvals_delete
      BEFORE DELETE ON case_approvals
      FOR EACH ROW EXECUTE FUNCTION prevent_case_approvals_deletion();

      DROP TRIGGER IF EXISTS trg_prevent_case_approvals_truncate ON case_approvals;
      CREATE TRIGGER trg_prevent_case_approvals_truncate
      BEFORE TRUNCATE ON case_approvals
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_approvals_deletion();
    `,
    downSql: `
      DROP TRIGGER IF EXISTS trg_prevent_case_approvals_truncate ON case_approvals;
      DROP TRIGGER IF EXISTS trg_prevent_case_approvals_delete ON case_approvals;
      DROP FUNCTION IF EXISTS prevent_case_approvals_deletion();

      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_truncate ON approval_audit_events;
      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_delete ON approval_audit_events;
      DROP TRIGGER IF EXISTS trg_prevent_approval_audit_update ON approval_audit_events;
      DROP FUNCTION IF EXISTS prevent_approval_audit_mutation();

      DROP TABLE IF EXISTS approval_audit_events;
      DROP TABLE IF EXISTS case_approvals;
    `,
  },
  {
    version: '014_case_executions',
    name: 'Add case_executions and extend approval_audit_events for controlled execution (Phase 3D.5)',
    upSql: `
      ALTER TABLE approval_audit_events DROP CONSTRAINT IF EXISTS chk_approval_audit_event_type;
      ALTER TABLE approval_audit_events ADD CONSTRAINT chk_approval_audit_event_type CHECK (
        event_type IN (
          'APPROVAL_REQUESTED',
          'APPROVAL_GRANTED',
          'APPROVAL_REJECTED',
          'APPROVAL_EXPIRED',
          'APPROVAL_INVALIDATED',
          'APPROVAL_STALE',
          'EXECUTION_REQUESTED',
          'EXECUTION_SIMULATED',
          'EXECUTION_SUCCEEDED',
          'EXECUTION_FAILED',
          'EXECUTION_BLOCKED'
        )
      );

      CREATE TABLE IF NOT EXISTS case_executions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id VARCHAR(100) NOT NULL,
        case_id UUID NOT NULL REFERENCES exception_cases(id) ON DELETE RESTRICT,
        approval_id UUID NOT NULL REFERENCES case_approvals(id) ON DELETE RESTRICT,
        recommendation_id VARCHAR(100) NOT NULL,
        action_id VARCHAR(100) NOT NULL,
        execution_mode VARCHAR(50) NOT NULL DEFAULT 'DRY_RUN',
        idempotency_key VARCHAR(200) NOT NULL,
        parameter_hash CHAR(64) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
        result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_code VARCHAR(100),
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT chk_execution_mode CHECK (
          execution_mode IN ('DRY_RUN', 'PAYPAL_SANDBOX', 'LIVE')
        ),
        CONSTRAINT chk_execution_status CHECK (
          status IN ('PENDING', 'VALIDATING', 'SIMULATED', 'SUCCEEDED', 'FAILED', 'BLOCKED')
        )
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_case_executions_idempotency 
        ON case_executions(merchant_id, idempotency_key);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_case_executions_active_approval 
        ON case_executions(approval_id) 
        WHERE status IN ('SIMULATED', 'SUCCEEDED');

      CREATE INDEX IF NOT EXISTS idx_case_executions_case 
        ON case_executions(case_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_case_executions_approval 
        ON case_executions(approval_id, created_at DESC);

      CREATE OR REPLACE FUNCTION prevent_case_executions_deletion()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'case_executions does not allow % operation: execution records are immutable financial audit records', TG_OP
          USING ERRCODE = '23514';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_case_executions_delete ON case_executions;
      CREATE TRIGGER trg_prevent_case_executions_delete
      BEFORE DELETE ON case_executions
      FOR EACH ROW EXECUTE FUNCTION prevent_case_executions_deletion();

      DROP TRIGGER IF EXISTS trg_prevent_case_executions_truncate ON case_executions;
      CREATE TRIGGER trg_prevent_case_executions_truncate
      BEFORE TRUNCATE ON case_executions
      FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_executions_deletion();

      CREATE OR REPLACE FUNCTION prevent_terminal_execution_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        IF OLD.status IN ('SIMULATED', 'SUCCEEDED', 'FAILED', 'BLOCKED') THEN
          RAISE EXCEPTION 'case_executions is immutable once in terminal state %', OLD.status
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_prevent_terminal_execution_update ON case_executions;
      CREATE TRIGGER trg_prevent_terminal_execution_update
      BEFORE UPDATE ON case_executions
      FOR EACH ROW EXECUTE FUNCTION prevent_terminal_execution_mutation();
    `,
    downSql: `
      DROP TRIGGER IF EXISTS trg_prevent_terminal_execution_update ON case_executions;
      DROP FUNCTION IF EXISTS prevent_terminal_execution_mutation();

      DROP TRIGGER IF EXISTS trg_prevent_case_executions_truncate ON case_executions;
      DROP TRIGGER IF EXISTS trg_prevent_case_executions_delete ON case_executions;
      DROP FUNCTION IF EXISTS prevent_case_executions_deletion();

      DROP TABLE IF EXISTS case_executions;

      ALTER TABLE approval_audit_events DROP CONSTRAINT IF EXISTS chk_approval_audit_event_type;
      ALTER TABLE approval_audit_events ADD CONSTRAINT chk_approval_audit_event_type CHECK (
        event_type IN (
          'APPROVAL_REQUESTED',
          'APPROVAL_GRANTED',
          'APPROVAL_REJECTED',
          'APPROVAL_EXPIRED',
          'APPROVAL_INVALIDATED',
          'APPROVAL_STALE'
        )
      );
    `,
  },
];

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarQuote = false;
  let inSingleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i + 1 < sql.length ? sql[i + 1] : '';

    if (!inDollarQuote && char === "'" && (i === 0 || sql[i - 1] !== '\\')) {
      inSingleQuote = !inSingleQuote;
    } else if (!inSingleQuote && char === '$' && nextChar === '$') {
      inDollarQuote = !inDollarQuote;
      current += '$$';
      i++;
      continue;
    }

    if (char === ';' && !inDollarQuote && !inSingleQuote) {
      const trimmed = current.trim();
      const stripped = trimmed.replace(/--.*$/gm, '').trim();
      if (stripped.length > 0) {
        statements.push(trimmed);
      }
      current = '';
    } else {
      current += char;
    }
  }

  const remaining = current.trim();
  const strippedRemaining = remaining.replace(/--.*$/gm, '').trim();
  if (strippedRemaining.length > 0) {
    statements.push(remaining);
  }

  return statements;
}

/**
 * Runs all pending database migrations in transaction boundaries.
 */
export async function runMigrations(customPool?: Pool): Promise<{
  applied: string[];
  alreadyApplied: string[];
}> {
  const pool = customPool || getPool();
  const client: PoolClient = await pool.connect();

  const applied: string[] = [];
  const alreadyApplied: string[] = [];

  try {
    // 1. Ensure schema_migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 2. Query already applied migrations
    const res = await client.query('SELECT version FROM schema_migrations ORDER BY version ASC');
    const appliedSet = new Set(res.rows.map((r) => r.version));

    // 3. Apply pending migrations
    for (const migration of MIGRATIONS) {
      if (appliedSet.has(migration.version)) {
        alreadyApplied.push(migration.version);
        continue;
      }

      await client.query('BEGIN');
      try {
        const statements = splitSqlStatements(migration.upSql);
        for (const statement of statements) {
          await client.query(statement);
        }
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        await client.query('COMMIT');
        applied.push(migration.version);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${migration.version} failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return { applied, alreadyApplied };
  } finally {
    client.release();
  }
}

/**
 * Rolls back a specific migration by version.
 */
export async function rollbackMigration(version: string, customPool?: Pool): Promise<boolean> {
  const pool = customPool || getPool();
  const client: PoolClient = await pool.connect();

  try {
    const migration = MIGRATIONS.find((m) => m.version === version);
    if (!migration) {
      throw new Error(`Migration ${version} not found in registry.`);
    }

    const check = await client.query('SELECT version FROM schema_migrations WHERE version = $1', [
      version,
    ]);
    if (check.rows.length === 0) {
      return false; // Not applied
    }

    await client.query('BEGIN');
    try {
      const statements = splitSqlStatements(migration.downSql);
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(
        `Rollback of ${version} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } finally {
    client.release();
  }
}
