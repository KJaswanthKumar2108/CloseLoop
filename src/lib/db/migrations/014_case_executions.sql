-- CloseLoop Phase 3D.5 Migration 014: Case Executions and Extended Audit
-- Establishes the durable controlled execution layer, idempotency controls, and execution audit events.

-- 1. Extend approval_audit_events to allow execution lifecycle events
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

-- 2. Create durable case_executions table
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

-- 3. Idempotency and Lookup Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_executions_idempotency 
  ON case_executions(merchant_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_executions_active_approval 
  ON case_executions(approval_id) 
  WHERE status IN ('SIMULATED', 'SUCCEEDED');

CREATE INDEX IF NOT EXISTS idx_case_executions_case 
  ON case_executions(case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_case_executions_approval 
  ON case_executions(approval_id, created_at DESC);

-- 4. Database Immutability Triggers for case_executions
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

-- 5. Terminal State Immutability Trigger
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

