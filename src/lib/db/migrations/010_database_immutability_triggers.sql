-- Migration 010: Database Immutability Triggers (F-25)
-- CloseLoop Phase 3D.1 Security Hardening: Evidence Immutability Triggers
-- Replaces silent DO INSTEAD NOTHING rules with active exception-raising triggers
-- preventing UPDATE, DELETE, and TRUNCATE on financial evidence items.

-- 1. Drop legacy rules if present
DROP RULE IF EXISTS no_update_case_evidence ON case_evidence_items;
DROP RULE IF EXISTS no_delete_case_evidence ON case_evidence_items;

-- 2. Create trigger function that explicitly raises integrity violations
CREATE OR REPLACE FUNCTION prevent_case_evidence_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case_evidence_items is immutable: % operation is strictly forbidden on financial evidence audit trail', TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

-- 3. Install BEFORE UPDATE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_evidence_update ON case_evidence_items;
CREATE TRIGGER trg_prevent_case_evidence_update
BEFORE UPDATE ON case_evidence_items
FOR EACH ROW EXECUTE FUNCTION prevent_case_evidence_mutation();

-- 4. Install BEFORE DELETE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_evidence_delete ON case_evidence_items;
CREATE TRIGGER trg_prevent_case_evidence_delete
BEFORE DELETE ON case_evidence_items
FOR EACH ROW EXECUTE FUNCTION prevent_case_evidence_mutation();

-- 5. Install BEFORE TRUNCATE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_evidence_truncate ON case_evidence_items;
CREATE TRIGGER trg_prevent_case_evidence_truncate
BEFORE TRUNCATE ON case_evidence_items
FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_evidence_mutation();

-- 6. Revoke modification privileges from PUBLIC
REVOKE UPDATE, DELETE, TRUNCATE ON case_evidence_items FROM PUBLIC;

