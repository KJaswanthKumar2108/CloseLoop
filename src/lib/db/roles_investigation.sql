-- CloseLoop Phase 3D.2 Security Remediation: Genuine Runtime Role Separation (F-33)
-- Provisions dedicated LOGIN identities with least-privilege permissions:
-- 1. closeloop_investigation_reader:
--    Read-only role for building investigation context and reading history.
--    Possesses ZERO INSERT, UPDATE, DELETE, or TRUNCATE permissions on any table.
-- 2. closeloop_investigation_auditor:
--    Append-only role for persisting investigation audit trails.
--    Can INSERT into case_investigations and SELECT from exception_cases (for FK checks).
--    Possesses ZERO modification authority over financial data or exception cases.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'closeloop_investigation_reader') THEN
    CREATE ROLE closeloop_investigation_reader WITH LOGIN PASSWORD 'ReaderPass_184_Secure!';
  ELSE
    ALTER ROLE closeloop_investigation_reader WITH LOGIN;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'closeloop_investigation_auditor') THEN
    CREATE ROLE closeloop_investigation_auditor WITH LOGIN PASSWORD 'AuditorPass_184_Secure!';
  ELSE
    ALTER ROLE closeloop_investigation_auditor WITH LOGIN;
  END IF;
END $$;

-- 1. Configure Reader Role (SELECT-only on financial tables & cases, zero modification)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM closeloop_investigation_reader;
GRANT USAGE ON SCHEMA public TO closeloop_investigation_reader;
GRANT SELECT ON exception_cases, case_evidence_items, paypal_imported_transactions, import_runs, case_investigations TO closeloop_investigation_reader;

-- Explicitly revoke write access on any tables
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM closeloop_investigation_reader;

-- 2. Configure Auditor Role (INSERT on case_investigations, SELECT on parent case for FK validation)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM closeloop_investigation_auditor;
GRANT USAGE ON SCHEMA public TO closeloop_investigation_auditor;
GRANT SELECT ON exception_cases, case_investigations TO closeloop_investigation_auditor;
GRANT INSERT ON case_investigations TO closeloop_investigation_auditor;

-- Explicitly ensure NO write access on financial tables or exception cases
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON exception_cases, case_evidence_items, paypal_imported_transactions, import_runs FROM closeloop_investigation_auditor;
-- Trigger trg_prevent_case_investigations_update/delete/truncate additionally prevents UPDATE/DELETE on case_investigations
REVOKE UPDATE, DELETE, TRUNCATE ON case_investigations FROM closeloop_investigation_auditor;
