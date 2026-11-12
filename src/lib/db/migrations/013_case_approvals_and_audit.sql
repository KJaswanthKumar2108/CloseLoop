-- Migration 013: Case Approvals and Tamper-Evident Hash-Chained Audit Trail
-- CloseLoop Phase 3D.4: Human Approval, Cryptographic Parameter Binding & Tamper-Evident Audit

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

-- Prevent duplicate pending requests for the same recommendation and parameter binding
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

-- 1. Immutability Trigger for approval_audit_events (Strictly Append-Only)
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

-- 2. Deletion Trigger for case_approvals (Prevent DELETE or TRUNCATE)
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

