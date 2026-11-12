-- Migration 008: Exception Cases and Evidence Schema
-- CloseLoop Phase 3D.1: Exception Intelligence & Evidence Aggregation
-- Establishes durable, deterministic exception cases and immutable evidence items with tenant isolation.

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
