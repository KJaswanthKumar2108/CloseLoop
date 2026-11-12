-- Migration 011 Down: Revert Case Investigations Table
-- CloseLoop Phase 3D.2: Forward-only policy.
-- Destructive operations prohibited during normal execution.

DROP TABLE IF EXISTS case_investigations;

