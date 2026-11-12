-- Migration 013 Down: Drop Case Approvals and Tamper-Evident Hash-Chained Audit Trail

DROP TRIGGER IF EXISTS trg_prevent_case_approvals_truncate ON case_approvals;
DROP TRIGGER IF EXISTS trg_prevent_case_approvals_delete ON case_approvals;
DROP FUNCTION IF EXISTS prevent_case_approvals_deletion();

DROP TRIGGER IF EXISTS trg_prevent_approval_audit_truncate ON approval_audit_events;
DROP TRIGGER IF EXISTS trg_prevent_approval_audit_delete ON approval_audit_events;
DROP TRIGGER IF EXISTS trg_prevent_approval_audit_update ON approval_audit_events;
DROP FUNCTION IF EXISTS prevent_approval_audit_mutation();

DROP TABLE IF EXISTS approval_audit_events;
DROP TABLE IF EXISTS case_approvals;

