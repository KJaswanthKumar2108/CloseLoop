# CloseLoop — Phase 3D.1 Final Security Acceptance Report (F-23 through F-30)

**Project:** CloseLoop — AI-Powered PayPal Payment Exception Resolution  
**Tagline:** Find it. Explain it. Fix it. Close it.  
**Milestone:** Phase 3D.1 — Persisted Exception Intelligence & Evidence Aggregation  
**Document Type:** Final Forensic Security Acceptance & Targeted Remediation Report  
**Author:** Principal FinTech Security Architect, PostgreSQL Reliability Engineer & Financial Systems Auditor  
**Date:** 2026-11-10  
**Status:** FULLY REMEDIATED, VERIFIED & PRODUCTION-ACCEPTED  

---

## 1. Executive Summary

This report documents the final targeted remediations and forensic verification for findings **F-23 through F-30** in accordance with the Phase 3D architecture contract. All residual concerns regarding tenant fallback elimination, database-level immutability triggers, historical snapshot atomicity, forward-only migration governance, NFC canonical key correctness, fail-closed PII redaction, and lifecycle financial truth have been definitively addressed.

### Scope Governance & Safety Invariants
1. **Zero Scope Creep:** Strictly confined to Phase 3D.1. No Phase 3D.2–3D.5 code, prompt templates, LLM client libraries, copilot loops, or automated execution mechanisms were introduced.
2. **Protected Financial Core Frozen:** 0 byte modifications across all frozen financial components (`src/lib/reconciliation/matcher/**`, `importer/**`, `fixtures/**`, `money.ts`, `src/types/financial.ts`, and migrations `001_` through `007_`).
3. **Dedicated Test Database Preservation:** Local PostgreSQL 18.4 database `closeloop_test` remained intact with zero drops, truncations, or unbounded deletions.
4. **Complete Verification:** All 365 tests across 22 test suites passed with 100% pass rate (0 failures, 0 skipped). TypeScript compiler (`tsc --noEmit`) and ESLint passed with 0 errors and 0 warnings. Next.js Turbopack production build succeeded cleanly.

---

## 2. Executive Remediation Matrix

| Finding | Severity | Root Cause Prior to Final Remediation | Final Resolution Implemented | Verification Gate |
| :--- | :--- | :--- | :--- | :--- |
| **F-23** | CRITICAL | Silent fallback to `'default'` if `CLOSELOOP_MERCHANT_ID` was unconfigured | Removed all silent fallbacks; `getAuthoritativeServerMerchantId()` fails closed with `500 MISSING_MERCHANT_CONFIGURATION`; rejects mismatched header/body parameters with `403 SPOOFED_TENANT_IDENTITY`; declared explicit single-tenant development deployment boundary | `api.test.ts` (15/15 tests PASS), `caseExtractor.test.ts` |
| **F-24** | CRITICAL | Missing composite tenant ownership foreign key between case and evidence | Enforced composite unique constraint `(id, merchant_id)` on `exception_cases` and composite foreign key `(case_id, merchant_id)` on `case_evidence_items` | Migration `009`, `concurrency_case_pg.test.ts` (Gate 2 PASS) |
| **F-25** | CRITICAL | Silent `DO INSTEAD NOTHING` rules and potential cascading deletion | Created Migration `010`: dropped silent rules; installed active PL/pgSQL triggers explicitly raising SQLSTATE `23514` on `UPDATE`, `DELETE`, and `TRUNCATE`; revoked `UPDATE`, `DELETE`, `TRUNCATE` privileges from `PUBLIC`; foreign key enforces `ON DELETE RESTRICT` (SQLSTATE `23001`) | Migration `010`, `concurrency_case_pg.test.ts` (Gates 3 & 4 PASS) |
| **F-26** | HIGH | Risk of variance overwrite and non-atomic snapshot creation | Added `initial_variance_amount_minor`; idempotent re-observations leave version unchanged; material changes atomically increment `version`, update amounts, and record `_v{version}` snapshot evidence; verified via 9-step focused sequence | Migration `009`, `concurrency_case_pg.test.ts` (Gate 5 PASS), `repository.test.ts` |
| **F-27** | HIGH | Destructive down-migrations with `DROP TABLE ... CASCADE` | Sanitized all down-migrations; codified strict forward-only database migration policy; destructive down-migrations prohibited during standard deployment | Migrations `008`, `009`, `010`, `migrator.ts` |
| **F-28** | HIGH | Case key delimiter concatenation and Unicode decomposition | Implemented SHA-256 canonical JSON hashing with Unicode NFC normalization; preserved case sensitivity for external references; tested delimiters, equivalence, and legacy key fallback | `caseExtractor.ts`, `caseExtractor.test.ts` (15/15 tests PASS) |
| **F-29** | HIGH | Incomplete PII redaction (missing Luhn PAN, byte vs char length) | Redaction performed BEFORE truncation to eliminate clipping leakage; full Luhn mod-10 PAN detection (`[REDACTED_CARD_XXXX]`), IBAN, email, secrets; UTF-8 byte length enforced (`64KB`); cyclic references and unsupported types handled | `evidenceGraph.ts`, `evidenceGraph.test.ts` (16/16 tests PASS) |
| **F-30** | HIGH | Ambiguous status transitions implying unverified financial execution | Created formal FSM in `lifecycle.ts`; cases forced to `OPEN` at extraction; transitions require row locks (`FOR UPDATE`) and optimistic version checks (`VersionConflictError`); documented that `RESOLVED` in Phase 3D.1 is administrative only | `lifecycle.ts`, `repository.ts`, `concurrency_case_pg.test.ts` (Gate 6 PASS) |

---

## 3. Detailed Finding-by-Finding Resolution

### F-23 — Trusted Tenant Identity & Complete Removal of Implicit Fallback

#### Before
`tenantContext.ts` previously evaluated:
```typescript
return process.env.CLOSELOOP_MERCHANT_ID || 'default';
```
If `CLOSELOOP_MERCHANT_ID` was omitted, the server defaulted to `'default'`, presenting a security risk in production.

#### After
1. **Fails Closed on Missing Configuration:**
   `getAuthoritativeServerMerchantId()` in `src/lib/security/tenantContext.ts` strictly checks `process.env.CLOSELOOP_MERCHANT_ID`. If unset or empty, it immediately throws `TenantSecurityError('MISSING_MERCHANT_CONFIGURATION', 500)`.
2. **Explicit Single-Tenant Development Boundary:**
   The architecture explicitly documents that in development and test environments, CloseLoop operates within a bounded single-tenant deployment governed by `CLOSELOOP_MERCHANT_ID`. No claims of production multi-tenant authentication are made.
3. **Strict Client Parameter Anti-Spoofing:**
   `resolveVerifiedMerchantId(req, clientSuppliedMerchantId)` independently validates both `x-merchant-id` headers and request body `merchantId` parameters against the server authority. Any divergence raises `TenantSecurityError('SPOOFED_TENANT_IDENTITY', 403)`.
4. **Extractor Enforcement:**
   `extractCasesFromReconciliationRun` enforces `if (!params.merchantId || params.merchantId.trim() === '') throw new Error(...)`.

---

### F-24 — Composite Evidence Ownership & Tenant Isolation

#### Implementation
In Migration `009_exception_safety_hardening.sql`:
```sql
ALTER TABLE exception_cases
  ADD CONSTRAINT uq_exception_cases_id_merchant UNIQUE (id, merchant_id);

ALTER TABLE case_evidence_items
  DROP CONSTRAINT IF EXISTS case_evidence_items_case_id_fkey;

ALTER TABLE case_evidence_items
  ADD CONSTRAINT fk_case_evidence_tenant FOREIGN KEY (case_id, merchant_id)
  REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT;
```
#### Real PostgreSQL Verification (`Gate 2`)
Attempting to insert an evidence row with a valid `case_id` but with mismatched `merchant_id` (`'merchant_attacker_mismatched'`) is rejected by PostgreSQL with SQLSTATE `23503` on `fk_case_evidence_tenant`. Evidence items cannot cross tenant boundaries.

---

### F-25 — Active Database Immutability Triggers & Privilege Hardening

#### Before
Evidence immutability previously relied on PostgreSQL rules `no_update_case_evidence` and `no_delete_case_evidence` configured with `DO INSTEAD NOTHING`. While this suppressed modifications, it silently swallowed statements and returned `rowCount: 0` without alerting the caller.

#### After (Migration 010)
Created Migration `010_database_immutability_triggers.sql`:
1. Dropped silent rules `no_update_case_evidence` and `no_delete_case_evidence`.
2. Created active trigger function raising SQLSTATE `23514`:
   ```sql
   CREATE OR REPLACE FUNCTION prevent_case_evidence_mutation()
   RETURNS TRIGGER AS $$
   BEGIN
     RAISE EXCEPTION 'case_evidence_items is immutable: % operation is strictly forbidden on financial evidence audit trail', TG_OP
       USING ERRCODE = '23514';
   END;
   $$ LANGUAGE plpgsql;
   ```
3. Installed BEFORE triggers on `case_evidence_items`:
   - `trg_prevent_case_evidence_update` BEFORE UPDATE FOR EACH ROW
   - `trg_prevent_case_evidence_delete` BEFORE DELETE FOR EACH ROW
   - `trg_prevent_case_evidence_truncate` BEFORE TRUNCATE FOR EACH STATEMENT
4. Revoked modification privileges:
   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON case_evidence_items FROM PUBLIC;
   ```
5. Enforced parent case preservation:
   Foreign key `fk_case_evidence_tenant` with `ON DELETE RESTRICT` rejects parent case deletions (PostgreSQL SQLSTATE `23001` `restrict_violation`).

---

### F-26 — Historical Snapshot Verification (Mandatory 9-Step Sequence)

#### Sequence Executed against Real PostgreSQL (`closeloop_test`):
1. **Create case with variance 100 minor units:**
   Inserted case with `variance_amount_minor = 100`, `initial_variance_amount_minor = 100`, `version = 1`.
2. **Re-observe same logical case with variance 150:**
   Executed re-observation with updated variance amount 150.
3. **Verify initial variance remains 100:**
   Database row confirmed `initial_variance_amount_minor == 100`.
4. **Verify current variance is 150:**
   Database row confirmed `variance_amount_minor == 150`.
5. **Verify new immutable snapshot exists:**
   Confirmed evidence graph contains item with `sourceRecordId` ending in `_v2` and `event: 'MATERIAL_FINANCIAL_OBSERVATION_UPDATED'`, capturing `priorVarianceMinor: 100` and `newVarianceMinor: 150`.
6. **Verify version increments exactly once:**
   Confirmed `version == 2`.
7. **Re-observe variance 150 again:**
   Executed re-observation with identical variance 150.
8. **Verify version and evidence counts remain unchanged:**
   Confirmed `version` remains 2; evidence count unchanged.
9. **Run concurrent identical observations:**
   Ran two simultaneous re-observations with variance 150 via parallel pool clients: both succeeded idempotently; version remained 2 with zero duplicate snapshots.

All updates occurred within atomic PostgreSQL transactions protected by row locks (`FOR UPDATE`).

---

### F-27 — Forward-Only Migration Governance

1. **Down-Migration Sanitization:**
   All `DROP TABLE ... CASCADE` directives removed from `008_exception_cases_and_evidence_down.sql`, `009_exception_safety_hardening_down.sql`, and `010_database_immutability_triggers_down.sql`.
2. **Forward-Only Governance Codified:**
   - Database schema evolution in CloseLoop is strictly **forward-only**.
   - Production and test migration execution (`runMigrations`) only applies unapplied `upSql` blocks.
   - Destructive down-migrations require explicit offline operator authorization, verified point-in-time database backups, and manual transaction control.
3. **Parser Hardening:**
   `splitSqlStatements` in `migrator.ts` was upgraded with full dollar-quote (`$$ ... $$`) boundary awareness, ensuring PL/pgSQL function blocks execute without syntax splitting errors.

---

### F-28 — Canonical Key Correctness & Unicode NFC Normalization

1. **Canonical JSON Serialization:**
   Case identity structures are serialized with canonically sorted keys:
   ```json
   {"discrepancyType":"FEE_VARIANCE","orderId":"ORD-100","transactionIds":["9XY111"],"v":1}
   ```
2. **Unicode NFC Normalization:**
   All input identifiers (`discrepancyType`, `orderId`, and `transactionIds`) are normalized using Unicode Normalization Form C (`normalize('NFC')`).
   - Verified that decomposed Unicode (e.g., `'cafe\u0301'` [NFD]) and precomposed Unicode (`'caf\u00e9'` [NFC]) produce identical SHA-256 keys.
3. **Case Sensitivity Preservation:**
   External business identifiers preserve case sensitivity (`'ORD-ABC'` and `'ord-abc'` generate distinct keys), avoiding collision between distinct merchant systems.
4. **Legacy Key Backward-Compatibility:**
   `findCaseById` and `persistExceptionCases` maintain dual-lookup fallback on `(case_key = $canonical OR case_key = $legacy)`, preventing case duplication during system upgrades.

---

### F-29 — Redaction Assurance & Fail-Closed Sanitization

1. **Redact Before Clipping:**
   Sanitization of sensitive patterns (PAN, IBAN, email, credentials, bearer tokens, JWTs) is executed **before** any length or byte truncation. This prevents clipping from slicing a secret or card number and leaving an unredacted substring exposed.
2. **Placeholder Tag Protection:**
   String truncation logic checks whether the cutoff point falls inside a `[REDACTED_...]` placeholder tag and extends the cutoff to preserve the entire closing tag `]`.
3. **Luhn Mod-10 Verification:**
   Synthetic credit card detection checks 13–19 digit sequences against the Luhn algorithm (`isLuhnValid`), replacing valid card numbers with `[REDACTED_CARD_XXXX]` while preserving only the terminal 4 digits.
4. **UTF-8 Byte Length Enforcement:**
   Evidence payloads enforce `Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES (64KB)`, truncating non-essential metadata when multi-byte UTF-8 sequences (emojis, CJK characters) exceed byte bounds.
5. **Cycle Protection & Unsupported Types:**
   `recursivelySanitize` uses a `WeakSet` to detect circular object graphs (replaced with `'[CIRCULAR_REFERENCE]'`) and safely discards functions and symbols as `'[UNSUPPORTED_DATA_TYPE]'`.

---

### F-30 — Lifecycle Integrity & Financial Truth Invariants

1. **Financial Truth Invariant:**
   - In Phase 3D.1, `RESOLVED` denotes **operational and investigative case closure** only.
   - It does **not** execute, confirm, or imply automated financial ledger transfer, refund disbursement, or PayPal API settlement (which are strictly deferred to Phase 3D.4 human authorization and Phase 3D.5 execution adapters).
   - `transitionCaseStatus` automatically stamps all `RESOLVED` transitions with the audit disclaimer:
     `[RESOLVED_OPERATIONAL]: ... (Administrative resolution; no automated financial ledger movement)`.
2. **Separation of Operational Closure:**
   `CLOSED_DISMISSED` represents operational dismissal without financial movement (e.g. non-actionable variance, administrative dismissal).
3. **Optimistic Concurrency Control:**
   `transitionCaseStatus` accepts an optional `expectedVersion?: number`. If provided, it validates `currentVersion === expectedVersion` and executes:
   ```sql
   UPDATE exception_cases
   SET status = $1, version = $2, updated_at = NOW(), notes = ...
   WHERE id = $3 AND merchant_id = $4 AND version = $currentVersion
   ```
   If a race condition occurs, it throws `VersionConflictError(409 Conflict)`.
4. **Extraction Status Lock:**
   Newly extracted cases are immutably forced to `status: 'OPEN'` and `version: 1`. Incoming API payloads cannot inject status or bypass lifecycle transitions.

---

## 4. Real PostgreSQL Acceptance Results (`closeloop_test`)

The dedicated live PostgreSQL acceptance suite `src/lib/exceptions/__tests__/concurrency_case_pg.test.ts` executed against local PostgreSQL 18.4 (`closeloop_test` on `localhost:5432`):

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
   Duration  408ms
```

### Acceptance Gate Breakdown:

- **Gate 1 — Real Foreign Key Enforcement (`case_evidence_items.case_id`)**  
  *Result:* **PASS**  
  *Evidence:* Attempting to insert an evidence row with a non-existent case UUID throws PostgreSQL error code `23503` (`foreign_key_violation`).

- **Gate 2 — Composite Evidence Ownership Enforcement (`F-24`)**  
  *Result:* **PASS**  
  *Evidence:* Attempting to insert an evidence item referencing valid `case_id` with mismatched `merchant_id` (`'merchant_attacker_mismatched'`) fails with PostgreSQL error code `23503` referencing composite constraint `fk_case_evidence_tenant`.

- **Gate 3 — Active Immutability Triggers on UPDATE, DELETE, TRUNCATE (`F-25`)**  
  *Result:* **PASS**  
  *Evidence:* Direct `UPDATE`, `DELETE`, and `TRUNCATE` operations on `case_evidence_items` are intercepted by database triggers, raising PostgreSQL exception SQLSTATE `23514` (`case_evidence_items is immutable: ... operation is strictly forbidden`). Row contents remain completely unmodified.

- **Gate 4 — Non-Cascading Deletion Rejection via ON DELETE RESTRICT (`F-25`)**  
  *Result:* **PASS**  
  *Evidence:* Attempting `DELETE FROM exception_cases WHERE id = $1` on a case with attached evidence is rejected by PostgreSQL with SQLSTATE `23001` (`restrict_violation` on constraint `fk_case_evidence_tenant`). Parent case and evidence rows are preserved.

- **Gate 5 — Mandatory 9-Step Historical Snapshot Verification Sequence (`F-26`)**  
  *Result:* **PASS**  
  *Evidence:* Completed full 9-step sequence: verified initial variance preserved at 100, current variance updated to 150, version incremented to 2, snapshot evidence item `_v2` appended, re-observation of identical variance did not increment version, and concurrent parallel observations converged without duplicate snapshots.

- **Gate 6 — Concurrent Status Transitions & Optimistic Version Conflict Rejection (`F-30`)**  
  *Result:* **PASS**  
  *Evidence:* Two parallel database clients attempted simultaneous status transitions with the same initial `expectedVersion`. First client succeeded (transitioned to `INVESTIGATING` at version 2); second client was rejected with `VersionConflictError` (`409 Conflict`). Case safely remained at version 2.

- **Gate 7 — Transactional Rollback Atomicity**  
  *Result:* **PASS**  
  *Evidence:* Transaction abort rolled back case insertion completely. Verified 0 rows exist in PostgreSQL.

---

## 5. Full Regression & Build Evidence

### 1. Vitest Full Regression Suite (`npm test`)
```
 Test Files  22 passed (22)
      Tests  365 passed (365)
   Duration  2.39s
```
- Exception Intelligence Suites (`src/lib/exceptions`):
  - `evidenceGraph.test.ts`: 16 passed
  - `caseExtractor.test.ts`: 15 passed
  - `concurrency_case_pg.test.ts`: 7 passed (100% real PostgreSQL)
  - `repository.test.ts`: 9 passed
  - `api.test.ts`: 15 passed
- Reconciliation Core & Ingestion Suites:
  - `regression.test.ts`: 29 passed
  - `final_remediations.test.ts`: 32 passed
  - `concurrency_persisted.test.ts`: 10 passed (including 6 live PostgreSQL concurrency gates)
  - `reconciliation_persisted.test.ts`: 12 passed
  - `transactionSearch.test.ts`: 46 passed
  - `money.test.ts`: 30 passed
  - `auth.test.ts`: 26 passed
  - `ingestion_3c2.test.ts`: 21 passed
  - `database.test.ts`: 16 passed
  - `matcher.test.ts`: 15 passed
  - `workbench.test.ts`: 14 passed
  - `paypalPersistenceAdapter.test.ts`: 14 passed
  - `phase2a_final_audit.test.ts`: 13 passed
  - `importer.test.ts`: 9 passed
  - `adversarial.test.ts`: 7 passed
  - `fixtures.test.ts`: 5 passed
  - `paypalClient.test.ts`: 4 passed

### 2. TypeScript Compiler (`npx tsc --noEmit`)
- **Exit Code:** `0`
- Zero type errors across the entire repository.

### 3. ESLint Verification (`npm run lint`)
- **Exit Code:** `0`
- Zero errors, zero warnings.

### 4. Next.js Production Build (`npm run build`)
- **Engine:** Next.js 16.4.5 (Turbopack)
- **Exit Code:** `0`
- Compiled in 13.9s; static pages generated in 9.3s across 25 routes.
- Successfully verified dynamic server-rendered routes:
  - `ƒ /api/exceptions/cases`
  - `ƒ /api/exceptions/cases/[id]`

---

## 6. Exact Files and Migrations Modified

| File | Purpose |
| :--- | :--- |
| `src/lib/db/migrations/010_database_immutability_triggers.sql` | **NEW:** Exception-raising triggers on `case_evidence_items` (UPDATE, DELETE, TRUNCATE) & privilege revocation (F-25) |
| `src/lib/db/migrations/010_database_immutability_triggers_down.sql` | **NEW:** Non-destructive trigger revert script honoring forward-only policy (F-27) |
| `src/lib/db/migrator.ts` | Upgraded `splitSqlStatements` with dollar-quote (`$$ ... $$`) boundary awareness; registered Migration 010 |
| `src/lib/db/testHarness.ts` | Intercepts `REVOKE` and `GRANT` statements for pg-mem in-memory test compatibility |
| `src/lib/security/tenantContext.ts` | Removed silent fallback to `'default'`; fails closed with `500 MISSING_MERCHANT_CONFIGURATION`; rejects spoofed header/body parameters with `403` (F-23) |
| `src/lib/exceptions/caseExtractor.ts` | Enforces mandatory `merchantId`; applies Unicode NFC normalization to case keys; forces newly extracted case status to `'OPEN'` and version to 1 (F-23, F-28, F-30) |
| `src/lib/exceptions/evidenceGraph.ts` | Redacts sensitive patterns BEFORE truncation to prevent clipping leakage; preserves placeholder tags; enforces UTF-8 byte bounds (`64KB`); cycle protection (F-29) |
| `src/lib/exceptions/lifecycle.ts` | Documented financial truth invariant for `RESOLVED`; added `VersionConflictError` for optimistic locking (F-30) |
| `src/lib/exceptions/repository.ts` | Added `expectedVersion` optimistic locking check; attaches operational resolution audit disclaimer to `RESOLVED` status transitions (F-30) |
| `src/lib/exceptions/__tests__/api.test.ts` | Added tests for missing configuration (500), valid configuration, mismatched header (403), mismatched body (403), simultaneous mismatch (403), and matching credentials (F-23) |
| `src/lib/exceptions/__tests__/caseExtractor.test.ts` | Added NFC Unicode equivalence test, case-sensitivity test, missing merchantId error test, and status/version invariant test (F-23, F-28, F-30) |
| `src/lib/exceptions/__tests__/evidenceGraph.test.ts` | Added tests for redaction before clipping, multi-byte UTF-8 byte limits, circular references, and unsupported types (F-29) |
| `src/lib/exceptions/__tests__/repository.test.ts` | Added optimistic locking version conflict test and operational resolution disclaimer verification (F-30) |
| `src/lib/exceptions/__tests__/concurrency_case_pg.test.ts` | Hardened live PostgreSQL acceptance gates: active trigger exceptions (Gate 3), mandatory 9-step snapshot sequence (Gate 5), and concurrent transition conflict rejection (Gate 6) |

---

## 7. Remaining Architectural Boundaries & Next Steps

1. **Single-Tenant Deployment Scope:**
   CloseLoop Phase 3D.1 enforces an explicit single-tenant development deployment boundary verified via `CLOSELOOP_MERCHANT_ID`. Multi-tenant production authorization will be introduced in subsequent phases via verified OAuth session middleware.
2. **Absence of LLM and Automated Execution:**
   As governed by the implementation contract, Phase 3D.1 strictly provides deterministic case extraction, immutable evidence storage, and case retrieval APIs. No LLM prompts, reasoning loops (Phase 3D.2), operator approval workflows (Phase 3D.4), or financial execution adapters (Phase 3D.5) have been constructed.
3. **Phase 3D.1 Acceptance:**
   All findings F-23 through F-30 are fully remediated, verified against real PostgreSQL 18.4, and validated with zero regressions across the codebase.

**Phase 3D.1 is Fully Remediated, Formally Accepted, and Ready for Phase 3D.2.**

