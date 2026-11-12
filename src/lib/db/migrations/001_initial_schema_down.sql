-- ==============================================================================
-- CloseLoop Phase 3C.1: Rollback Migration 001_initial_schema
-- ==============================================================================

DROP TABLE IF EXISTS identity_collision_logs CASCADE;
DROP TABLE IF EXISTS paypal_rejected_records CASCADE;
DROP TABLE IF EXISTS paypal_imported_transactions CASCADE;
DROP TABLE IF EXISTS import_runs CASCADE;
DELETE FROM schema_migrations WHERE version = '001_initial_schema';

