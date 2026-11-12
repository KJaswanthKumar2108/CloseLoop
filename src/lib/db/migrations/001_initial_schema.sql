-- ==============================================================================
-- CloseLoop Phase 3C.1: Persistent Storage Foundation & Transaction Provenance
-- Initial Schema Migration
-- ==============================================================================

-- 1. Migration History Table
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Import Runs Table
-- Tracks every batch ingestion from external provider
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

-- 3. PayPal Imported Transactions Table
-- Immutable provenance with exact integer minor units and deterministic fingerprint uniqueness
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

-- 4. PayPal Rejected Records Table
-- Quarantines non-order balance movements and malformed records with complete diagnostic reason
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

-- 5. Identity Collision Logs Table
-- Complete audit trail for ambiguous reporting rows
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

