-- Migration 012: Case Investigations Immutability Triggers & Snapshot Metadata (F-31, F-35)
-- CloseLoop Phase 3D.2 Security Remediation: Append-Only Investigation Audit Log
-- Prevents UPDATE, DELETE, and TRUNCATE on case_investigations via active PL/pgSQL triggers.
-- Adds snapshot consistency columns for stale investigation tracking.

-- 1. Add snapshot consistency columns and update status check constraint
ALTER TABLE case_investigations 
  ADD COLUMN IF NOT EXISTS is_stale BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE case_investigations 
  ADD COLUMN IF NOT EXISTS snapshot_metadata JSONB;

-- Drop existing status check constraint and re-add with STALE_SNAPSHOT support
ALTER TABLE case_investigations 
  DROP CONSTRAINT IF EXISTS chk_case_investigations_status;

ALTER TABLE case_investigations 
  ADD CONSTRAINT chk_case_investigations_status 
  CHECK (status IN ('COMPLETED', 'FAILED', 'STALE_SNAPSHOT'));

-- 2. Create trigger function that actively raises integrity violations on any mutation
CREATE OR REPLACE FUNCTION prevent_case_investigations_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'case_investigations is append-only: % operation is strictly forbidden on AI investigation audit trail', TG_OP
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

-- 3. Install BEFORE UPDATE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_update ON case_investigations;
CREATE TRIGGER trg_prevent_case_investigations_update
BEFORE UPDATE ON case_investigations
FOR EACH ROW EXECUTE FUNCTION prevent_case_investigations_mutation();

-- 4. Install BEFORE DELETE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_delete ON case_investigations;
CREATE TRIGGER trg_prevent_case_investigations_delete
BEFORE DELETE ON case_investigations
FOR EACH ROW EXECUTE FUNCTION prevent_case_investigations_mutation();

-- 5. Install BEFORE TRUNCATE trigger
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_truncate ON case_investigations;
CREATE TRIGGER trg_prevent_case_investigations_truncate
BEFORE TRUNCATE ON case_investigations
FOR EACH STATEMENT EXECUTE FUNCTION prevent_case_investigations_mutation();

-- 6. Revoke modification privileges from PUBLIC
REVOKE UPDATE, DELETE, TRUNCATE ON case_investigations FROM PUBLIC;

