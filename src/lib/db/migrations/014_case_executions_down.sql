-- CloseLoop Phase 3D.5 Migration 014 Down
DROP TRIGGER IF EXISTS trg_prevent_terminal_execution_update ON case_executions;
DROP FUNCTION IF EXISTS prevent_terminal_execution_mutation();

DROP TRIGGER IF EXISTS trg_prevent_case_executions_truncate ON case_executions;
DROP TRIGGER IF EXISTS trg_prevent_case_executions_delete ON case_executions;
DROP FUNCTION IF EXISTS prevent_case_executions_deletion();

DROP TABLE IF EXISTS case_executions;

-- Revert approval_audit_events check constraint
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

