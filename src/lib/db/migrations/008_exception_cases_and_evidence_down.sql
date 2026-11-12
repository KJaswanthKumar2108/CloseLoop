-- Migration 008 Down: Safe Non-Cascading Drop Procedure
-- Automatic destructive drops with CASCADE are removed to prevent accidental data destruction (F-27).
-- In production, forward corrective migrations must be used rather than table dropping.

DROP TABLE IF EXISTS case_evidence_items;
DROP TABLE IF EXISTS exception_cases;
