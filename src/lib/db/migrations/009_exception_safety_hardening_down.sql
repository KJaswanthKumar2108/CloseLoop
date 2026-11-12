-- Migration 009 Down: Revert Exception Safety Hardening
-- Non-destructive rollback: Removes rules and reverts composite constraint.
-- Historical financial records and tables are preserved (F-27).

DROP RULE IF EXISTS no_delete_case_evidence ON case_evidence_items;
DROP RULE IF EXISTS no_update_case_evidence ON case_evidence_items;

ALTER TABLE case_evidence_items
  DROP CONSTRAINT IF EXISTS fk_case_evidence_tenant;

ALTER TABLE case_evidence_items
  ADD CONSTRAINT case_evidence_items_case_id_fkey FOREIGN KEY (case_id)
  REFERENCES exception_cases(id) ON DELETE RESTRICT;

ALTER TABLE exception_cases
  DROP CONSTRAINT IF EXISTS uq_exception_cases_id_merchant;

