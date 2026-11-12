# CloseLoop — Phase 3D.3 Implementation & Acceptance Report
## Deterministic Resolution Recommendations & Advisory Action Catalog

**Role:** Senior FinTech Full-Stack Engineer, Financial Workflow Architect, and AI Safety Engineer  
**Project:** CloseLoop — AI Agent for PayPal Payment Exception Resolution (*"Find it. Explain it. Fix it. Close it."*)  
**Milestone:** Phase 3D.3 — Resolution Recommendations  
**Status:** IMPLEMENTED, TESTED, AND ACCEPTED  
**Date:** 2026-11-12  

---

## 1. Executive Summary

Phase 3D.3 implements a deterministic, declarative resolution recommendation engine that converts verified Phase 3D.1 exception cases, immutable evidence graphs, and Phase 3D.2 investigation hypotheses into actionable, explainable recommendations for merchant operators.

### Key Architectural Pillars
1. **Declarative Action Catalog:** A strictly deterministic, finite catalog of 8 supported operator recommendations (`src/lib/resolution/catalog.ts`). AI cannot invent action IDs or executable instructions.
2. **Transparent, Explainable Uncertainty Scoring:** A 0–100 scoring model attributing uncertainty to verifiable factors (evidence completeness, investigation presence and confidence, evidence freshness, discrepancy magnitude, multi-entity document ambiguity, and attribution collisions).
3. **Audit Limitation Safeguards (Section 5A & 5B):**
   - *Multi-Entity Document-Level Evidence:* Payloads containing multiple financial entities or pooled line-items are flagged for manual verification; automated entity-level claims are suppressed in favor of `REVIEW_CASE_EVIDENCE` or `ESCALATE_FOR_MANUAL_REVIEW`.
   - *Evidence Mutation & Fingerprint Drift:* Live RFC 8785 canonical JSON SHA-256 fingerprints are compared against persisted investigation snapshots. If evidence drifted without a case version bump, freshness is flagged as `EVIDENCE_STALE` and uncertainty is elevated.
4. **Strictly Advisory Safeguard:** Phase 3D.3 performs zero write operations to PayPal APIs, does not execute refunds, does not void captures, does not mutate ledger records, and does not automatically resolve exception cases. Every recommendation carries the mandatory disclaimer:
   > *"Advisory recommendation only. No financial action has been executed."*
5. **Quality Gate Perfection:** All 33 new Phase 3D.3 tests pass; all 451 full-suite tests pass across 33 test files; `npx tsc --noEmit` reports 0 errors; `npm run lint` reports 0 errors/warnings; `next build` compiles cleanly across all routes. Frozen financial core (`src/lib/reconciliation/`) remains 100% unaltered.

---

## 2. Implemented Components & Files

| Component / Subsystem | Path | Description |
| :--- | :--- | :--- |
| **Types & Contracts** | `src/lib/resolution/types.ts` | Action IDs, risk levels, uncertainty levels, visual states, and recommendation interfaces. |
| **Zod Schemas** | `src/lib/resolution/schemas.ts` | Runtime validation for action catalog IDs, recommendations, uncertainty scores, and API payloads. |
| **Action Catalog** | `src/lib/resolution/catalog.ts` | Declarative definitions of all 8 supported actions, preconditions, contraindications, and risks. |
| **Uncertainty Scorer** | `src/lib/resolution/uncertaintyScorer.ts` | Transparent, bounded (0–100) scoring engine with factor breakdowns and suppression logic. |
| **Evaluator** | `src/lib/resolution/evaluator.ts` | Rules engine evaluating preconditions, contraindications, multi-entity ambiguity, and evidence freshness. |
| **Recommendation Engine** | `src/lib/resolution/recommendationEngine.ts` | Orchestrator generating ranked, explainable, evidence-grounded recommendations for operators. |
| **Recommendations API** | `src/app/api/exceptions/cases/[id]/recommendations/route.ts` | Authenticated `GET` and `POST` endpoints with tenant isolation and Reader-pool execution. |
| **Operator UI Panel** | `src/components/exceptions/CaseResolutionPanel.tsx` | Production-grade UI with primary recommendation, visual state badges, uncertainty breakdown, and modal. |
| **Exception Detail Page**| `src/app/exceptions/page.tsx` | Integrated `CaseResolutionPanel` alongside `CaseInvestigationPanel` in exception review view. |
| **Catalog Tests** | `src/lib/resolution/__tests__/catalog.test.ts` | Unit tests for catalog completeness, schema parsing, and unknown ID rejection. |
| **Scorer Tests** | `src/lib/resolution/__tests__/uncertaintyScorer.test.ts` | Unit tests for factor attribution, bounds (0–100), levels, and suppression triggers. |
| **Evaluator Tests** | `src/lib/resolution/__tests__/evaluator.test.ts` | Unit tests for multi-entity detection, fingerprint drift, and contraindication enforcement. |
| **Engine Tests** | `src/lib/resolution/__tests__/recommendationEngine.test.ts` | End-to-end tests across all exception categories, stale evidence, ambiguity, and disclaimer integrity. |
| **API Route Tests** | `src/lib/resolution/__tests__/recommendationsApi.test.ts` | Integration tests for `GET`/`POST`, UUID validation, tenant anti-spoofing, and cross-tenant 404. |

---

## 3. Declarative Action Catalog

| Action Catalog ID | Title | Intended Condition | Risk Level | Human Review |
| :--- | :--- | :--- | :---: | :---: |
| `VERIFY_PAYMENT_REFERENCE` | Verify Payment Reference | Missing, ambiguous, or conflicting merchant order ID or PayPal transaction reference. | **LOW** | Required |
| `WAIT_FOR_SETTLEMENT` | Wait for Settlement Confirmation | Transaction within standard settlement window (<= 7 days) experiencing clearing delay. | **LOW** | Required |
| `REQUEST_MERCHANT_DOCUMENTATION`| Request Supporting Documentation| PayPal capture observed in ledger without matching merchant order or fulfillment proof. | **LOW** | Required |
| `REVIEW_REFUND_STATUS` | Review Refund Status | Partial/full refund discrepancy or evidence payload includes refund ledger events. | **MEDIUM** | Required |
| `INVESTIGATE_AMOUNT_VARIANCE` | Investigate Amount Difference | Observed variance between expected order total and actual capture (variance > 0). | **MEDIUM** | Required |
| `REVIEW_DUPLICATE_PAYMENT` | Investigate Potential Duplicate | Multiple transaction captures linked to the same order reference or collision detected. | **HIGH** | Required |
| `ESCALATE_FOR_MANUAL_REVIEW` | Escalate to Manual Review | High uncertainty (>= 50), high dollar variance, or complex multi-entity ambiguity. | **HIGH** | Required |
| `REVIEW_CASE_EVIDENCE` | Review Supporting Evidence | Stale investigation snapshot, drifted evidence fingerprint, or missing AI analysis. | **LOW** | Required |

---

## 4. Deterministic Uncertainty Scoring Model

The uncertainty score is a deterministic integer bounded between **0 and 100**, derived from verifiable factual inputs:

$$\text{Uncertainty Score} = \min\left(100, \sum \text{Score Contributions}\right)$$

### Contributing Factors & Point Allocations

| Factor Key | Factor Description | Contribution |
| :--- | :--- | :---: |
| `EMPTY_EVIDENCE_GRAPH` | No verified evidence items attached to case | **+35** |
| `INCOMPLETE_CORE_EVIDENCE` | Missing both merchant order and PayPal ledger snapshots | **+25** |
| `UNILATERAL_EVIDENCE` | Contains records from only one side of the transaction pair | **+15** |
| `MISSING_ALL_PRIMARY_REFERENCES`| Neither orderId nor paypalTransactionId could be resolved | **+25** |
| `UNPAIRED_REFERENCE` | Case contains an order reference or PayPal reference, but not both | **+10** |
| `MULTI_ENTITY_DOCUMENT_AMBIGUITY`| Evidence payload contains multiple transaction entities or pooled amounts | **+30** |
| `AMBIGUOUS_TRANSACTION_ATTRIBUTION`| Reconciliation identified multiple competing candidate transactions | **+25** |
| `STALE_INVESTIGATION_SNAPSHOT` | Case version progressed or evidence fingerprint drifted since investigation | **+30** |
| `UNKNOWN_EVIDENCE_FRESHNESS` | Fingerprint cannot be deterministically validated against snapshot | **+25** |
| `MISSING_AI_INVESTIGATION` | No completed investigation exists for root-cause context | **+20** |
| `LOW_INVESTIGATION_CONFIDENCE` | Investigation explicitly stated low confidence on root-cause inference | **+15** |
| `MODERATE_INVESTIGATION_CONFIDENCE`| Investigation stated moderate confidence on root-cause inference | **+5** |
| `HIGH_VALUE_VARIANCE` | Variance amount exceeds $500.00 (50,000 minor) | **+15** |

### Uncertainty Levels & Governance
- **0–25 (LOW):** Highly grounded; standard operational recommendations presented as `RECOMMENDED`.
- **26–50 (MODERATE):** Qualified certainty; presented as `REQUIRES_VERIFICATION`.
- **51–75 (HIGH):** Elevated ambiguity; automated resolution suppressed; presented as `HIGH_UNCERTAINTY`.
- **76–100 (VERY HIGH):** Critical ambiguity; manual supervisor review enforced (`MANUAL_REVIEW_REQUIRED`).

---

## 5. API Endpoints

### 1. `POST /api/exceptions/cases/[id]/recommendations`
- **Purpose:** Evaluates and returns deterministic resolution recommendations for the specified case.
- **Authentication:** Authoritative server-side merchant resolution via `resolveVerifiedMerchantId(req)`. Rejects spoofed `x-merchant-id` headers with `403 Forbidden`.
- **Pool Used:** Restricted `getReaderPool()` (Role: `closeloop_investigation_reader`).
- **Response Format:**
  ```json
  {
    "success": true,
    "caseId": "UUID",
    "merchantId": "merchant_123",
    "caseVersion": 1,
    "evidenceFingerprint": "sha256...",
    "isEvidenceStale": false,
    "hasInvestigation": true,
    "investigationStatus": "COMPLETED",
    "recommendations": [
      {
        "id": "rec_hash...",
        "actionId": "INVESTIGATE_AMOUNT_VARIANCE",
        "title": "Investigate Amount Difference",
        "description": "...",
        "explanation": "...",
        "preconditionsSatisfied": [...],
        "contraindicationsChecked": [...],
        "missingInformation": [...],
        "supportingEvidenceIds": ["uuid-1", "uuid-2"],
        "uncertainty": {
          "score": 15,
          "level": "LOW",
          "factors": [...],
          "isSuppressedOrDemoted": false
        },
        "riskLevel": "MEDIUM",
        "requiresHumanReview": true,
        "isPrimary": true,
        "visualState": "RECOMMENDED",
        "createdAt": "2026-11-12T19:30:00Z",
        "disclaimer": "Advisory recommendation only. No financial action has been executed."
      }
    ],
    "evaluatedAt": "2026-11-12T19:30:00Z",
    "disclaimer": "Advisory recommendation only. No financial action has been executed."
  }
  ```

### 2. `GET /api/exceptions/cases/[id]/recommendations`
- **Purpose:** Retrieves existing recommendations for the authenticated merchant and requested case.
- **Tenant Isolation:** Enforced via `findCaseById` filter `WHERE id = $1 AND merchant_id = $2`. Returns `404 Not Found` if the case belongs to another merchant.

---

## 6. Operator Experience & UI Integration

- **Embedded Panel (`CaseResolutionPanel.tsx`):** Rendered inside `src/app/exceptions/page.tsx` directly alongside `CaseInvestigationPanel`.
- **Visual State Badging:**
  - `RECOMMENDED` (Emerald): High confidence, preconditions verified.
  - `REQUIRES_VERIFICATION` (Amber): Moderate uncertainty or missing auxiliary metadata.
  - `HIGH_UNCERTAINTY` (Orange): Elevated risk factors; supervisor review recommended.
  - `EVIDENCE_STALE` (Rose): Drift detected between evidence snapshot and current case version.
  - `MANUAL_REVIEW_REQUIRED` (Purple): Multi-entity ambiguity or very high uncertainty.
- **Interactive Detail Modal:** Clicking **"Review Recommendation"** opens an advisory inspection modal showing:
  - Full operator explanation and recommended next steps.
  - Granular uncertainty score factor breakdown with point contributions.
  - Checklist of preconditions satisfied and contraindications checked.
  - Specific evidence provenance IDs supporting the recommendation.
  - Strict advisory notice confirming that no PayPal action has been executed.

---

## 7. Testing & Quality Gate Verification

### 1. Test Suite Coverage (12 Mandatory Test Categories)

| Category # | Verification Scope | Test File | Result |
| :---: | :--- | :--- | :---: |
| **1** | Correct action selection for each exception category | `recommendationEngine.test.ts` | **PASS** |
| **2** | Rejection of actions with unmet preconditions | `evaluator.test.ts` | **PASS** |
| **3** | Contraindication enforcement (zero variance, terminal status) | `evaluator.test.ts` | **PASS** |
| **4** | Deterministic uncertainty scoring (0–100) | `uncertaintyScorer.test.ts` | **PASS** |
| **5** | Stale investigation handling (`EVIDENCE_STALE`) | `recommendationEngine.test.ts` | **PASS** |
| **6** | Unknown evidence freshness handling | `uncertaintyScorer.test.ts` | **PASS** |
| **7** | Multi-entity evidence ambiguity (`MANUAL_REVIEW_REQUIRED`) | `evaluator.test.ts`, `recommendationEngine.test.ts` | **PASS** |
| **8** | Missing investigation handling | `recommendationEngine.test.ts` | **PASS** |
| **9** | Cross-merchant access rejection (404 / 403) | `recommendationsApi.test.ts` | **PASS** |
| **10** | Unsupported action ID rejection | `catalog.test.ts` | **PASS** |
| **11** | Evidence citation preservation | `recommendationEngine.test.ts` | **PASS** |
| **12** | No financial mutation during recommendation generation | `recommendationEngine.test.ts`, `recommendationsApi.test.ts` | **PASS** |

### 2. Quality Gate Results Summary

| Gate | Target Command | Result | Output Details |
| :--- | :--- | :---: | :--- |
| **QG-1** | `npx tsc --noEmit` | **PASS** | 0 type-checking errors across all modules. |
| **QG-2** | `npm run lint` | **PASS** | 0 linting errors, 0 warnings across all files. |
| **QG-3** | `npm run build` | **PASS** | Turbopack production build succeeded; 25 static & dynamic routes compiled. |
| **Unit Suite** | `npx vitest run src/lib/resolution` | **PASS** | 33/33 tests passed across 5 test suites. |
| **Full Suite** | `npm test` | **PASS** | 451/451 tests passed across 33 test files. |
| **Frozen Core**| `git diff --stat src/lib/reconciliation/` | **PASS** | 0 modified lines; financial invariants 100% preserved. |

---

## 8. Known Limitations & Phase 3D.4 Boundaries

1. **Advisory Boundary:** Recommendations advise operator workflows; they do **not** trigger payments, refunds, capture releases, or dispute responses.
2. **Document-Level Ambiguity Mitigation:** Payloads with multiple embedded transactions are flagged as `MANUAL_REVIEW_REQUIRED` to prevent hallucinating line-item attribution. Phase 3D.4 approval workflows will present these items for line-item confirmation.
3. **No Approval Token Generation:** Phase 3D.3 explicitly avoids generating approval tokens, cryptographic signatures, or authorization workflows (reserved for Phase 3D.4).

---

## 9. Final Phase 3D.3 Sign-Off

**CloseLoop Phase 3D.3 is fully implemented, verified, and accepted.**

The system reliably explains what the merchant should do next, why they should do it, and what evidence supports it — completely preserving financial safety and data immutability.

