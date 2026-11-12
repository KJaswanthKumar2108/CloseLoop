-- Migration 010 Down: Revert Database Immutability Triggers
-- CloseLoop Phase 3D.1 Security Hardening: Forward-only policy.
-- Destructive operations prohibited.

DROP TRIGGER IF EXISTS trg_prevent_case_evidence_truncate ON case_evidence_items;
DROP TRIGGER IF EXISTS trg_prevent_case_evidence_delete ON case_evidence_items;
DROP TRIGGER IF EXISTS trg_prevent_case_evidence_update ON case_evidence_items;
DROP FUNCTION IF EXISTS prevent_case_evidence_mutation();

