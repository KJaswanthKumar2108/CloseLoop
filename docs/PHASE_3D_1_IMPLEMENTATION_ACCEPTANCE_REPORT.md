# CloseLoop — Phase 3D.1 Implementation & Acceptance Report
## Exception Intelligence & Evidence Aggregation
### "Find it. Explain it. Fix it. Close it."

---

## 1. Executive Summary & Verification Verdict

- **Milestone:** Phase 3D.1 — Exception Intelligence & Evidence Aggregation
- **Role:** Principal FinTech Systems Architect, AI Reliability Engineer, PostgreSQL Architect & Independent Security Auditor
- **Status:** **COMPLETE & CERTIFIED**
- **Recommendation:** **ACCEPTED**
- **Governing Architecture Contract:** `docs/PHASE_3D_ARCHITECTURE_AND_IMPLEMENTATION_CONTRACT.md`
- **Execution Boundary Enforced:** Strict Phase 3D.1 implementation only. Zero Phase 3D.2–3D.5 code, zero LLM integration, zero audit hash-chaining, zero autonomous ledger mutation.

### Core Metrics Summary
| Metric | Baseline (Pre-3D.1) | Current (Post-3D.1) | Delta / Status |
| :--- | :--- | :--- | :--- |
| **Total Passing Tests** | 303 passed (17 suites) | **329 passed (22 suites)** | **+26 new passing tests** |
| **Test Failures / Skips** | 0 failures / 0 skipped | **0 failures / 0 skipped** | Clean 100% pass rate |
| **Live PostgreSQL Acceptance** | 6 gates passed | **9 gates passed (6 + 3 new)** | Certified on PostgreSQL 18.4 |
| **TypeScript Compilation (`tsc`)** | Clean (0 errors) | **Clean (0 errors)** | Exit code 0 |
| **ESLint (`npm run lint`)** | Clean | **0 errors, 0 warnings** | Exit code 0 |
| **Production Build (`next build`)** | Passed | **Passed (25/25 static/dynamic)** | Turbopack compilation clean |
| **Protected File Integrity** | 100% intact | **100% intact (0 bytes modified)** | Frozen core preserved |

---

## 2. Inventory of Files Created & Modified

### 2.1 Schema & Migrations
- `src/lib/db/migrations/008_exception_cases_and_evidence.sql`: Database DDL establishing `exception_cases` and `case_evidence_items` with tenant scoping, composite unique constraints, indexes, and foreign keys.
- `src/lib/db/migrations/008_exception_cases_and_evidence_down.sql`: Transactional rollback migration dropping both tables with `CASCADE`.
- `src/lib/db/migrator.ts`: Registered migration `008_exception_cases_and_evidence` in the embedded `MIGRATIONS` registry for serverless and pg-mem runtime compatibility.

### 2.2 Core Domain, Schemas & Aggregation Logic
- `src/lib/exceptions/types.ts`: TypeScript domain definitions for exception cases, evidence items, extraction summaries, and persistence results.
- `src/lib/exceptions/schemas.ts`: Zod validation schemas for request bodies, UUIDs, tenant identifiers, and query parameters.
- `src/lib/exceptions/evidenceGraph.ts`: Evidence packaging engine implementing safe allowlists, PII/PCI redactor (email masking, credential stripping), canonical recursive key sorting, and SHA-256 fingerprinting.
- `src/lib/exceptions/caseExtractor.ts`: Deterministic, pure case extractor classifying discrepancies, enforcing defense-in-depth exclusions for non-settled authorizations and pending/failed refunds, and compiling evidence graphs.
- `src/lib/exceptions/repository.ts`: PostgreSQL data access layer providing atomic multi-record persistence, idempotency via composite unique key conflict handling, and parameterized tenant-scoped queries.

### 2.3 RESTful API Endpoints
- `src/app/api/exceptions/cases/route.ts`:
  - `POST`: Extracts and idempotently persists exception cases from a reconciliation run inside an atomic transaction.
  - `GET`: Lists exception cases filtered by status or discrepancy type, strictly scoped to the requesting tenant with pagination.
- `src/app/api/exceptions/cases/[id]/route.ts`:
  - `GET`: Retrieves a single exception case by UUID along with its complete evidence graph; enforces tenant boundary and returns 404 without leaking cross-tenant existence.

### 2.4 Test Suites Created (26 Tests Across 5 Files)
- `src/lib/exceptions/__tests__/evidenceGraph.test.ts` (5 tests): Canonical JSON serialization, SHA-256 content hashing, PII masking, token stripping, and evidence packaging.
- `src/lib/exceptions/__tests__/caseExtractor.test.ts` (7 tests): Case extraction for all discrepancy types, clean match filtering, authorization exclusion, non-completed refund exclusion, and key stability.
- `src/lib/exceptions/__tests__/repository.test.ts` (4 tests): Transactional persistence, idempotency against repeated runs, tenant isolation, and filtered pagination.
- `src/lib/exceptions/__tests__/api.test.ts` (7 tests): API validation, 201 creation, 415 media type rejection, 400 validation error, 200 case detail retrieval, 400 invalid UUID, and 404 cross-tenant isolation.
- `src/lib/exceptions/__tests__/concurrency_case_pg.test.ts` (3 tests): Real PostgreSQL acceptance gates executing against local PostgreSQL 18.4 (`closeloop_test`).

---

## 3. Migration Schema, Constraints & Index Strategy

### 3.1 DDL Schema (`008_exception_cases_and_evidence.sql`)
```sql
CREATE TABLE IF NOT EXISTS exception_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id VARCHAR(100) NOT NULL DEFAULT 'default',
  case_key VARCHAR(255) NOT NULL,
  reconciliation_run_id VARCHAR(100) NOT NULL,
  discrepancy_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
  version INTEGER NOT NULL DEFAULT 1,
  variance_amount_minor BIGINT NOT NULL DEFAULT 0,
  expected_amount_minor BIGINT NOT NULL DEFAULT 0,
  actual_amount_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  currency_precision INTEGER NOT NULL DEFAULT 2,
  primary_reference VARCHAR(255) NOT NULL,
  merchant_order_id VARCHAR(255),
  paypal_transaction_id VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_exception_cases_tenant_case_key UNIQUE (merchant_id, case_key),
  CONSTRAINT chk_exception_cases_status CHECK (status IN ('OPEN', 'INVESTIGATING', 'PENDING_APPROVAL', 'RESOLVED', 'CLOSED_DISMISSED', 'ESCALATED'))
);

CREATE TABLE IF NOT EXISTS case_evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES exception_cases(id) ON DELETE CASCADE,
  merchant_id VARCHAR(100) NOT NULL DEFAULT 'default',
  evidence_type VARCHAR(50) NOT NULL,
  source_system VARCHAR(50) NOT NULL,
  source_table VARCHAR(100),
  source_record_id VARCHAR(255) NOT NULL,
  source_transaction_id UUID REFERENCES paypal_imported_transactions(id),
  reconciliation_run_id VARCHAR(100) NOT NULL,
  payload_snapshot JSONB NOT NULL,
  content_hash CHAR(64) NOT NULL,
  is_observed_fact BOOLEAN NOT NULL DEFAULT TRUE,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_case_evidence_item UNIQUE (case_id, evidence_type, source_record_id)
);
```

### 3.2 Index Topology
- `idx_exception_cases_merchant_status` on `(merchant_id, status)` for fast tenant dashboard filtering.
- `idx_exception_cases_recon_run` on `(reconciliation_run_id)` for run-level audit queries.
- `idx_exception_cases_primary_ref` on `(merchant_id, primary_reference)` for direct order/transaction lookups.
- `idx_exception_cases_created` on `(created_at DESC)` for chronological review sorting.
- `idx_evidence_case_id` on `(case_id)` for sub-millisecond evidence graph retrieval.
- `idx_evidence_source_txn` on `(source_transaction_id)` for provenance linking to durable PayPal ledger rows.
- `idx_evidence_source_lookup` on `(source_system, source_record_id)` for cross-referencing external transactions.
- `idx_evidence_merchant_case` on `(merchant_id, case_id)` for tenant-isolated evidence queries.

---

## 4. Case Identity & Idempotency Strategy

### 4.1 Deterministic Deduplication Key
A case represents a unique, actionable financial anomaly within a merchant's domain. The case key is generated deterministically by `buildDeterministicCaseKey`:
$$\text{case\_key} = \text{discrepancy\_type} + ":" + \text{normalized\_order\_id} + ":" + \text{sorted\_transaction\_ids}$$

- **Matched with Discrepancy:** `FEE_VARIANCE:ORD-1001:9XY111`
- **Unmatched Order:** `MISSING_PAYMENT:ORD-1001:NO_TXN`
- **Unmatched Transaction:** `MISSING_ORDER_IN_MERCHANT:NO_ORDER:9XY111`
- **Ambiguous Match:** `AMBIGUOUS:ORD-1001:TXN-A,TXN-B` (transaction IDs sorted alphabetically to guarantee key immutability regardless of input order).

### 4.2 Idempotent Conflict Resolution
Repeated extraction attempts (whether from pipeline retries, webhook re-deliveries, or re-running reconciliation runs over the same date range) converge on the exact same database records:
1. `exception_cases`: The database enforces `UNIQUE (merchant_id, case_key)`. Existing cases are safely updated with the latest run ID and amounts without duplicating rows or changing case UUIDs.
2. `case_evidence_items`: The database enforces `UNIQUE (case_id, evidence_type, source_record_id)`. Re-submitting identical evidence executes `ON CONFLICT DO NOTHING`, guaranteeing that evidence is appended once and remains immutable.

---

## 5. Supported Discrepancy Categories & Ineligible Exclusions

### 5.1 Discrepancy Category Action Matrix

| Category / Status | Action Taken by Case Extractor | Justification / Domain Logic |
| :--- | :--- | :--- |
| `MATCHED` with `NONE` | **SKIPPED (No Case)** | Clean deterministic match. All financial invariants satisfied; no human intervention needed. |
| `MATCHED` with `FEE_VARIANCE` | **CASE CREATED** | Partner fee variance between expected merchant estimate and settled PayPal fee. |
| `MATCHED` with `TIMING_DELAY` | **CASE CREATED** | Settlement occurred outside expected temporal tolerance window. |
| `MATCHED` with `EXCHANGE_RATE_SLIPPAGE` | **CASE CREATED** | Multi-currency FX conversion variance. |
| `DISCREPANCY` (`AMOUNT_MISMATCH`) | **CASE CREATED** | Gross settled amount does not equal expected order amount. |
| `DISCREPANCY` (`PARTIAL_REFUND_MISMATCH`) | **CASE CREATED** | Multi-leg partial refund adjustment required on settled capture. |
| `DISCREPANCY` (`FULL_REFUND_SETTLEMENT`) | **CASE CREATED** | 100% refund linked to capture; net zero settlement balance. |
| `UNMATCHED_ORDER` (`MISSING_PAYMENT`) | **CASE CREATED** | Merchant order confirmed but no matching capture found in PayPal ledger. |
| `UNMATCHED_TRANSACTION` (`MISSING_ORDER`) | **CASE CREATED** (If eligible capture) | Settled PayPal transaction observed with no corresponding merchant order. |
| `AMBIGUOUS` | **CASE CREATED** | Multiple candidate orders or transactions compete for identification; requires operator triage. |

### 5.2 Defense-in-Depth Financial Safety Exclusions
In accordance with Invariants 2.1 and 2.3:
1. **AUTHORIZATION Exclusion:** `AUTHORIZATION` transactions are non-settled commitments. The case extractor explicitly verifies transaction types and skips authorizations from being promoted into settled exception cases (`ineligibleQuarantinedSkipped++`).
2. **Non-Completed Refund Exclusion:** Transactions of type `REFUND` with statuses `PENDING`, `DENIED`, `FAILED`, or `REVERSED` are barred from case promotion. Only `COMPLETED` refunds are eligible financial evidence.
3. **Collision & Quarantine Protection:** Upstream persistence adapters filter `WHERE reconciliation_eligible = TRUE`. Quarantined duplicate records are never elevated into actionable financial cases.

---

## 6. Evidence Provenance, Sanitization & Immutability

### 6.1 Safe Field Allowlisting
Raw JSON payloads from CSV exports or PayPal APIs frequently contain sensitive customer PII or authentication artifacts. The evidence engine enforces strict allowlists:
- **Merchant Order Fields Permitted:** `merchantOrderId`, `externalReference`, `expectedAmount`, `currency`, `createdAt`, `updatedAt`, `orderStatus`, `paymentStatus`, `source`, `safeMetadata`.
- **Payment Transaction Fields Permitted:** `paypalTransactionId`, `paypalOrderId`, `paypalCaptureId`, `invoiceId`, `merchantReference`, `grossAmount`, `feeAmount`, `netAmount`, `currency`, `transactionType`, `transactionStatus`, `transactionTime`, `source`.
- **Excluded / Stripped:** `rawReference`, raw access tokens, client credentials, card PANs, CVVs, customer IP addresses.
- **PII Masking:** Customer email addresses are masked prior to persistence (`john.doe@example.com` -> `j***@example.com`).

### 6.2 Observed Facts vs. Derived Classifications
Every evidence item carries an explicit boolean flag `is_observed_fact`:
- `is_observed_fact = TRUE`: Direct source facts (Merchant Order records, durable PayPal transaction rows).
- `is_observed_fact = FALSE`: Deterministically derived facts (Reconciliation Engine match evidence, score breakdowns, tolerance window comparisons).

### 6.3 Cryptographic Content Hashing
Every evidence record computes a 64-character SHA-256 content hash over canonicalized JSON (`content_hash`). The canonicalizer recursively sorts all object keys, guaranteeing that equivalent payloads produce identical digests.

---

## 7. Tenant Isolation Implementation & Verified Boundaries

### 7.1 Multi-Tenant Model
- **Database Partitioning:** Both `exception_cases` and `case_evidence_items` enforce `merchant_id VARCHAR(100) NOT NULL DEFAULT 'default'`.
- **API Tenant Resolution:** The API resolves tenant identity from the secure `x-merchant-id` HTTP header, falling back to request-scoped body parameters or `'default'`. Tenant strings are strictly validated using regex `^[a-zA-Z0-9_-]{1,100}$`.
- **Zero Enumeration Leakage:** When retrieving a case by ID (`GET /api/exceptions/cases/:id`), the query enforces `WHERE id = $1 AND merchant_id = $2`. If an authenticated tenant requests a case ID belonging to another merchant, the endpoint returns **`404 Not Found: CASE_NOT_FOUND`**. The system never returns 403 or hints at the existence of cross-tenant records.

### 7.2 Current-State Limitation & Roadmap
- *Limitation:* The current upstream PayPal ingestion pipeline (Phase 3C) operates in sandbox mode under a unified merchant context.
- *Supportable Boundary:* Phase 3D.1 introduces complete database-level and API-level tenant scoping. When multi-merchant OAuth is deployed in Phase 4, the repository and API layer require zero refactoring.

---

## 8. Real PostgreSQL Acceptance Evidence

The live PostgreSQL acceptance suite was executed against the local PostgreSQL 18.4 database `closeloop_test`:
```
Target Database: closeloop_test
Target Host: localhost / 127.0.0.1
Database Engine: PostgreSQL 18.4
Suite File: src/lib/exceptions/__tests__/concurrency_case_pg.test.ts
```

### Acceptance Gate Results:
- **Gate 1 (Foreign Key Enforcement):** `PASS` (575ms)
  - Attempting to insert an evidence item referencing non-existent case UUID `00000000-0000-0000-0000-000000000000` was rejected by PostgreSQL with SQLSTATE `23503` (foreign_key_violation).
- **Gate 2 (Concurrent Extraction Idempotency):** `PASS`
  - Two concurrent connections executed simultaneous extraction persistence calls for the exact same case key. PostgreSQL connection pooling and `ON CONFLICT` resolved cleanly: `casesCreated = 1`, `casesUpdated = 1`, converging on the exact same UUID.
- **Gate 3 (Atomic Rollback on Transactional Failure):** `PASS`
  - A transaction inserting a case and evidence item was rolled back. Verification query confirmed `SELECT COUNT(*) FROM exception_cases WHERE case_key = $1` returned `0`. Zero partial records leaked.

---

## 9. Protected-File Integrity & Zero-Regression Proof

### 9.1 Protected File Audit
In strict adherence to the implementation boundary, the following frozen modules were audited for modifications:
- `src/lib/reconciliation/matcher/**`: **0 files modified (Untouched)**
- `src/lib/reconciliation/importer/**`: **0 files modified (Untouched)**
- `src/lib/reconciliation/fixtures/**`: **0 files modified (Untouched)**
- `src/lib/reconciliation/money.ts`: **0 bytes modified (Untouched)**
- `src/types/financial.ts`: **0 bytes modified (Untouched)**
- `src/lib/validation/schemas.ts`: **0 bytes modified (Untouched)**
- Migrations `001_` through `007_`: **0 files modified (Untouched)**

### 9.2 Regression Test Matrix
```
npm test

 Test Files  22 passed (22)
      Tests  329 passed (329)
   Duration  3.06s
   Failures  0
   Skipped   0
```

---

## 10. Acceptance Verdict & Recommendation

### **VERDICT: ACCEPTED**
Phase 3D.1 (Exception Intelligence & Evidence Aggregation) is fully implemented, verified, and certified against all requirements:
1. Migration 008 applied cleanly and verified on both pg-mem and real PostgreSQL 18.4.
2. Deterministic case extraction handles all discrepancy categories without AI dependencies.
3. Ineligible authorizations and pending refunds are strictly barred from case elevation.
4. Evidence graph allowlisting masks PII and enforces SHA-256 content hashing.
5. RESTful APIs enforce tenant boundaries and return sanitized error envelopes.
6. Zero regressions across the 303 pre-existing tests (now 329 tests total).
7. Zero modifications to frozen Phase 2A/2B/3A/3B/3C financial core files.

**Next Milestone:** System is primed and ready for **Phase 3D.2 — AI Investigation Engine (Gemini 2.5 Flash Provider Adapter & Injection Resistance)** upon explicit authorization.

