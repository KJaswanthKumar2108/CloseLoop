-- Migration 009: Exception Safety & Immutability Hardening
-- CloseLoop Phase 3D.1 Security Remediation (F-24, F-25, F-26, F-27)
-- Enforces composite evidence tenant ownership, non-cascading evidence preservation,
-- database-level evidence immutability, and initial variance historical tracking.

-- 1. Add composite unique constraint on (id, merchant_id) in exception_cases (F-24)
ALTER TABLE exception_cases
  ADD CONSTRAINT uq_exception_cases_id_merchant UNIQUE (id, merchant_id);

-- 2. Add initial_variance_amount_minor column to preserve original observations (F-26)
ALTER TABLE exception_cases
  ADD COLUMN IF NOT EXISTS initial_variance_amount_minor BIGINT;

UPDATE exception_cases
SET initial_variance_amount_minor = variance_amount_minor
WHERE initial_variance_amount_minor IS NULL;

-- 3. Replace single-column foreign key with composite foreign key on (case_id, merchant_id) with ON DELETE RESTRICT (F-24, F-25)
ALTER TABLE case_evidence_items
  DROP CONSTRAINT IF EXISTS case_evidence_items_case_id_fkey;

ALTER TABLE case_evidence_items
  ADD CONSTRAINT fk_case_evidence_tenant FOREIGN KEY (case_id, merchant_id)
  REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT;

-- 4. Database-level immutability rules: Disallow UPDATE and DELETE on case_evidence_items (F-25)
CREATE OR REPLACE RULE no_update_case_evidence AS
ON UPDATE TO case_evidence_items DO INSTEAD NOTHING;

CREATE OR REPLACE RULE no_delete_case_evidence AS
ON DELETE TO case_evidence_items DO INSTEAD NOTHING;

