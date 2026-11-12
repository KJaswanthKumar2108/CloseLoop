# CloseLoop — Phase 3D.2 Implementation & Acceptance Report
## Read-Only AI Investigation Engine

**Role:** Principal AI Systems Architect, FinTech Security Engineer, and Senior Backend Engineer  
**Project:** CloseLoop — AI-Powered PayPal Payment Exception Resolution  
**Tagline:** *Find it. Explain it. Fix it. Close it.*  
**Milestone:** Phase 3D.2 — Read-Only AI Investigation Engine  
**Status:** IMPLEMENTATION COMPLETE & VERIFIED  
**Date:** 2026-11-10  

---

## 1. Executive Summary & Verification Metrics

Phase 3D.2 introduces a **pure read-only AI investigation engine** to CloseLoop. The engine consumes persisted exception cases and immutable evidence graphs established in Phase 3D.1, constructs bounded and sanitized prompts with strict passive-data framing to defeat prompt injection, invokes an AI provider (production: Google Gemini 2.5 Flash; hermetic CI/testing: deterministic mock), verifies evidence grounding to reject hallucinations, and persists append-only investigation audit records with composite tenant integrity.

### Strict Scope & Security Invariants
- **Zero Mutation Guarantee:** AI investigation has **zero execution authority**. It cannot resolve cases, alter balances, initiate refunds, or modify reconciliation/ledger records. All case records remain in their prior state (e.g. `OPEN`) with unaltered versions and minor currency amounts.
- **Strict Grounding:** Every established fact and inference must cite verified `evidenceId` or `sourceRecordId` references present in the case context. Hallucinated citations are rejected before persistence.
- **Tenant Isolation (F-23):** Server-side authoritative merchant identity resolution is enforced across all API endpoints, preventing cross-tenant access and header spoofing.
- **Database Safety:** Applied strictly additive migration `011_case_investigations.sql` with composite tenant foreign key `(case_id, merchant_id) ON DELETE RESTRICT`. Tested against local PostgreSQL 18.4 database `closeloop_test` without destructive commands.
- **Protected Financial Core Integrity:** Zero byte modifications to `matcher/**`, `importer/**`, `fixtures/**`, `money.ts`, `financial.ts`, or migrations `001_` through `007_`.

### Quality & Verification Metrics
| Verification Metric | Target | Achieved Result |
| :--- | :--- | :--- |
| **Total Vitest Tests** | >= 365 | **403 passing** (28 test files) |
| **Test Failures / Skips** | 0 / 0 | **0 failed / 0 skipped** |
| **Phase 3D.2 Dedicated AI Tests** | >= 25 | **38 passing** (6 test suites) |
| **Live PostgreSQL Acceptance Gates** | 5 / 5 | **5 / 5 PASS** on `closeloop_test` |
| **TypeScript Typecheck (`tsc --noEmit`)** | 0 errors | **0 errors** |
| **ESLint (`npm run lint`)** | 0 errors | **0 errors, 0 warnings** |
| **Production Build (`npm run build`)** | Success | **Success** (Turbopack, Next.js 16.4.5) |

---

## 2. Architecture & Design Implementation

The investigation pipeline operates strictly unidirectionally:

```
[Exception Case + Evidence Graph (PostgreSQL)]
                   │
                   ▼ (Pure Read-Only Query)
       [Evidence Context Builder]
         - Max 30 items
         - Max 100KB payload
         - SHA-256 evidence fingerprint
         - Unicode NFC normalization
                   │
                   ▼
       [Prompt Injection Defense]
         - Strict passive data delimiters
         - Zero-command execution mandate
         - System instruction boundary
                   │
                   ▼
        [AI Provider Abstraction]
         ├── Gemini 2.5 Flash (Production)
         └── Deterministic Mock (Hermetic CI/Testing)
                   │
                   ▼
    [Grounding & Schema Verification]
         - Zod Schema validation (v1.0)
         - Grounding verifier (rejects ungrounded citations)
                   │
                   ▼
       [Case Investigation Audit Log]
         - Append-only in PostgreSQL (Migration 011)
         - Composite foreign key (case_id, merchant_id)
         - ON DELETE RESTRICT protection
```

### Component Breakdown

1. **Vendor-Neutral AI Provider Abstraction (`src/lib/ai/types.ts`, `provider.ts`):**
   - Implements `AIProviderClient` interface with `investigate(request: AIProviderRequest): Promise<AIProviderResponse>`.
   - `GeminiAIProviderClient` (`src/lib/ai/geminiProvider.ts`): Supports Google Gemini 2.5 Flash, structured JSON mode, timeout enforcement via `AbortController`, exponential backoff retry for transient network errors, and complete credential masking (never exposes `GEMINI_API_KEY` in errors).
   - `MockAIProviderClient` (`src/lib/ai/mockProvider.ts`): Provides deterministic outputs, simulated timeouts (`PROVIDER_TIMEOUT`), simulated rate limits (`RATE_LIMIT_EXCEEDED`), simulated malformed JSON, and hallucinated citation injection for test coverage.
   - `resolveAIProviderClient`: Resolves configured provider based on `CLOSELOOP_AI_PROVIDER` and server credentials, defaulting safely to mock in test environments.

2. **Deterministic Evidence Context Builder (`src/lib/ai/contextBuilder.ts`):**
   - Retrieves case detail and evidence items via `findCaseById(pool, caseId, merchantId)`.
   - Normalizes strings to Unicode NFC form.
   - Computes deterministic SHA-256 fingerprint over case ID, version, and evidence content hashes.
   - Enforces context bounds: maximum 30 evidence items (`MAX_CONTEXT_EVIDENCE_ITEMS`) and 100KB payload size limit (`MAX_CONTEXT_BYTE_SIZE`).

3. **Prompt Injection & Untrusted Data Defense Engine (`src/lib/ai/promptDefense.ts`):**
   - Encloses untrusted merchant notes, order payloads, and transaction references inside strict boundary delimiters:
     `<<<BEGIN_UNTRUSTED_FINANCIAL_EVIDENCE>>> ... <<<END_UNTRUSTED_FINANCIAL_EVIDENCE>>>`.
   - Frames all evidence strictly as **passive data**, explicitly instructing the model to disregard any instruction, command override, or prompt injection embedded in financial records.
   - Imposes read-only advisory boundaries: model is instructed it possesses zero authority to resolve cases or modify balances.

4. **Structured Output Validation & Grounding Verification (`src/lib/ai/schemas.ts`):**
   - Validates model output strictly against `InvestigationResultSchema` (v1.0) with Zod.
   - Enforces `validateEvidenceGrounding()`: Every citation in `establishedFacts[].sourceEvidenceIds` and `inferences[].supportingEvidenceIds` must exist in the context's verified evidence IDs or source record IDs. Throws `GroundingValidationError` (`422 Unprocessable Entity`) on hallucinated citations.
   - Enforces mandatory advisory disclaimer: `"AI-generated investigation. Findings are advisory and require human verification. No payment, refund, settlement, or ledger operation has been executed."`.

5. **Investigation Repository & Append-Only Audit Trail (`src/lib/ai/investigationRepository.ts`):**
   - Persists investigation runs to `case_investigations` table with composite foreign key `(case_id, merchant_id)`.
   - Records `COMPLETED` records with structured results, prompt versions, schema versions, and token usage.
   - Records `FAILED` records with safe error codes (e.g. `PROVIDER_TIMEOUT`, `GROUNDING_VALIDATION_FAILED`) when upstream calls or validation fail, preserving complete audit transparency.

6. **Investigation API Endpoints (`src/app/api/exceptions/cases/[id]/investigate/route.ts`):**
   - `POST /api/exceptions/cases/[id]/investigate`: Triggers read-only investigation, validates UUID, resolves authoritative merchant identity per F-23, invokes `investigateCase`, and returns HTTP 200 with structured analysis.
   - `GET /api/exceptions/cases/[id]/investigate`: Lists historical investigations for a case in reverse chronological order with HTTP 200.

7. **Operator UI Integration (`src/components/exceptions/CaseInvestigationPanel.tsx`, `src/app/exceptions/page.tsx`):**
   - Embedded directly into the exception detail workspace.
   - Displays "Run AI Investigation" action with loading indicator and error boundary.
   - Renders structured investigation cards:
     - Financial summary and concise explanation.
     - Established observed facts with verified citation badges.
     - AI inferences with explicit confidence indicators (HIGH/MEDIUM/LOW) and rationale.
     - Missing evidence items and retrieval guidance.
     - Suggested operator next steps with target systems.
     - Mandatory advisory financial disclaimer in high-visibility warning container.
   - Displays historical investigation audit runs with status badges and timestamps.

---

## 3. Database Migration 011

**File:** `src/lib/db/migrations/011_case_investigations.sql`

```sql
CREATE TABLE IF NOT EXISTS case_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL,
  merchant_id VARCHAR(100) NOT NULL,
  case_version INTEGER NOT NULL,
  evidence_fingerprint VARCHAR(64) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(20) NOT NULL,
  schema_version VARCHAR(20) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED',
  investigation_result JSONB,
  safe_error_code VARCHAR(100),
  safe_error_message TEXT,
  tokens_used JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_case_investigations_tenant FOREIGN KEY (case_id, merchant_id)
    REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT,
  CONSTRAINT chk_case_investigations_status CHECK (status IN ('COMPLETED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_case_investigations_lookup ON case_investigations(merchant_id, case_id);
CREATE INDEX IF NOT EXISTS idx_case_investigations_created ON case_investigations(case_id, created_at DESC);
```

### Down Migration
**File:** `src/lib/db/migrations/011_case_investigations_down.sql`
Drops table `case_investigations` cleanly and non-destructively.

---

## 4. Live PostgreSQL Acceptance Verification (`closeloop_test`)

The 5 dedicated live PostgreSQL acceptance gates in `src/lib/ai/__tests__/investigation_pg.test.ts` were executed against local PostgreSQL 18.4 (`closeloop_test` on `localhost:5432`):

### Gate 1: Composite Tenant Foreign Key Enforcement
- **Constraint Tested:** `CONSTRAINT fk_case_investigations_tenant FOREIGN KEY (case_id, merchant_id) REFERENCES exception_cases(id, merchant_id) ON DELETE RESTRICT`
- **Action:** Attempted to insert a `case_investigations` record referencing a valid `case_id` but with a mismatched `merchant_id` (`'spoofed_attacker_merchant'`).
- **Result:** Database strictly rejected the insertion with SQLSTATE `23503` (`foreign_key_violation`).
- **Verdict:** **PASS**

### Gate 2: Non-Cascading Deletion Rejection (`ON DELETE RESTRICT`)
- **Constraint Tested:** `ON DELETE RESTRICT` on `fk_case_investigations_tenant`.
- **Action:** Created an exception case and an associated investigation record. Attempted to execute `DELETE FROM exception_cases WHERE id = $1;`.
- **Result:** PostgreSQL actively rejected deletion with SQLSTATE `23001` (`restrict_violation`) / `23503` (`foreign_key_violation`). Parent case record remained intact.
- **Verdict:** **PASS**

### Gate 3: Read-Only Invariant Verification
- **Invariant Tested:** AI investigation execution must never alter case status, financial amounts, or version.
- **Action:** Snapshotted case row before executing `investigateCase()`. Executed investigation. Queried case row after execution.
- **Result:**
  - `status`: strictly unchanged (`'OPEN'`).
  - `version`: strictly unchanged (`1`).
  - `varianceAmountMinor`: strictly unchanged (`45`).
  - `expectedAmountMinor`: strictly unchanged (`290`).
  - `actualAmountMinor`: strictly unchanged (`335`).
  - `updatedAt`: strictly unchanged.
- **Verdict:** **PASS**

### Gate 4: Append-Only Investigation Audit Logging
- **Invariant Tested:** Running multiple investigations on the same case creates distinct historical entries without overwriting previous results.
- **Action:** Executed two successive investigations on a single exception case.
- **Result:** Retrieved 2 distinct rows from `case_investigations`, distinct UUIDs, strictly ordered descending by `created_at`.
- **Verdict:** **PASS**

### Gate 5: Check Constraint Enforcement on Status
- **Constraint Tested:** `CONSTRAINT chk_case_investigations_status CHECK (status IN ('COMPLETED', 'FAILED'))`
- **Action:** Attempted to insert a row with invalid status `'RESOLVED'`.
- **Result:** Database strictly rejected insertion with SQLSTATE `23514` (`check_violation`).
- **Verdict:** **PASS**

---

## 5. Test Suite Verification & Regression Matrix

All 28 test suites passed with zero errors and zero skips:

```
Test Files  28 passed (28)
     Tests  403 passed (403)
  Duration  21.27s
```

### Phase 3D.2 Test Suites Breakdown (38 Tests)
1. `src/lib/ai/__tests__/provider.test.ts` (11 tests):
   - Deterministic mock results, timeout simulation (`PROVIDER_TIMEOUT`), rate limit simulation (`RATE_LIMIT_EXCEEDED`), malformed JSON handling, hallucination injection.
   - Provider factory resolution (`resolveAIProviderClient`), explicit overrides, missing credential validation.
   - Gemini client credential masking (guarantees API key is redacted from thrown error messages).
2. `src/lib/ai/__tests__/contextBuilder.test.ts` (6 tests):
   - Case retrieval failure (`CaseContextNotFoundError`), cross-tenant isolation enforcement.
   - Unicode NFC string normalization, deterministic SHA-256 fingerprint reproducibility.
   - Bounded context item limits (max 30 items) and summary compilation.
3. `src/lib/ai/__tests__/promptDefense.test.ts` (5 tests):
   - Passive-data boundary delimiter fencing (`<<<BEGIN_UNTRUSTED_FINANCIAL_EVIDENCE>>>`).
   - Anti-injection instructions in system prompt.
   - Grounding validation: accepts valid citations, throws `GroundingValidationError` on hallucinated facts or inferences.
4. `src/lib/ai/__tests__/investigationService.test.ts` (4 tests):
   - End-to-end investigation execution, persistence of `COMPLETED` audit record.
   - Zero case record mutation verification.
   - FAILED audit logging on provider timeout and grounding validation failure.
   - Append-only multiple investigation history logging.
5. `src/lib/ai/__tests__/investigateApi.test.ts` (7 tests):
   - Fails closed (HTTP 500) on missing merchant configuration.
   - Rejects spoofed `x-merchant-id` header with HTTP 403 (`SPOOFED_TENANT_IDENTITY`).
   - Rejects malformed UUID with HTTP 400.
   - Returns HTTP 404 on unowned or non-existent cases.
   - Returns HTTP 200 with structured analysis on `POST`.
   - Returns HTTP 200 with investigation history on `GET`.
6. `src/lib/ai/__tests__/investigation_pg.test.ts` (5 tests):
   - Live PostgreSQL acceptance gates 1 through 5.

### Regression Verification Matrix (Prior Phases)
- Phase 3D.1 Exception Cases & Evidence Graph: 55/55 passed (`api.test.ts`, `caseExtractor.test.ts`, `evidenceGraph.test.ts`, `repository.test.ts`, `concurrency_case_pg.test.ts`).
- Phase 3C.3B Concurrency & Advisory Locks: 10/10 passed (`concurrency_persisted.test.ts`).
- Phase 3C.2 Durable PayPal Ingestion: 21/21 passed (`ingestion_3c2.test.ts`).
- Phase 3C.1 Ledger Persistence: 28/28 passed (`database.test.ts`, `reconciliation_persisted.test.ts`).
- Phase 2B Workbench & Review APIs: 14/14 passed (`workbench.test.ts`).
- Phase 1 & 2 Financial Core: 237/237 passed (`money.test.ts`, `matcher.test.ts`, `importer.test.ts`, `regression.test.ts`, etc.).

---

## 6. Scope Boundary Certification

We certify adherence to all governing project constraints:
1. **Read-Only Invariant:** AI investigations possess zero authority to alter financial status, amounts, or ledger records.
2. **Zero Forward Leakage:** Zero Phase 3D.3 (action catalog), Phase 3D.4 (approval workflow), or Phase 3D.5 (PayPal execution) code was authored.
3. **Protected Financial Core:** Zero modifications to `matcher/**`, `importer/**`, `fixtures/**`, `money.ts`, `financial.ts`, or migrations `001_` through `007_`.
4. **Database Safety:** Dedicated local test database `closeloop_test` preserved without drop, truncate, or schema recreation.
5. **Production Build:** Successfully compiled with Turbopack (`npm run build`). Zero TypeScript errors (`tsc --noEmit`). Zero ESLint errors (`npm run lint`).

