-- Migration 011: Case Investigations Audit Log
-- CloseLoop Phase 3D.2: Read-Only AI Investigation Engine
-- Establishes immutable, append-only investigation audit trail with strict tenant isolation.

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

