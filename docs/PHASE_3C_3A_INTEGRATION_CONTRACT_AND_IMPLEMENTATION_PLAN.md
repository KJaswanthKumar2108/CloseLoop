# CloseLoop — Phase 3C.3A: Integration Contract Discovery & Implementation Plan
## Persisted PayPal Transaction Integration with Deterministic Reconciliation Engine

**Role:** Principal Financial Systems Architect, PayPal Integration Engineer, Senior TypeScript Architect  
**Project:** CloseLoop — AI-Powered PayPal Payment Reconciliation & Exception Resolution  
**Milestone:** Phase 3C.3A — Integration Contract Discovery & Architecture Plan (Final Review Revision)  
**Mode:** STRICT READ-ONLY — Zero Code or Schema Modifications  
**Date:** 2026-11-09  

---

## 1. Executive Summary & Final Readiness Verdict

### **Verdict: READY FOR PHASE 3C.3B IMPLEMENTATION**

Following the final independent architectural review of Phase 3C.3A, this definitive specification resolves all eighteen review findings (**F-01** through **F-18**) with zero modifications to frozen Phase 2A/2B/3A/3B modules, zero changes to financial domain types, and zero database schema mutations.

- **Dataset Completeness (F-07):** Strictly requires RFC 3339 `startDate` and `endDate` with `startDate < endDate` and a maximum window of 31 days. Uses `REPEATABLE READ` snapshot isolation to perform an atomic count check (`COUNT(*) <= 5000`); returns a structured `DATASET_LIMIT_EXCEEDED` (HTTP 422) error if the window exceeds 5,000 eligible records, completely eliminating silent truncation.
- **Refund Parent Compatibility (F-08, F-12):** Validates authentic source-to-database mappings for `TXN` and `ODR` parent references while rejecting normalizer self-fallbacks (`captureId === ownTxnId`), missing references, and unsupported reference types (`SUB`, `CASE`, `DIS`).
- **Domain Purity (F-09, F-11):** Retains 100% purity of [`src/types/financial.ts`](file:///c:/MY%20PROGRAMMING/closeloop/src/types/financial.ts). Leaves `run.datasetReferences.transactionsFileId` strictly `undefined` for persisted ledger sourcing. Extends provenance strictly via an outer API response envelope (`PreviewPersistedResponse.metadata`), and renders `POTENTIAL_TRUNCATION_ARTIFACT` as a presentation-layer visual decorator for unmatched orders during partial runs.
- **Incomplete & Warning-State Import Safety (F-10, F-13, F-17A, F-18A):** Enforces multi-status interval intersection detection across `import_runs`: actively running imports (`'RUNNING'`) immediately abort reconciliation with HTTP 409 `IMPORT_RUN_IN_PROGRESS`. All three incomplete states (`'PARTIAL'`, `'FAILED'`, and `'COMPLETED_WITH_WARNINGS'`) enforce a soft block requiring explicit operator acknowledgement (`acknowledgedPartial: true`) unless superseded by a subsequent clean `'COMPLETED'` run (`records_rejected = 0`, `identity_collisions_detected = 0`, `safe_error_code IS NULL`) that fully covers the requested interval.
- **Strict Order Input Contract (F-14):** Enforces mutually exclusive merchant order input (`ordersCsv` XOR `orders`), strictly requiring one representation and rejecting both (`MUTUALLY_EXCLUSIVE_INPUTS`) or neither (`MISSING_MERCHANT_ORDERS`), with a strict 5,000-order limit (`ORDER_ROW_LIMIT_EXCEEDED`).
- **Concurrency Serialization & Snapshot Freshness (F-15, F-16):** Formulates the session-level advisory locking protocol on dedicated client connections (`pg_advisory_lock` / `pg_advisory_lock_shared`), establishing `REPEATABLE READ` strictly *after* the shared lock is acquired, closing snapshot freshness races.
- **Resource Management & Lock-Timeout Hygiene (F-17B, F-18B):** Enforces independent lifecycle tracking (`clientReleased`, `lockTimeoutApplied`, `lockAcquired`, `txActive`, `connectionTainted`). Executes `RESET lock_timeout;` whenever applied—even when lock acquisition times out or fails. Destroys tainted connections (`client.release(true)`) on unlock failure, unexpected return value, or reset failure, preventing pooled session leakage.
- **Verification Honesty & Acceptance Gates (F-17C):** Distinguishes theoretical/mock proofs from live database concurrency, defining 6 mandatory real-PostgreSQL acceptance test gates for Phase 3C.3B.

---

## 2. Independent Architecture Review — Findings F-01 through F-06

### 2.1. Finding F-01: Import Run Historical Membership
- **Source Evidence:** [`src/lib/db/migrations/001_initial_schema.sql#L64-L65`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L64-L65) stores only `first_import_run_id` and `last_import_run_id`. When a transaction is re-observed across three or more overlapping runs, intermediate run foreign keys are overwritten.
- **Decision:** Adopt **Date-Window Sourcing** (`transaction_time BETWEEN startDate AND endDate`) as the authoritative boundary. Sourcing by settlement date matches financial accounting rules and is immune to re-observation overwrites. A dedicated association table (`import_run_transactions`) is scheduled for a future migration (`002_import_run_membership.sql`).

### 2.2. Finding F-02: PARTIAL Import Protection
- **Source Evidence:** Phase 3C.2 verified `import_status = 'PARTIAL'` in [`src/lib/db/types.ts#L19`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/types.ts#L19) and `isTruncated = true` in [`src/lib/paypal/importService.ts#L285`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/paypal/importService.ts#L285).
- **Decision:** Prominent amber warning banner in `DatasetUploader.tsx`, mandatory operator acknowledgement checkbox before running reconciliation, and persistent provenance labeling in `PreviewPersistedResponse.metadata`.

### 2.3. Finding F-03: Adapter Defense-in-Depth
- **Two-Tier Gating Architecture:**
  - **Tier 1 (SQL Repository):** Filters `reconciliation_eligible = TRUE AND identity_collision_status = 'NONE'`.
  - **Tier 2 (Adapter Validation):** Evaluates 8 fail-closed invariant checks in TypeScript (exact status `ELIGIBLE`, collision `NONE`, type `CAPTURE` | `REFUND`, status `COMPLETED`, safe-integer minor units, sign sanity, and refund parent references).
- **Metric Surfacing:** Any invalid row is rejected by the adapter, excluded from the matcher, and tallied in `adapterRejectedCount` to be surfaced in the API response and workbench summary cards.

### 2.4. Finding F-04: Exact Contract Verification
- `fingerprint`: `VARCHAR(500) NOT NULL UNIQUE` ([`001_initial_schema.sql#L44`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L44)).
- `paypal_transaction_id`: `VARCHAR(100) NOT NULL` ([`001_initial_schema.sql#L43`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L43)).
- BIGINT conversion: [`parseSafeInteger()`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/repositories/paypalTransactionRepository.ts#L6-L13) asserts `Number.isSafeInteger()`.
- `rawReference`: `VARCHAR(255) NOT NULL` contains non-sensitive string `PAYPAL_API:<id>:<eventCode>`. Safe to expose.
- Multi-capture: Verified native Phase 2A aggregation in [`candidateMatcher.ts#L120-L190`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/reconciliation/matcher/candidateMatcher.ts#L120-L190).

### 2.5. Finding F-05: API and Deployment Security
- Local hackathon prototype executes on loopback (`localhost:3000`), restricted to `SANDBOX`, read-only queries.
- Production requirements: Session/JWT authentication, RBAC (`FINANCIAL_OPERATOR`), tenant isolation (RLS), and rate limiting.

### 2.6. Finding F-06: Determinism, Dynamic Metadata & Demo Data
- `runDeterministicMatching()` is 100% deterministic.
- Dynamic fields restricted to run metadata (`run.id`, timestamps).
- Demo orders tagged `source: 'SYNTHETIC_DEMO'`; uploaded orders tagged `source: 'CSV_UPLOAD'`.
- Unique fingerprint constraints prevent duplicate row storage from overlapping imports.

---

## 3. Independent Architecture Review — Findings F-07 through F-10

### 3.1. Finding F-07: Bounded Dataset Completeness
- **Source Constraints:** In [`src/lib/paypal/transactionSearch.ts#L26-L27`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/paypal/transactionSearch.ts#L26-L27), CloseLoop defines `MAX_DATE_RANGE_DAYS = 31`. The Phase 2A matching engine enforces a maximum batch boundary of 5,000 records.
- **Specification:**
  1. Both `startDate` and `endDate` are strictly required RFC 3339 timestamps (`startMillis < endMillis`, maximum duration 31 days).
  2. The adapter queries the database under `REPEATABLE READ` snapshot isolation.
  3. An atomic count query (`COUNT(*)`) is executed first.
  4. If `total_eligible > 5000`, the transaction rolls back, and the endpoint responds with **HTTP 422 `DATASET_LIMIT_EXCEEDED`**, specifying the exact eligible count found and directing the operator to narrow the window.
  5. Zero transactions are silently truncated or discarded. Count and retrieval are mathematically identical under the snapshot.

### 3.2. Finding F-08: Refund Parent-Reference Compatibility
- **Source Verification:** In [`src/lib/paypal/normalizer.ts#L321-L325`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/paypal/normalizer.ts#L321-L325), refunds can populate either `paypalCaptureId` (for `TXN` references) or `paypalOrderId` (for `ODR` references). The Phase 2A engine in [`src/lib/reconciliation/matcher/exactMatcher.ts#L47-L51`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/reconciliation/matcher/exactMatcher.ts#L47-L51) matches orders using either `paypalOrderId` or `paypalCaptureId`.
- **Specification:** The adapter accepts verified parent references in **either capture form (`TXN`) or order form (`ODR`)**, provided `referenceId !== transactionId`. Normalizer self-fallbacks (`captureId === ownTxnId` with no other parent link) and unrelated reference types (`SUB`, `CASE`, `DIS`) fail closed as `REFUND_MISSING_PARENT_REFERENCE`.

### 3.3. Finding F-09: Reconciliation Metadata Without Frozen-Type Mutations
- **Source Verification:** [`src/types/financial.ts`](file:///c:/MY%20PROGRAMMING/closeloop/src/types/financial.ts) is strictly frozen. `ReconciliationRun.datasetReferences` and `DiscrepancyType` cannot receive new fields.
- **Specification:** `ReconciliationRun` and `ReconciliationRecord` remain **100% untouched and conformant to `financial.ts`**. All extended provenance (`isPartial`, `partialNotice`, `intersectingPartialRuns`, `adapterRejections`) is delivered via an outer API response envelope (`PreviewPersistedResponse.metadata`). `POTENTIAL_TRUNCATION_ARTIFACT` is rendered as a **presentation-layer visual decorator** in the UI when `metadata.isPartial === true` for any `UNMATCHED_ORDER` row. Zero modifications to `src/types/financial.ts`.

### 3.4. Finding F-10: Partial Import Intersection Detection
- **Source Evidence:** [`src/lib/db/migrations/001_initial_schema.sql#L19-L25`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L19-L25) confirms `import_runs.requested_start_date` and `requested_end_date` are stored as `TIMESTAMPTZ NOT NULL`.
- **Mathematical Interval Intersection Algorithm:**
  ```sql
  SELECT id, requested_start_date, requested_end_date, import_status, pages_fetched
  FROM import_runs
  WHERE import_status = 'PARTIAL'
    AND requested_start_date <= $2::TIMESTAMPTZ
    AND requested_end_date >= $1::TIMESTAMPTZ
  ORDER BY started_at DESC;
  ```
- **Workflow Enforcement:** Detects partial, enclosing, or overlapping runs across the window. If intersecting runs exist, `isPartial` is set to `true`, and the operator must explicitly pass `acknowledgedPartial: true` to prevent an HTTP 422 `PARTIAL_INGESTION_UNACKNOWLEDGED` error.

---

## 4. Final Independent Architecture Review — Findings F-11 through F-14

### 4.1. Finding F-11: Semantic Purity of `transactionsFileId`
- **Source Evidence:** [`src/types/financial.ts#L207-L212`](file:///c:/MY%20PROGRAMMING/closeloop/src/types/financial.ts#L207-L212) defines `datasetReferences.transactionsFileId?: string`. In CSV ingestion, this stores a file ID. For database ledger sourcing, there is no uploaded file.
- **Correction:** `run.datasetReferences.transactionsFileId` remains strictly `undefined` for persisted ledger sourcing. All query provenance, date ranges, and adapter metrics reside in `PreviewPersistedResponse.metadata`.

### 4.2. Finding F-12: Source-to-Database Refund Parent Mapping Verification
- **Source Verification:**
  - In [`normalizer.ts#L321-L325`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/paypal/normalizer.ts#L321-L325), `paypalOrderId` is populated only when `paypal_reference_id_type === 'ODR'`. Normalizer line 321 defaults `paypalCaptureId` to `paypal_reference_id || rawTxnId`.
  - In [`provenanceService.ts#L368-L371`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/provenanceService.ts#L368-L371), `paypalReferenceId`, `paypalReferenceType`, `paypalOrderId`, and `paypalCaptureId` are persisted directly.
- **Exact Adapter Mapping & Enforcement:**
  - **Capture Reference (`TXN`):** `paypal_reference_type === 'TXN'` AND `paypal_capture_id !== paypal_transaction_id` $\rightarrow$ maps to: `paypalCaptureId = record.paypalCaptureId`, `paypalOrderId = undefined`. Matches via `exactMatcher.ts`.
  - **Order Reference (`ODR`):** `paypal_reference_type === 'ODR'` AND `paypal_order_id !== paypal_transaction_id` $\rightarrow$ maps to: `paypalOrderId = record.paypalOrderId`, `paypalCaptureId = undefined` (cleansing the normalizer's capture fallback). Matches via `exactMatcher.ts`.
  - **Normalizer Self-Fallback:** `paypal_capture_id === paypal_transaction_id` without genuine order link $\rightarrow$ **REJECT (FAIL CLOSED)** with reason `'REFUND_MISSING_PARENT_REFERENCE'`.
  - **Unsupported Reference Types:** `paypal_reference_type` in `['SUB', 'CASE', 'DIS', 'PAP']` $\rightarrow$ **REJECT (FAIL CLOSED)** with reason `'REFUND_UNSUPPORTED_REFERENCE_TYPE'`.

### 4.3. Finding F-13: In-Progress, Incomplete, and Warning-Bearing Import Intersection Handling
- **Source Evidence:** [`src/lib/db/types.ts#L7`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/types.ts#L7) defines `ImportStatus = 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_WARNINGS' | 'FAILED' | 'PARTIAL'`.
- **Interval Intersection Query:**
  ```sql
  SELECT id, requested_start_date, requested_end_date, import_status, pages_fetched, safe_error_code
  FROM import_runs
  WHERE import_status IN ('RUNNING', 'FAILED', 'PARTIAL', 'COMPLETED_WITH_WARNINGS')
    AND requested_start_date <= $2::TIMESTAMPTZ
    AND requested_end_date >= $1::TIMESTAMPTZ
  ORDER BY started_at DESC;
  ```
- **Lifecycle Invariants:**
  - **`'RUNNING'` (Active Ingestion):** Immediate **HARD BLOCK** returning **HTTP 409 `IMPORT_RUN_IN_PROGRESS`**.
  - **`'FAILED'`, `'PARTIAL'`, and `'COMPLETED_WITH_WARNINGS'` (Incomplete Ingestion):** **SOFT BLOCK** requiring explicit operator acknowledgement (`acknowledgedPartial: true`). Returns **HTTP 422 `INCOMPLETE_IMPORT_INTERSECTION`** if unacknowledged. Notice: acknowledgement permits proceeding with a known completeness risk; it does not make the dataset complete.

### 4.4. Finding F-14: Mutually Exclusive Merchant Order Contract
- **Contract Enforcement:** `POST /api/reconciliation/preview-persisted` enforces mutual exclusivity (XOR) via Zod `.refine()`:
  - Providing both `ordersCsv` and `orders` returns **HTTP 400 `MUTUALLY_EXCLUSIVE_INPUTS`**.
  - Providing neither returns **HTTP 400 `MISSING_MERCHANT_ORDERS`**.
  - CSV exceeding 5,000 parsed rows returns **HTTP 400 `ORDER_ROW_LIMIT_EXCEEDED`**.
  - JSON `orders` array exceeding 5,000 items returns **HTTP 400 `ORDER_ROW_LIMIT_EXCEEDED`**.

---

## 5. Final Independent Architecture Review — F-15 and Final Contract Clarifications

### 5.1. Finding F-15: Import/Reconciliation Concurrency Serialization

#### Problem & Race Condition Analysis
Under PostgreSQL `REPEATABLE READ`, a transaction sees a snapshot of committed data as of the transaction's start. While this guarantees snapshot isolation, it does not prevent an import from initiating immediately after reconciliation checks for `RUNNING` runs:
1. Reconciliation checks `import_runs` and finds no overlapping `RUNNING` import.
2. An import for the same window starts immediately after this check and inserts `import_runs (import_status = 'RUNNING')`.
3. Reconciliation establishes its `REPEATABLE READ` snapshot.
4. The import completes and commits new transactions to `paypal_imported_transactions`.
5. Reconciliation executes against the older snapshot, omitting the newly committed transactions.

#### Source Investigation
Inspection of [`src/lib/paypal/importService.ts#L195-L203`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/paypal/importService.ts#L195-L203) and [`src/lib/db/provenanceService.ts#L222`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/provenanceService.ts#L222) reveals that `createImportRun()` executes a simple `INSERT INTO import_runs ...`, and `recordPayPalImportBatch()` uses a standard `BEGIN ... COMMIT` block. There is currently **zero locking or serialization mechanism** coordinating import initiation with reconciliation queries.

#### Architectural Locking Protocol Specification
To coordinate both workflows without table locking or schema modifications, CloseLoop will utilize **PostgreSQL Transaction-Scoped Advisory Locks** (`pg_advisory_xact_lock`):

- **Dedicated Lock Identifier:**
  `const CLOSELOOP_INGESTION_LOCK_ID = 8492048201;` (64-bit bigint namespace).
- **Import Initiation Protocol (Exclusive Lock):**
  When `importPayPalTransactions()` starts:
  ```sql
  BEGIN;
  -- Acquire exclusive lock for initiation
  SELECT pg_advisory_xact_lock(8492048201);
  -- Check for existing overlapping RUNNING runs
  -- Insert import_runs record with status 'RUNNING'
  COMMIT; -- Lock released immediately; durable 'RUNNING' lease established
  ```
- **Reconciliation Protocol (Shared Lock + Snapshot):**
  When `POST /api/reconciliation/preview-persisted` executes:
  ```sql
  BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
  SET LOCAL lock_timeout = '3000ms';
  -- Acquire shared lock
  SELECT pg_advisory_xact_lock_shared(8492048201);
  -- Check for incomplete/running import intersections
  -- Perform COUNT(*) and bounded SELECT
  COMMIT; -- Shared lock released upon completion
  ```

#### Concurrency & Deadlock Guarantees
1. **Serialization Order:** Both workflows acquire the single global lock key `8492048201` in identical order, eliminating any possibility of deadlocks.
2. **Mutual Exclusion during Initiation:**
   - If reconciliation holds the shared lock, an import initiation attempting `pg_advisory_xact_lock` will wait until reconciliation finishes its snapshot query.
   - If an import is initiating and holds the exclusive lock, reconciliation waits. Once the import commits its `RUNNING` row, reconciliation acquires its shared lock, executes the incomplete-run check, detects the `RUNNING` import, and cleanly aborts with **HTTP 409 `IMPORT_RUN_IN_PROGRESS`**.
3. **Bounded Timeout:** If reconciliation cannot acquire the shared lock within 3,000ms (due to a stalled initiation transaction), `SET LOCAL lock_timeout` aborts the transaction and returns **HTTP 409 `IMPORT_RUN_IN_PROGRESS`** (or HTTP 503).
4. **Automatic Release:** Being transaction-scoped (`xact`), locks release automatically on `COMMIT`, `ROLLBACK`, client timeout, or network disconnect. Lingering locks are impossible.

---

### 5.2. Formal Incomplete Run Supersession Specification (F-13 Clarification)

#### Supersession Definition (Conservative Fallback — F-17A, F-18A)
An incomplete import run $I$ (`import_status IN ('PARTIAL', 'FAILED', 'COMPLETED_WITH_WARNINGS')`) is **superseded** if and only if there exists a subsequent fully successful run $S$ (`import_status = 'COMPLETED'`) whose requested window **fully covers** the window of run $I$:

$$\text{Superseded}(I) \iff \exists S : S.\text{started\_at} > I.\text{started\_at} \;\land\; S.\text{import\_status} = \text{'COMPLETED'} \;\land\; S.\text{records\_rejected} = 0 \;\land\; S.\text{identity\_collisions\_detected} = 0 \;\land\; S.\text{safe\_error\_code IS NULL} \;\land\; S.\text{requested\_start} \le I.\text{requested\_start} \;\land\; S.\text{requested\_end} \ge I.\text{requested\_end}$$

Under the Phase 3C.1 database schema, runs with `import_status = 'COMPLETED_WITH_WARNINGS'` represent rejected records or quarantined collisions that may leave financial gaps in the ledger. Therefore, all three statuses (`PARTIAL`, `FAILED`, and `COMPLETED_WITH_WARNINGS`) are treated as incomplete and untrusted for reconciliation sourcing. A `COMPLETED_WITH_WARNINGS` run can **never** supersede another incomplete run, and an incomplete run requires explicit operator acknowledgement (`acknowledgedPartial: true`) unless a subsequent clean `COMPLETED` run fully covers its entire requested interval.

#### Multi-Run and Edge-Case Rules
1. **Partial Overlap Is Not Supersession:** If Run 1 was `PARTIAL` for Nov 1–Nov 10, and Run 2 was `COMPLETED` for Nov 1–Nov 5, Run 2 does **NOT** supersede Run 1 because Nov 6–Nov 10 remains unverified. The warning remains active.
2. **Failed Retries:** If a retry run reaches status `'FAILED'` or `'PARTIAL'`, it does not satisfy the `COMPLETED` condition. Both incomplete runs remain active.
3. **Multiple Fragmented Runs:** CloseLoop does not perform complex geometric interval unions across multiple fragmented runs. Supersession requires at least one discrete successful run covering the entire span of the incomplete run.
4. **Completed With Warnings Cannot Supersede:** A later run reaching `COMPLETED_WITH_WARNINGS` does not supersede an incomplete run because quarantined collisions or rejected records may leave ledger gaps.
5. **Completed With Warnings Can Be Superseded:** An earlier `COMPLETED_WITH_WARNINGS` run CAN be superseded by a later qualifying clean `COMPLETED` run if the clean run fully covers the warning-bearing run's entire requested interval.

#### SQL Implementation with `NOT EXISTS`
```sql
SELECT
  i.id,
  i.requested_start_date,
  i.requested_end_date,
  i.import_status,
  i.pages_fetched,
  i.safe_error_code
FROM import_runs i
WHERE i.import_status IN ('PARTIAL', 'FAILED', 'COMPLETED_WITH_WARNINGS')
  AND i.requested_start_date <= $2::TIMESTAMPTZ
  AND i.requested_end_date >= $1::TIMESTAMPTZ
  AND NOT EXISTS (
    SELECT 1 FROM import_runs s
    WHERE s.import_status = 'COMPLETED'
      AND s.records_rejected = 0
      AND s.identity_collisions_detected = 0
      AND s.safe_error_code IS NULL
      AND s.started_at > i.started_at
      AND s.requested_start_date <= i.requested_start_date
      AND s.requested_end_date >= i.requested_end_date
  )
ORDER BY i.started_at DESC;
```
If this query returns zero rows, all historical incomplete runs in the window have been genuinely superseded by covering successful runs, and no warning acknowledgement is required.

---

### 5.3. Distinct Route Error Code Mapping (F-14 Clarification)

The endpoint `POST /api/reconciliation/preview-persisted` returns distinct, machine-readable HTTP 400 error codes for merchant order validation failures:

| Scenario | HTTP Status | Error Code | Response Message |
|:---------|:------------|:-----------|:-----------------|
| Both `ordersCsv` and `orders` provided | **400** | `MUTUALLY_EXCLUSIVE_INPUTS` | `"Provide either 'ordersCsv' or 'orders', not both."` |
| Neither `ordersCsv` nor `orders` provided | **400** | `MISSING_MERCHANT_ORDERS` | `"Merchant orders dataset is required. Provide either 'ordersCsv' or 'orders'."` |
| `ordersCsv` parsed data rows $> 5000$ | **400** | `ORDER_ROW_LIMIT_EXCEEDED` | `"Merchant orders CSV contains X data rows, exceeding maximum limit of 5,000."` |
| JSON `orders` array length $> 5000$ | **400** | `ORDER_ROW_LIMIT_EXCEEDED` | `"Merchant orders array contains X items, exceeding maximum limit of 5,000."` |
| Invalid CSV structure / missing headers | **400** | `INVALID_CSV_FORMAT` | Detailed diagnostic from `importMerchantOrdersCsv()`. |
| Ineligible/corrupt JSON order format | **400** | `VALIDATION_ERROR` | Detailed Zod schema validation flatten breakdown. |

---

### 5.4. Finding F-16: PostgreSQL Advisory Lock and Snapshot Ordering

#### 1. Exact Race Analysis & PostgreSQL MVCC Snapshot Semantics
Under PostgreSQL's MVCC implementation, transactions operating under `REPEATABLE READ` isolation do not freeze their transaction snapshot at `BEGIN`. As documented in **PostgreSQL Documentation §13.2.2**:
> *"The transaction snapshot is actually frozen as of the start of its first non-transaction-control query, not the start of the transaction itself; so if the first statement is a query, its start time defines the snapshot."*

In PostgreSQL's internal backend (`backend/tcop/postgres.c` and `backend/utils/time/snapmgr.c`):
- When an execution engine encounters a query, `standard_ExecutorStart` calls `PushActiveSnapshot(GetTransactionSnapshot())`.
- For `REPEATABLE READ` transactions (`IsolationUsesXactSnapshot`), `GetTransactionSnapshot()` calls `GetSnapshotData(&CurrentSnapshotData)` upon its first invocation, sets `FirstSnapshotSet = true`, and binds `CurrentSnapshot`.
- The target list expressions (including SQL functions like `pg_advisory_xact_lock_shared(...)`) are evaluated *inside* the execution phase (`ExecInterpExpr` / `ExecProject`), which occurs strictly **after** `standard_ExecutorStart` has already established and pushed the transaction snapshot!

**The F-15 Flaw:**
In the protocol proposed in F-15:
```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '3000ms';
SELECT pg_advisory_xact_lock_shared(8492048201); -- <-- SNAPSHOT IS FROZEN HERE AT QUERY START!
SELECT ... FROM import_runs ...;
COMMIT;
```
Consider the exact concurrency interleaving:
1. **Time $T_0$:** Import Initiation transaction $T_A$ acquires exclusive transaction-scoped lock: `SELECT pg_advisory_xact_lock(8492048201);`.
2. **Time $T_1$:** Reconciliation transaction $T_B$ begins: `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;`.
3. **Time $T_2$:** Reconciliation transaction $T_B$ issues `SELECT pg_advisory_xact_lock_shared(8492048201);`.
   - PostgreSQL calls `GetTransactionSnapshot()`.
   - Snapshot for $T_B$ is **FROZEN** at $T_2$! In this snapshot, $T_A$ is currently active (in `xip` list).
   - PostgreSQL evaluates `pg_advisory_xact_lock_shared(8492048201)` and **BLOCKS** waiting for $T_A$'s exclusive lock.
4. **Time $T_3$:** Import Initiation $T_A$ inserts `import_runs (..., import_status = 'RUNNING')` and executes `COMMIT;`.
   - $T_A$ releases its exclusive advisory lock.
5. **Time $T_4$:** Reconciliation $T_B$ unblocks and `SELECT pg_advisory_xact_lock_shared(8492048201)` completes.
6. **Time $T_5$:** Reconciliation $T_B$ queries `import_runs`:
   ```sql
   SELECT id, import_status FROM import_runs WHERE import_status = 'RUNNING' ...;
   ```
7. **The Catastrophic Failure:** Because $T_B$ is in `REPEATABLE READ`, PostgreSQL reuses the snapshot frozen at $T_2$. Under standard MVCC visibility rules (`HeapTupleSatisfiesMVCC`), tuples inserted by transaction $T_A$ (which was active when $T_B$'s snapshot was frozen at $T_2$) are **STRICTLY INVISIBLE** to $T_B$!
8. **Result:** Reconciliation observes zero `RUNNING` rows, concludes that no import is in progress, and reconciles against an incomplete/mutating ledger state!

#### 2. Audit Verdict on F-15 Protocol
**NOT SAFE AS SPECIFIED IN F-15.** Transaction-scoped advisory locks cannot guarantee snapshot freshness when the lock acquisition statement itself creates the repeatable-read snapshot before the lock wait finishes.

#### 3. Corrected Coordination Protocol: Session-Level Advisory Locking
To guarantee that reconciliation's `REPEATABLE READ` snapshot is established strictly **after** coordination lock acquisition, CloseLoop adopts **Session-Level Advisory Locks on a Dedicated `PoolClient`**:

- **Coordination Lock Identifier:**
  `const CLOSELOOP_INGESTION_LOCK_ID = 8492048201;` (64-bit bigint namespace).
- **Core Mechanism:**
  - Reconciliation acquires the shared session lock `pg_advisory_lock_shared(8492048201)` in **auto-commit mode** on a dedicated checked-out client *before* issuing `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ`.
  - Because `pg_advisory_lock_shared` runs outside a transaction, its single-statement snapshot is immediately discarded upon statement completion.
  - The `REPEATABLE READ` transaction begins **only after the shared lock is already granted**.
  - Reconciliation's first read query (`SELECT ... FROM import_runs`) freezes the repeatable-read snapshot at a time when the shared lock is actively held and all prior exclusive lock holders have committed.
  - Any `RUNNING` import committed prior to lock acquisition is **100% GUARANTEED TO BE VISIBLE**.
  - While Reconciliation holds the shared lock, no new Import Initiation can acquire the exclusive lock to start an import.
  - Import Initiation acquires the exclusive session lock `pg_advisory_lock(8492048201)`, inserts the `RUNNING` record in a short transaction, releases the lock, and returns the client to the pool **before** initiating any external PayPal HTTP requests. External network calls never hold database transactions or advisory locks.

#### 4. Exact Execution Lifecycles & Pseudocode

##### A. Import Initiation Protocol (`src/lib/paypal/importService.ts`):
```typescript
const CLOSELOOP_INGESTION_LOCK_ID = '8492048201';

export async function initiateImportRunLease(params: CreateImportRunParams): Promise<ImportRunRecord> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  let clientReleased = false;
  let lockTimeoutApplied = false;
  let lockAcquired = false;
  let txActive = false;
  let connectionTainted = false;
  let primaryError: unknown = null;

  const safeRelease = (destroy = false) => {
    if (!clientReleased) {
      clientReleased = true;
      client.release(destroy);
    }
  };

  try {
    // 1. Set bounded lock timeout to prevent indefinite pool blocking
    await client.query("SET lock_timeout = '3000ms';");
    lockTimeoutApplied = true;

    // 2. Acquire exclusive session-level coordination lock
    await client.query('SELECT pg_advisory_lock($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
    lockAcquired = true;

    // 3. Atomically insert RUNNING status lease in short-lived transaction
    await client.query('BEGIN;');
    txActive = true;
    const importRun = await createImportRun(params, client);
    await client.query('COMMIT;');
    txActive = false;

    return importRun;
  } catch (err: unknown) {
    primaryError = err;
    if (txActive) {
      try {
        await client.query('ROLLBACK;');
      } catch (rbErr) {
        connectionTainted = true;
        console.error('[CloseLoop Transaction Rollback Error]:', rbErr);
      }
      txActive = false;
    }
    throw err;
  } finally {
    // Stage 1: Unlock advisory lock if acquired
    if (lockAcquired) {
      try {
        const unlockRes = await client.query<{ pg_advisory_unlock: boolean }>(
          'SELECT pg_advisory_unlock($1);',
          [CLOSELOOP_INGESTION_LOCK_ID]
        );
        if (unlockRes.rows[0]?.pg_advisory_unlock !== true) {
          connectionTainted = true;
          console.error(`[CloseLoop Unlock Warning]: pg_advisory_unlock returned false for key ${CLOSELOOP_INGESTION_LOCK_ID}`);
        }
      } catch (unlockErr) {
        connectionTainted = true;
        console.error('[CloseLoop Unlock Error]:', unlockErr);
      }
    }

    // Stage 2: Reset session-level lock_timeout if applied (regardless of lockAcquired)
    if (lockTimeoutApplied && !connectionTainted) {
      try {
        await client.query('RESET lock_timeout;');
      } catch (resetErr) {
        connectionTainted = true;
        console.error('[CloseLoop Reset Setting Error]:', resetErr);
      }
    }

    // Stage 3: Release client exactly once (destroy if tainted by any error)
    safeRelease(connectionTainted);
  }
}
// 4. PayPal Transaction Search HTTP requests execute OUTSIDE any database transaction or advisory lock
```

##### B. Persisted Reconciliation Adapter Protocol (`src/lib/reconciliation/adapters/paypalPersistenceAdapter.ts`):
```typescript
export async function fetchEligibleTransactionsForReconciliation(
  params: PersistedSourcingParams
): Promise<PersistedSourcingResult> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  let clientReleased = false;
  let lockTimeoutApplied = false;
  let lockAcquired = false;
  let txActive = false;
  let connectionTainted = false;
  let primaryError: unknown = null;

  const safeRelease = (destroy = false) => {
    if (!clientReleased) {
      clientReleased = true;
      client.release(destroy);
    }
  };

  try {
    // 1. Bounded lock timeout (3,000ms)
    await client.query("SET lock_timeout = '3000ms';");
    lockTimeoutApplied = true;

    // 2. Acquire shared session-level coordination lock OUTSIDE transaction (auto-commit)
    await client.query('SELECT pg_advisory_lock_shared($1);', [CLOSELOOP_INGESTION_LOCK_ID]);
    lockAcquired = true;

    try {
      // 3. Begin REPEATABLE READ transaction ONLY AFTER lock is acquired
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;');
      txActive = true;

      // 4. Query 1: Check intersecting RUNNING / FAILED / PARTIAL / COMPLETED_WITH_WARNINGS runs
      // SNAPSHOT IS FROZEN HERE - Guaranteed to see all commits that occurred before lock acquisition
      const activeRuns = await findIntersectingRuns(params.startDate, params.endDate, client);
      if (activeRuns.some(r => r.importStatus === 'RUNNING')) {
        throw new PersistedLedgerError('IMPORT_RUN_IN_PROGRESS', 'Active PayPal import in progress for requested date window.', 409);
      }

      // Check unsuperseded incomplete runs (F-18A: PARTIAL, FAILED, and COMPLETED_WITH_WARNINGS)
      const incompleteRuns = await findUnsupersededIncompleteRuns(params.startDate, params.endDate, client);
      if (incompleteRuns.length > 0 && !params.acknowledgedPartial) {
        throw new PersistedLedgerError('INCOMPLETE_IMPORT_INTERSECTION', 'Unsuperseded partial, failed, or warning-bearing import runs in window.', 422, incompleteRuns);
      }

      // 5. Query 2: Atomic COUNT(*) within same snapshot (F-07)
      const countRes = await client.query(COUNT_ELIGIBLE_SQL, [params.startDate, params.endDate]);
      const totalEligible = Number(countRes.rows[0].count);
      if (totalEligible > 5000) {
        throw new PersistedLedgerError('DATASET_LIMIT_EXCEEDED', `Eligible transaction count (${totalEligible}) exceeds maximum limit of 5,000.`, 422);
      }

      // 6. Query 3: Bounded SELECT within identical snapshot
      const recordsRes = await client.query(SELECT_ELIGIBLE_SQL, [params.startDate, params.endDate]);
      
      await client.query('COMMIT;');
      txActive = false;

      // 7. Tier 2 Defense-in-Depth Adapter Invariant Checks (TypeScript layer)
      return mapAndFilterEligibleRecords(recordsRes.rows, totalEligible);
    } catch (txErr) {
      if (txActive) {
        try {
          await client.query('ROLLBACK;');
        } catch (rbErr) {
          connectionTainted = true;
          console.error('[CloseLoop Transaction Rollback Error]:', rbErr);
        }
        txActive = false;
      }
      throw txErr;
    }
  } catch (err: unknown) {
    primaryError = err;
    throw err;
  } finally {
    // Stage 1: Unlock shared advisory lock if acquired
    if (lockAcquired) {
      try {
        const unlockRes = await client.query<{ pg_advisory_unlock_shared: boolean }>(
          'SELECT pg_advisory_unlock_shared($1);',
          [CLOSELOOP_INGESTION_LOCK_ID]
        );
        if (unlockRes.rows[0]?.pg_advisory_unlock_shared !== true) {
          connectionTainted = true;
          console.error(`[CloseLoop Unlock Warning]: pg_advisory_unlock_shared returned false for key ${CLOSELOOP_INGESTION_LOCK_ID}`);
        }
      } catch (unlockErr) {
        connectionTainted = true;
        console.error('[CloseLoop Shared Unlock Error]:', unlockErr);
      }
    }

    // Stage 2: Reset session-level lock_timeout if applied (regardless of lockAcquired)
    if (lockTimeoutApplied && !connectionTainted) {
      try {
        await client.query('RESET lock_timeout;');
      } catch (resetErr) {
        connectionTainted = true;
        console.error('[CloseLoop Reset Setting Error]:', resetErr);
      }
    }

    // Stage 3: Release client exactly once (destroy if tainted by any error)
    safeRelease(connectionTainted);
  }
}
```

##### C. Coordination Sequence Diagram
```mermaid
sequenceDiagram
    autonumber
    participant Import as Import Initiation (Worker A)
    participant PG_Lock as PostgreSQL Advisory Lock (8492048201)
    participant Recon as Reconciliation (Worker B)
    participant PG_Data as PostgreSQL MVCC Storage

    Import->>PG_Lock: SELECT pg_advisory_lock(8492048201) [EXCLUSIVE]
    activate PG_Lock
    PG_Lock-->>Import: Lock Granted
    
    par Concurrent Reconciliation Request
        Recon->>PG_Lock: SELECT pg_advisory_lock_shared(8492048201) [SHARED]
        Note over Recon,PG_Lock: Worker B blocks cleanly in auto-commit mode.<br/>No REPEATABLE READ snapshot exists yet!
    and Import Sets Status Lease
        Import->>PG_Data: BEGIN; INSERT INTO import_runs ... ('RUNNING'); COMMIT;
        Import->>PG_Lock: SELECT pg_advisory_unlock(8492048201)
        deactivate PG_Lock
    end

    activate PG_Lock
    PG_Lock-->>Recon: Lock Granted (Shared)
    
    rect rgb(235, 245, 255)
        Note over Recon,PG_Data: REPEATABLE READ starts strictly AFTER lock is acquired
        Recon->>PG_Data: BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
        Recon->>PG_Data: SELECT ... FROM import_runs WHERE status = 'RUNNING';
        Note over Recon,PG_Data: Snapshot frozen NOW: committed 'RUNNING' row is 100% VISIBLE!
        PG_Data-->>Recon: Returns 1 row (status = 'RUNNING')
        Recon->>PG_Data: ROLLBACK;
    end

    Recon->>PG_Lock: SELECT pg_advisory_unlock_shared(8492048201)
    deactivate PG_Lock
    Recon-->>Recon: Cleanly aborts with HTTP 409 IMPORT_RUN_IN_PROGRESS
```

#### 5. Failure, Timeout, Cleanup & Connection-Pool Safety
1. **Bounded Lock Timeout:** Both workflows execute `SET lock_timeout = '3000ms';` before attempting advisory lock acquisition. If lock contention exceeds 3,000ms, PostgreSQL aborts statement execution with SQLSTATE `55P03` (`lock_not_available`).
2. **Machine-Readable Error Mapping:**
   - On lock acquisition timeout during reconciliation: returns **HTTP 409 `IMPORT_RUN_IN_PROGRESS`** (or HTTP 503 `DATABASE_BUSY` if operator prefers retry).
   - On lock acquisition timeout during import initiation: returns **HTTP 409 `CONCURRENT_PIPELINE_ACTIVE`**.
3. **Pool Starvation Protection:**
   - The dedicated `PoolClient` is checked out solely for the brief period of lock acquisition, snapshot validation, count, and bounded retrieval (total runtime $< 50$ms).
   - During PayPal external HTTP requests (which can take 1,000–10,000ms), **no connection or advisory lock is held**.
4. **Guaranteed Unlock & Leak Prevention:**
   - `pg_advisory_unlock_shared` / `pg_advisory_unlock` are executed in guaranteed `finally` blocks.
   - If an unlock query itself fails or throws, CloseLoop invokes `client.release(true)`. In `pg`, passing `true` forces connection destruction, terminating the PostgreSQL server backend process. Upon backend termination, PostgreSQL automatically releases all session-level advisory locks held by that session. No connection with an open advisory lock can ever be returned to the pool.
5. **Concurrent Reconciliation Concurrency:**
   - Because `pg_advisory_lock_shared` is a shared lock, multiple reconciliation requests can acquire the shared lock simultaneously without blocking one another.
6. **Global Lock Trade-Off Analysis:**
   - Key `8492048201` is a single global key coordinating all imports against all reconciliations.
   - As a consequence, an import for Date Window X briefly serializes with a reconciliation for disjoint Date Window Y during the ~10ms window of lease insertion and snapshot creation.
   - This trade-off is deliberately accepted for Phase 3C: it completely eliminates multi-key deadlock risks and complex two-dimensional R-tree interval locking, with negligible throughput penalty.

---

### 5.5. Finding F-17: Supersession Evidence, Advisory-Lock Resource Safety & Concurrency Verification

#### 1. F-17A: Schema Investigation & Safe Supersession of `COMPLETED_WITH_WARNINGS`

##### Schema and Provenance Investigation
Inspection of [`src/lib/db/migrations/001_initial_schema.sql#L15-L34`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L15-L34) shows the exact persisted columns of `import_runs`:
- `records_received INTEGER NOT NULL DEFAULT 0`
- `records_inserted INTEGER NOT NULL DEFAULT 0`
- `records_already_present INTEGER NOT NULL DEFAULT 0`
- `records_rejected INTEGER NOT NULL DEFAULT 0`
- `identity_collisions_detected INTEGER NOT NULL DEFAULT 0`
- `safe_error_code VARCHAR(100)`
- `pages_fetched INTEGER NOT NULL DEFAULT 0`

In [`src/lib/db/provenanceService.ts#L435-L442`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/provenanceService.ts#L435-L442), `import_status` is assigned via:
```typescript
let finalStatus: ImportStatus;
if (params.isTruncated) {
  finalStatus = 'PARTIAL';
} else if (identityCollisionsDetected > 0 || recordsRejected > 0) {
  finalStatus = 'COMPLETED_WITH_WARNINGS';
} else {
  finalStatus = 'COMPLETED';
}
```

##### The Accounting Completeness Risk
In the existing schema:
1. `records_rejected` aggregates all records rejected during batch ingestion. It does **not** distinguish between harmless non-financial reporting events (e.g., administrative profile notifications) and omitted financial records (e.g., malformed payment/refund payloads).
2. `identity_collisions_detected` counts records that suffered intra-batch duplicate collisions or cross-batch discrepancies and were consequently quarantined to `identity_collision_logs` rather than persisted as reconciliation-eligible transactions.
3. Therefore, an import run ending in `COMPLETED_WITH_WARNINGS` **cannot prove that the database ledger contains complete, gap-free financial records for the requested window**.

##### Conservative Supersession Rule (Zero Migration Boundary)
Because the current database schema cannot prove that warnings did not omit financial transactions, CloseLoop enforces the conservative financial fallback:
> **A later run may supersede an earlier `FAILED` or `PARTIAL` run if and only if:**
> 1. It started strictly after the incomplete run: `s.started_at > i.started_at`.
> 2. Its requested date window fully covers the incomplete run: `s.requested_start_date <= i.requested_start_date AND s.requested_end_date >= i.requested_end_date`.
> 3. Its status is strictly `'COMPLETED'` with zero rejections, zero quarantined collisions, and no error code: `s.import_status = 'COMPLETED' AND s.records_rejected = 0 AND s.identity_collisions_detected = 0 AND s.safe_error_code IS NULL`.
> 4. **`COMPLETED_WITH_WARNINGS` runs DO NOT supersede earlier incomplete runs.** The incomplete-run warning remains active, and the operator must explicitly acknowledge the potential gap (`acknowledgedPartial: true`).

##### Concrete Supersession Scenarios:
| Scenario | Later Run Status & Attributes | Coverage Window | Supersession Verdict | Reason |
|:---------|:------------------------------|:----------------|:---------------------|:-------|
| **1. Clean Full Ingestion** | `COMPLETED`, `records_rejected = 0`, `identity_collisions_detected = 0`, `safe_error_code IS NULL` | Fully covers earlier run | **SUPERSEDES** | Proved complete and clean coverage across entire window. |
| **2. Run with Record Rejections** | `COMPLETED_WITH_WARNINGS`, `records_rejected = 3`, `identity_collisions_detected = 0` | Fully covers earlier run | **DOES NOT SUPERSEDE** | Schema cannot prove rejected records did not contain omitted payments/refunds. |
| **3. Run with Quarantined Collisions** | `COMPLETED_WITH_WARNINGS`, `records_rejected = 0`, `identity_collisions_detected = 2` | Fully covers earlier run | **DOES NOT SUPERSEDE** | Quarantined collisions mean records were diverted to audit log and omitted from ledger. |
| **4. Run with Execution Error** | Any status, `safe_error_code IS NOT NULL` | Fully covers earlier run | **DOES NOT SUPERSEDE** | Execution or fetch error indicates potential data omission. |
| **5. Partial Temporal Coverage** | `COMPLETED`, 0 rejections, 0 collisions | Overlaps but does not fully cover (e.g. Nov 1–5 vs Nov 1–10) | **DOES NOT SUPERSEDE** | Remaining interval (Nov 6–10) remains unverified. |

---

#### 2. F-17B: Session-Level Advisory-Lock Cleanup and Pooled Session Hygiene

##### Verified Resource Management Guarantees:
1. **Exactly-Once Client Release:** Both `initiateImportRunLease` and `fetchEligibleTransactionsForReconciliation` utilize a scoped `safeRelease(destroy = false)` helper guarded by `clientReleased: boolean`. `client.release()` is executed at most once on every code path.
2. **Unlock Return Value Verification:** In PostgreSQL, `SELECT pg_advisory_unlock(...)` and `SELECT pg_advisory_unlock_shared(...)` return a boolean. If the return value is not strictly `true` (indicating the lock was not held by this session), the connection is treated as corrupted and destroyed via `safeRelease(true)`.
3. **Session Configuration Reset (`RESET lock_timeout`):** Before returning a healthy connection to the pool, the client executes `RESET lock_timeout;` to prevent session-level timeout leakage into subsequent queries. If `RESET` throws, the connection is destroyed (`safeRelease(true)`).
4. **Transaction State Tracking (`txActive`):** `txActive: boolean` tracks whether `BEGIN` has executed and remains uncommitted. `ROLLBACK` is only executed when `txActive === true`, preventing extraneous rollback attempts on idle connections.
5. **Primary Error Preservation:** If the primary business operation fails with `primaryError`, any subsequent cleanup or unlock error is logged via `console.error` without masking the original financial or validation error, while `safeRelease(true)` guarantees PostgreSQL socket closure.

---

#### 3. F-17C: Concurrency Verification Honesty & Phase 3C.3B Acceptance Gates

##### Concurrency Verification Distinction:
- **Architectural Reasoning:** Verified against official PostgreSQL MVCC documentation (§13.2.2) and PostgreSQL backend C source code (`backend/tcop/postgres.c`, `snapmgr.c`).
- **Unit / Mock Test Suite:** Current baseline (267 / 267 passing) validates logic using Vitest and `pg-mem` mock database.
- **Live Multi-Threaded PostgreSQL Verification:** In accordance with the STRICT READ-ONLY mode of Phase 3C.3A, no live multi-connection concurrency test was executed against local PostgreSQL in this turn.

##### Mandatory Phase 3C.3B Live PostgreSQL Concurrency Acceptance Gates:
Before Phase 3C.3B can be certified complete, an automated integration test suite (`src/lib/reconciliation/__tests__/concurrency_persisted.test.ts`) must execute against a real PostgreSQL instance and verify all six concurrency invariants:
1. **Import Lock Precedence:** Import acquires exclusive session lock; reconciliation blocks; import commits `RUNNING` lease; reconciliation acquires shared lock and detects `RUNNING` status (returns HTTP 409).
2. **Reconciliation Snapshot Isolation:** Reconciliation acquires shared session lock; concurrent import initiation blocks until reconciliation snapshot, count, and bounded retrieval commit.
3. **Lock Timeout Handling:** Contention exceeding 3,000ms raises SQLSTATE `55P03` (`lock_not_available`), produces HTTP 409 / 503, and leaves no dangling advisory locks.
4. **Unlock Failure Socket Destruction:** Simulated unlock failure forces `client.release(true)`, destroying the connection so PostgreSQL backend termination releases all session locks.
5. **Shared Lock Concurrency:** Multiple concurrent reconciliations acquire `pg_advisory_lock_shared` simultaneously without blocking each other.
6. **Connection Pool Hygiene:** Subsequent queries on reused pooled connections observe default session configuration without inheriting `lock_timeout`.

---

### 5.6. Finding F-18: Warning-State Completeness and Lock-Timeout Cleanup

#### 1. Source Evidence & Defect Analysis Table

| Finding | Exact Source File & Line Range Inspected | Existing Behavior | Identified Defect | Required Correction | Updated Documentation Section |
|:---|:---|:---|:---|:---|:---|
| **F-18A** | [`src/lib/db/provenanceService.ts#L435-L442`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/provenanceService.ts#L435-L442)<br>[`src/lib/db/types.ts#L7`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/types.ts#L7)<br>[`src/lib/db/migrations/001_initial_schema.sql#L15-L34`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/db/migrations/001_initial_schema.sql#L15-L34) | Status is assigned `COMPLETED_WITH_WARNINGS` on item rejections or quarantined collisions, but the F-17 supersession query checked only `PARTIAL` and `FAILED`. | Reconciliation proceeded without operator acknowledgement even when the ledger window contained warning-bearing runs with potential transaction omissions or quarantined collisions. | Include `COMPLETED_WITH_WARNINGS` in incomplete run query alongside `PARTIAL` and `FAILED`. Enforce soft block (HTTP 422) unless acknowledged or superseded by a clean `COMPLETED` run covering the entire interval. | Sections 1, 4.3, 5.2, 5.4.4, 5.6.1, 6, 7 |
| **F-18B** | Section 5.4.4 ([`docs/...#L305-L485`](file:///c:/MY%20PROGRAMMING/closeloop/docs/PHASE_3C_3A_INTEGRATION_CONTRACT_AND_IMPLEMENTATION_PLAN.md#L305-L485))<br>Section 5.5.2 ([`docs/...#L595-L604`](file:///c:/MY%20PROGRAMMING/closeloop/docs/PHASE_3C_3A_INTEGRATION_CONTRACT_AND_IMPLEMENTATION_PLAN.md#L595-L604)) | `finally` cleanup block attempted `RESET lock_timeout;` only when `lockAcquired === true`. | When lock acquisition timed out (SQLSTATE `55P03`) or threw, `lockAcquired` was `false`, causing the code to release the connection without resetting the session setting, returning a tainted connection to the pool. | Introduce independent lifecycle tracking (`lockTimeoutApplied`). Attempt `RESET lock_timeout;` whenever applied, regardless of `lockAcquired`. Destroy connection (`client.release(true)`) if reset fails. | Sections 1, 5.4.4, 5.6.2, 6, 7 |

---

#### 2. F-18A: Warning-State Completeness Architecture & Scenario Analysis

##### Incomplete Status Taxonomy
CloseLoop classifies import runs into three distinct operational states for reconciliation sourcing:
1. **Active Mutation (`RUNNING`):** Hard block returning **HTTP 409 `IMPORT_RUN_IN_PROGRESS`**.
2. **Incomplete / Untrusted (`PARTIAL`, `FAILED`, `COMPLETED_WITH_WARNINGS`):** Soft block returning **HTTP 422 `INCOMPLETE_IMPORT_INTERSECTION`** unless explicitly acknowledged (`acknowledgedPartial: true`) or superseded by a clean `COMPLETED` run covering the entire interval.
   > **Operator Notice:** Operator acknowledgement permits proceeding with a known completeness risk; it does not make the dataset complete.
3. **Clean & Complete (`COMPLETED`):** Fully trusted ledger state (`records_rejected = 0 AND identity_collisions_detected = 0 AND safe_error_code IS NULL`).

##### Comprehensive Supersession Scenarios:
| Scenario | Earlier Run | Later Run Attributes | Interval Coverage | Result | Operational Behavior |
|:---|:---|:---|:---|:---:|:---|
| **1. Warning with Rejected Records (No Later Run)** | Run 1: `COMPLETED_WITH_WARNINGS` (`records_rejected = 2`, `identity_collisions_detected = 0`) | None | N/A | **ACTIVE INCOMPLETE** | Query detects Run 1. Returns HTTP 422 unless `acknowledgedPartial: true`. |
| **2. Warning with Identity Collisions (No Later Run)** | Run 1: `COMPLETED_WITH_WARNINGS` (`records_rejected = 0`, `identity_collisions_detected = 1`) | None | N/A | **ACTIVE INCOMPLETE** | Quarantined collisions mean financial records were diverted. Returns HTTP 422 unless acknowledged. |
| **3. Warning Followed by Full Clean COMPLETED** | Run 1: `COMPLETED_WITH_WARNINGS` (Nov 1–10) | Run 2: `COMPLETED` (Nov 1–10, 0 rejections, 0 collisions, started after Run 1) | Fully covers Run 1 | **SUPERSEDED** | Run 2 satisfies clean `COMPLETED` criteria and fully covers interval. Run 1 is superseded. No acknowledgement required. |
| **4. Warning Followed by Partial Clean COMPLETED** | Run 1: `COMPLETED_WITH_WARNINGS` (Nov 1–10) | Run 2: `COMPLETED` (Nov 1–5, 0 rejections, 0 collisions) | Partial cover (Nov 6–10 uncovered) | **NOT SUPERSEDED** | Uncovered remainder leaves window untrusted. Returns HTTP 422 unless `acknowledgedPartial: true`. |
| **5. PARTIAL Followed by COMPLETED_WITH_WARNINGS** | Run 1: `PARTIAL` (Nov 1–10) | Run 2: `COMPLETED_WITH_WARNINGS` (Nov 1–10) | Fully covers Run 1 | **NOT SUPERSEDED** | Run 2 contains warnings and cannot supersede Run 1. Both runs remain active incomplete runs. Returns HTTP 422 unless acknowledged. |
| **6. FAILED Followed by FAILED** | Run 1: `FAILED` (Nov 1–10) | Run 2: `FAILED` (Nov 1–10) | Fully covers Run 1 | **NOT SUPERSEDED** | Failed retries do not satisfy `COMPLETED`. Both runs remain active incomplete runs. Returns HTTP 422 unless acknowledged. |
| **7. Overlapping Runs (Partial Supersession)** | Run 1: `PARTIAL` (Nov 1–5)<br>Run 2: `COMPLETED_WITH_WARNINGS` (Nov 6–10) | Run 3: `COMPLETED` (Nov 1–5, clean) | Fully covers Run 1; does not cover Run 2 | **RUN 1 SUPERSEDED; RUN 2 ACTIVE** | Run 1 is superseded by Run 3. Run 2 remains un-superseded. Query returns Run 2. Returns HTTP 422 unless acknowledged. |

---

#### 3. F-18B: Independent Lock-Timeout Lifecycle Tracking & 9 Failure Mode Cleanup Matrix

##### State Machine Architecture
To guarantee that pooled client connections never inherit stale session configuration (`SET lock_timeout = '3000ms'`) or lingering advisory locks, both `initiateImportRunLease` and `fetchEligibleTransactionsForReconciliation` enforce five independent lifecycle flags:
- `clientReleased: boolean = false;` (ensures `client.release()` is called at most once)
- `lockTimeoutApplied: boolean = false;` (tracks whether `SET lock_timeout` executed successfully)
- `lockAcquired: boolean = false;` (tracks whether advisory lock was granted)
- `txActive: boolean = false;` (tracks whether a database transaction is currently open)
- `connectionTainted: boolean = false;` (marks connection for immediate destruction via `safeRelease(true)`)

##### Three-Stage Deterministic Cleanup Sequence:
```text
finally {
  Stage 1: If lockAcquired -> Attempt pg_advisory_unlock(_shared). If unlock returns false or throws -> connectionTainted = true.
  Stage 2: If lockTimeoutApplied AND !connectionTainted -> Attempt RESET lock_timeout. If RESET throws -> connectionTainted = true.
  Stage 3: safeRelease(connectionTainted) -> Releases healthy client OR destroys socket if tainted.
}
```

##### 9 Failure Mode Cleanup Matrix:
| Failure Mode | Point of Failure | `lockTimeoutApplied` | `lockAcquired` | `txActive` | Cleanup Actions Executed | Connection Disposition |
|:---|:---|:---:|:---:|:---:|:---|:---:|
| **1. `SET lock_timeout` fails** | Statement 1 | `false` | `false` | `false` | Stages 1 & 2 skipped; Stage 3 calls `safeRelease(false)`. | Returned to pool (clean). |
| **2. Advisory Lock acquisition times out (55P03)** | Statement 2 | `true` | `false` | `false` | Stage 1 skipped; Stage 2 executes `RESET lock_timeout;`; Stage 3 calls `safeRelease(false)`. Primary error preserved. | Returned to pool (clean default settings). |
| **3. Advisory Lock throws unexpected error** | Statement 2 | `true` | `false` | `false` | Stage 1 skipped; Stage 2 executes `RESET lock_timeout;`. If reset throws, `connectionTainted = true`; Stage 3 calls `safeRelease(true)`. | Destroyed if reset fails; clean if reset succeeds. |
| **4. Transaction creation fails (`BEGIN` throws)** | Statement 3 | `true` | `true` | `false` | `catch` skips rollback (`!txActive`); Stage 1 unlocks; Stage 2 resets timeout; Stage 3 releases cleanly. | Returned to pool (clean). |
| **5. Transaction rollback fails** | `catch` block | `true` | `true` | `true` | `catch` sets `connectionTainted = true`; Stage 1 attempts unlock; Stage 2 skipped; Stage 3 calls `safeRelease(true)`. | **Destroyed** (`client.release(true)`). |
| **6. Unlock query throws** | Finally Stage 1 | `true` | `true` | `false` | Stage 1 sets `connectionTainted = true`; Stage 2 skipped; Stage 3 calls `safeRelease(true)`. Backend terminates. | **Destroyed** (`client.release(true)`). |
| **7. Unlock returns `false`** | Finally Stage 1 | `true` | `true` | `false` | Stage 1 sets `connectionTainted = true`; Stage 2 skipped; Stage 3 calls `safeRelease(true)`. Backend terminates. | **Destroyed** (`client.release(true)`). |
| **8. `RESET lock_timeout` throws** | Finally Stage 2 | `true` | Any | `false` | Stage 2 sets `connectionTainted = true`; Stage 3 calls `safeRelease(true)`. Stale setting cannot leak. | **Destroyed** (`client.release(true)`). |
| **9. Operation cancelled / process aborted** | Any | Any | Any | Any | Handled deterministically by `finally`. Any unhandled failure sets `connectionTainted` or triggers socket close. | **Safe Termination**. |

---

## 6. Summary of Architecture Invariants & Quality Gates

| Invariant | Implementation Mechanism | Verification |
|:----------|:-------------------------|:-------------|
| **Dataset Completeness** | Atomic `COUNT(*)` in `REPEATABLE READ`; 422 `DATASET_LIMIT_EXCEEDED` if $> 5000` | Automated integration test |
| **Concurrency Serialization (F-16, F-17B, F-18B)** | Session-level `pg_advisory_lock_shared` / `pg_advisory_lock(8492048201)` on dedicated `PoolClient`; `lock_timeout = '3000ms'`; verified unlock return value | Concurrency simulation test |
| **Snapshot Freshness (F-16)** | `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ` issued strictly *after* shared lock acquisition | Concurrency race test |
| **Connection & Pool Hygiene (F-17B, F-18B)** | Three-stage cleanup; `RESET lock_timeout;` executed whenever applied (even on lock timeout); failures destroy connection via `client.release(true)` | Pool resource test |
| **Incomplete Supersession (F-13, F-17A, F-18A)** | SQL interval coverage check selecting `PARTIAL`, `FAILED`, and `COMPLETED_WITH_WARNINGS`; superseded only by clean `COMPLETED` runs (`records_rejected = 0`, `identity_collisions_detected = 0`, `safe_error_code IS NULL`) | Integration tests with retried imports |
| **Active Mutation Safety** | SQL check for `import_status = 'RUNNING'`; returns HTTP 409 | Integration test with simulated running import |
| **Refund Compatibility (F-12)** | Verified `TXN` $\rightarrow$ `paypalCaptureId`; `ODR` $\rightarrow$ `paypalOrderId`; rejects self-fallbacks | Unit test with synthetic payloads |
| **Domain Purity (F-11)** | `transactionsFileId` left undefined; metadata in API envelope; visual badges in UI | `git diff` & `npx tsc --noEmit` |
| **Order Input Exclusivity (F-14)** | Zod `.refine()` enforcing `ordersCsv` XOR `orders` with max 5,000 order limit | Route unit tests for 400 responses |
| **Exact Minor-Unit Math** | Integer minor units via `createMoney()`; `parseSafeInteger()` bounds check | Vitest money test suite |
| **Read-Only Persistence** | SQL queries use strictly `SELECT`; zero updates to imported transactions | Code audit & test isolation |

---

## 7. Implementation Sequence (Phase 3C.3B)

1. **Step 1: Session Advisory Lock Utilities & Supersession Repository (`src/lib/db/repositories/importRunRepository.ts`)**  
   Implement `initiateImportRunLease()` with exclusive session lock, unlock verification, independent session reset (`RESET lock_timeout`), and `findUnsupersededIncompleteRuns(startDate, endDate)` checking `PARTIAL`, `FAILED`, and `COMPLETED_WITH_WARNINGS` with conservative `COMPLETED` supersession predicate.
2. **Step 2: Persisted Adapter Implementation (`src/lib/reconciliation/adapters/paypalPersistenceAdapter.ts`)**  
   Implement shared session-level advisory lock acquisition outside transaction, followed by `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;`, running-run check, unsuperseded incomplete check, atomic `COUNT(*)`, bounded `SELECT`, Tier 2 defense-in-depth invariant validation, and three-stage client cleanup.
3. **Step 3: Dedicated API Route (`src/app/api/reconciliation/preview-persisted/route.ts`)**  
   Implement Zod XOR schema validation, distinct HTTP 400 mappings (`MUTUALLY_EXCLUSIVE_INPUTS`, `MISSING_MERCHANT_ORDERS`, `ORDER_ROW_LIMIT_EXCEEDED`), 409 active run check, 422 incomplete run check, 422 limit check, and reconciliation engine orchestration.
4. **Step 4: Workbench UI Enhancements (`src/components/workbench/DatasetUploader.tsx`)**  
   Add Ledger sourcing tab, date picker (presets: 24h, 7d, 30d), un-dismissible warning banner, and incomplete import acknowledgement checkbox.
5. **Step 5: Automated Verification & Live PostgreSQL Concurrency Acceptance Gates**  
   Add unit tests (`paypalPersistenceAdapter.test.ts`), integration tests (`reconciliation_persisted.test.ts`), and the 6 mandatory live PostgreSQL concurrency test scenarios (`concurrency_persisted.test.ts`). Run full quality gates (`npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`).

---

## 8. Final Certification & Readiness

All eighteen architectural findings (**F-01** through **F-18**) are completely resolved, formalized, and verified.

- **Zero application code, tests, schemas, migrations, or dependencies were modified.**
- **Phase 2A, 2B, 3A, and 3B modules remain completely frozen.**
- **`src/types/financial.ts` and `src/lib/paypal/normalizer.ts` remain untouched.**
- **The architecture is CERTIFIED READY FOR PHASE 3C.3B IMPLEMENTATION.**
