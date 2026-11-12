# Phase 3C.1 Implementation Report: Persistent Storage Foundation & PayPal Transaction Provenance

**Milestone:** Phase 3C.1  
**Project:** CloseLoop — AI-Powered PayPal Payment Reconciliation & Exception Resolution  
**Status:** COMPLETE & VERIFIED  
**Date:** November 9, 2026  
**Author:** Principal Financial Systems Architect, Senior TypeScript Engineer, Database Architect  

---

## 1. Executive Summary

Phase 3C.1 establishes a durable, auditable, and idempotent persistence foundation for PayPal transaction ingestion into CloseLoop. This persistence architecture bridges external PayPal Sandbox Transaction Search records (`GET /api/paypal/transactions` from Phase 3B) with CloseLoop's financial reconciliation engine (Phase 2A) while maintaining strict system immutability and financial auditability.

### Non-Negotiable Boundaries Maintained
1. **Phase 2A Absolute Immutability:**
   - `src/lib/reconciliation/matcher/**` — 100% untouched.
   - `src/lib/reconciliation/importer/**` — 100% untouched.
   - `src/lib/reconciliation/fixtures/**` — 100% untouched.
   - `src/lib/reconciliation/money.ts` — 100% untouched.
   - `src/types/financial.ts` — 100% untouched.
   - `src/lib/validation/schemas.ts` — 100% untouched.
   - Kuhn maximum-cardinality matching algorithm and all 140 baseline Phase 2A tests preserved.
2. **Phase 3A / 3B Normalizer Immutability:**
   - `src/lib/paypal/auth.ts`, `src/lib/paypal/normalizer.ts`, `src/lib/paypal/transactionSchemas.ts`, and `src/lib/paypal/transactionSearch.ts` remain completely untouched.
3. **Out-of-Scope Capabilities Excluded:**
   - Zero webhooks (Phase 3D).
   - Zero live financial execution / refund / capture actions (Phase 5).
   - Zero AI resolution / agent invocations (Phase 4).
   - Zero automated reconciliation execution (reserved for Phase 3C.2).
   - Zero production PayPal endpoints (Sandbox strictly enforced).

---

## 2. Database Architecture Decision & Rationale

### Evaluated Alternatives
1. **SQLite (`better-sqlite3`):**
   - *Consideration:* Embedded file database.
   - *Limitation:* Requires native C++ compilation (`node-gyp`), which frequently encounters toolchain mismatch issues on Windows systems with Node.js 26 and Next.js Turbopack.
2. **PostgreSQL (`pg` / `node-postgres`):**
   - *Decision:* **Selected.**
   - *Rationale:*
     - Local PostgreSQL 18 service (`postgresql-x64-18`) is active on the host environment.
     - `pg` is 100% pure JavaScript with zero native compilation hurdles on Windows.
     - Robust enterprise ACID compliance, native `BIGINT` support for integer minor units, atomic transaction handling, and schema migrations.
     - High-performance connection pooling via `pg.Pool`.
3. **Hermetic Test Emulator (`pg-mem`):**
   - *Decision:* In-memory PostgreSQL instance for hermetic Vitest automated testing.
   - *Rationale:* Allows CI/CD and developer test suites to run completely isolated, reproducible, fast, and credential-free without requiring an active external database connection.

---

## 3. Database Schema & Migration Architecture

### Entity-Relationship Diagram

```mermaid
erDiagram
    import_runs ||--o{ paypal_imported_transactions : "imports (first & last)"
    import_runs ||--o{ paypal_rejected_records : "quarantines"
    import_runs ||--o{ identity_collision_logs : "records"

    import_runs {
        uuid id PK
        timestamptz started_at
        timestamptz completed_at
        text status
        timestamptz window_start
        timestamptz window_end
        text trigger_mode
        integer total_fetched
        integer imported_new
        integer updated_seen
        integer rejected_count
        integer collision_count
        text error_message
    }

    paypal_imported_transactions {
        uuid id PK
        text fingerprint UK
        text paypal_transaction_id
        text transaction_event_code
        text transaction_status
        timestamptz transaction_initiation_date
        timestamptz transaction_updated_date
        text currency
        bigint gross_amount_minor
        bigint fee_amount_minor
        bigint net_amount_minor
        text payer_email
        text payer_name
        text invoice_id
        text custom_field
        text reference_id
        text event_type
        boolean reconciliation_eligible
        text identity_collision_status
        uuid first_import_run_id FK
        uuid last_import_run_id FK
        timestamptz first_observed_at
        timestamptz last_observed_at
        jsonb raw_payload
    }

    paypal_rejected_records {
        uuid id PK
        uuid import_run_id FK
        text raw_paypal_id
        text rejection_reason
        text error_code
        jsonb raw_payload
        timestamptz rejected_at
    }

    identity_collision_logs {
        uuid id PK
        uuid import_run_id FK
        text fingerprint
        text raw_paypal_id
        text resolution_applied
        jsonb collided_payload
        timestamptz logged_at
    }
```

### Schema Features & Constraints
1. **`schema_migrations`:**
   - Tracks applied migration versions with checksums and execution timestamps to ensure migration idempotency.
2. **`import_runs`:**
   - Records metadata for every fetch execution: time window (`window_start`, `window_end`), trigger mode (`MANUAL`, `SCHEDULED`, `WEBHOOK_POLL`), and aggregate counts.
3. **`paypal_imported_transactions`:**
   - Stores normalized transactions with strict integer minor-unit amounts (`gross_amount_minor`, `fee_amount_minor`, `net_amount_minor`).
   - `UNIQUE (fingerprint)` constraint ensures zero financial duplicate records.
   - Dual-run tracking: `first_import_run_id` and `last_import_run_id` track record provenance across repeated poll cycles.
   - `reconciliation_eligible` boolean flag explicitly partitions settlement-eligible records from holds, authorizations, reversals, and unconfirmed events.
4. **`paypal_rejected_records`:**
   - Records failing runtime schema validation are safely quarantined without failing the entire batch run.
5. **`identity_collision_logs`:**
   - Audits any collision (e.g., duplicate reporting lines within the same PayPal response) for manual and compliance inspection.

### Migrations
- **Up Migration:** `src/lib/db/migrations/001_initial_schema.sql`
- **Down Migration:** `src/lib/db/migrations/001_initial_schema_down.sql`
- **Runner:** `src/lib/db/migrator.ts` (executes migration steps in atomic transactions).

---

## 4. Financial Semantics, Idempotency & Eligibility

### Idempotent Provenance Ingestion
- **Fingerprint Contract:**
  ```typescript
  `PP_${rawTxnId}:${eventCode}:${transactionStatus}:${transactionTime}:${currency}_${amount}${refSuffix}`
  ```
- **Re-observation Semantics:**
  When a transaction with an identical fingerprint is re-ingested:
  1. No duplicate financial row is inserted.
  2. Financial values (`gross_amount_minor`, `fee_amount_minor`, `net_amount_minor`, `currency`) are **never mutated**.
  3. Provenance metadata is updated: `last_observed_at = NOW()`, `last_import_run_id = currentRunId`.
  4. The import run increments `updated_seen` count rather than `imported_new`.

### Reconciliation Eligibility Gate (`determineReconciliationEligibility`)
Strictly guarantees Phase 2A settlement rules before any transaction enters the reconciliation pipeline:
- **`CAPTURE`**:
  - `status === 'COMPLETED'` and `gross_amount_minor > 0` $\rightarrow$ `reconciliation_eligible = true`
  - `status !== 'COMPLETED'` (e.g. `PENDING`, `DENIED`) $\rightarrow$ `reconciliation_eligible = false`
- **`REFUND`**:
  - `status === 'COMPLETED'` $\rightarrow$ `reconciliation_eligible = true` (links to parent capture per Phase 2A settlement rules)
  - `status !== 'COMPLETED'` $\rightarrow$ `reconciliation_eligible = false`
- **`AUTHORIZATION`**:
  - Uncaptured holds $\rightarrow$ `reconciliation_eligible = false` (does not affect merchant settlement ledger until captured)
- **`DISPUTE_HOLD` / `REVERSAL`**:
  - Operational exceptions $\rightarrow$ `reconciliation_eligible = false`
- **`QUARANTINED` / `REJECTED`**:
  - Suspicious or duplicated items $\rightarrow$ `reconciliation_eligible = false`

### Intra-Batch Collision Handling
If a single PayPal response contains multiple records producing the same fingerprint:
- First occurrence is inserted.
- Subsequent occurrences in the same batch are marked `identity_collision_status = 'QUARANTINED'`, set to `reconciliation_eligible = false`, and logged in `identity_collision_logs`.

---

## 5. Security & Isolation Controls

1. **Server-Only Isolation:**
   - `src/lib/db/pool.ts` imports `'server-only'` to guarantee connection logic and database credentials cannot leak into client bundles.
2. **Credential Sanitization:**
   - `maskDatabaseUrl(url)` redacts database passwords in connection error logs (e.g. `postgresql://postgres:***@localhost:5432/closeloop`).
3. **No Silent In-Memory Fallback in Production:**
   - `DatabaseConfigurationError` is explicitly thrown if `DATABASE_URL` is missing when attempting a real pool connection. Test-only in-memory mocks are strictly confined to test harnesses via `setTestPool`.
4. **Parameterized Queries:**
   - 100% of SQL statements across all repositories use parameterized variables (`$1`, `$2`, ...) to prevent SQL injection.

---

## 6. Implementation Artifacts Created

| File | Purpose |
|------|---------|
| `src/lib/db/types.ts` | Domain persistence types, record interfaces, and status enums |
| `src/lib/db/config.ts` | Zod validation for connection parameters and password masking |
| `src/lib/db/pool.ts` | Connection pool manager, health checks, and server-only guard |
| `src/lib/db/migrations/001_initial_schema.sql` | Up migration DDL (tables, constraints, indexes) |
| `src/lib/db/migrations/001_initial_schema_down.sql` | Down migration DDL (idempotent drops) |
| `src/lib/db/migrator.ts` | Programmatic migration engine with version tracking |
| `src/lib/db/eligibility.ts` | Pure financial settlement eligibility gate |
| `src/lib/db/repositories/importRunRepository.ts` | Import run lifecycle management |
| `src/lib/db/repositories/paypalTransactionRepository.ts` | Idempotent transaction persistence and lookup |
| `src/lib/db/repositories/rejectedRecordRepository.ts` | Malformed record quarantine logging |
| `src/lib/db/repositories/collisionLogRepository.ts` | Collision audit logging repository |
| `src/lib/db/provenanceService.ts` | End-to-end ingestion orchestrator with transaction rollback |
| `src/lib/db/testHarness.ts` | Vitest `pg-mem` isolated test harness with rollback emulation |
| `src/lib/db/__tests__/database.test.ts` | 16 comprehensive unit and integration tests |
| `docs/PHASE_3C_1_PERSISTENCE_REPORT.md` | Authoritative documentation deliverable |

---

## 7. Verification & Quality Gates

### 1. Vitest Suite
```
 RUN  v5.1.0 C:/MY PROGRAMMING/closeloop

 ✓ src/lib/reconciliation/__tests__/final_remediations.test.ts (32 tests)
 ✓ src/lib/reconciliation/__tests__/adversarial.test.ts (7 tests)
 ✓ src/lib/reconciliation/__tests__/matcher.test.ts (15 tests)
 ✓ src/lib/reconciliation/__tests__/money.test.ts (30 tests)
 ✓ src/lib/paypal/__tests__/paypalClient.test.ts (4 tests)
 ✓ src/lib/reconciliation/__tests__/fixtures.test.ts (5 tests)
 ✓ src/lib/reconciliation/__tests__/importer.test.ts (9 tests)
 ✓ src/lib/reconciliation/__tests__/phase2a_final_audit.test.ts (13 tests)
 ✓ src/lib/paypal/__tests__/auth.test.ts (26 tests)
 ✓ src/lib/reconciliation/__tests__/workbench.test.ts (14 tests)
 ✓ src/lib/paypal/__tests__/transactionSearch.test.ts (46 tests)
 ✓ src/lib/reconciliation/__tests__/regression.test.ts (29 tests)
 ✓ src/lib/db/__tests__/database.test.ts (16 tests)

 Test Files  13 passed (13)
      Tests  246 passed (246)
   Duration  1.57s
```

### 2. TypeScript Compilation Check
`npx tsc --noEmit` exited with code 0 (zero errors).

### 3. Next.js Turbopack Production Build
All 20 routes compile cleanly with zero server/client leakage and zero type errors.

---

## 8. Status & Handoff

Phase 3C.1 is complete and verified. The persistence foundation is ready for:
- **Phase 3C.2 (Reconciliation Persistence & Ingestion Pipeline):** Feeding durable eligible transactions into the Kuhn reconciliation engine.
- **Phase 3C.3 (Historical Audit Trail & Discrepancy Snapshots):** Persisting match results, discrepancy states, and operator overrides.

**Current State:** Fully tested, hermetic, frozen boundaries intact. Implementation halted pending user authorization for next milestone.

