-- Migration 012 Down: Drop Immutability Triggers for case_investigations
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_truncate ON case_investigations;
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_delete ON case_investigations;
DROP TRIGGER IF EXISTS trg_prevent_case_investigations_update ON case_investigations;
DROP FUNCTION IF EXISTS prevent_case_investigations_mutation();

ALTER TABLE case_investigations DROP CONSTRAINT IF EXISTS chk_case_investigations_status;
ALTER TABLE case_investigations ADD CONSTRAINT chk_case_investigations_status CHECK (status IN ('COMPLETED', 'FAILED'));

ALTER TABLE case_investigations DROP COLUMN IF EXISTS snapshot_metadata;
ALTER TABLE case_investigations DROP COLUMN IF EXISTS is_stale;

