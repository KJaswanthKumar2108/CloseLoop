# CloseLoop — Product Specification

> **Tagline:** Every payment accounted for. Every discrepancy explained. Every action under control.  
> **Submission Track:** PayPal AI Hackathon  
> **Status:** Phase 1 — Project Foundation (Planned features clearly marked)

---

## 1. Executive Summary & Vision

**CloseLoop** is an enterprise-grade financial operations platform engineered to solve one of the most persistent, labor-intensive challenges in digital commerce: **reconciling PayPal transactions against internal merchant ledgers, resolving financial discrepancies, and automating exception handling with human-in-the-loop AI.**

High-volume merchants operating across borders face thousands of daily transactions across multiple currencies, varying fee tiers, partial refunds, rolling reserves, disputes, and settlement lags. Traditional reconciliation relies on brittle spreadsheets, manual ledger lookups, and fragmented communication between finance teams and support desks.

CloseLoop unites three pillars:
1. **Deterministic Financial Engine:** Strict, exact minor-unit currency math and multi-pass deterministic matching algorithms.
2. **Deep PayPal Developer Platform Integration:** Utilizing `@paypal/paypal-server-sdk` to ingest real settlement batches, transaction histories, fee breakdowns, and dispute statuses directly from PayPal.
3. **Evidence-Grounded AI Copilot:** Leveraging Google Gemini to investigate root causes, explain fee variances, cite relevant policy guidelines, and draft remediation actions—while enforcing strict human approval before any financial action executes.

---

## 2. Target Customers & Personas

| Persona | Role | Core Pain Point | Value Delivered by CloseLoop |
|---|---|---|---|
| **Finance Controller / Head of Accounting** | Sets financial policies and signs off on periodic closes. | Month-end close delays caused by unexplained variances between bank/PayPal balances and ERP records. | Continuous real-time reconciliation, verifiable balance integrity, and auditable approval workflows. |
| **Financial Operations Specialist** | Manages daily settlement matching and exception queues. | Hundreds of tedious exceptions caused by multi-currency conversions, fee tier changes, and partial refunds. | Automated deterministic matching, instant AI root-cause diagnostics, and one-click remediation proposals. |
| **Merchant Operations Lead** | Oversees customer billing, disputes, and order sync. | Missing transaction metadata between e-commerce carts (e.g., Shopify, custom carts) and PayPal payouts. | Unmatched transaction triage, dispute status tracking, and automated ledger sync suggestions. |

---

## 3. End-to-End Merchant Reconciliation Workflow

The operational lifecycle within CloseLoop follows a 5-stage deterministic-first pipeline:

```
[ PayPal Settlement & Transactions ]      [ Internal Merchant Ledger / Orders ]
                 \                                    /
                  \                                  /
                   v                                v
        +------------------------------------------------------+
        | STAGE 1: Normalized Ingestion & Minor-Unit Parsing    |
        +------------------------------------------------------+
                                   |
                                   v
        +------------------------------------------------------+
        | STAGE 2: Deterministic Reconciliation Engine         |
        |  - Multi-pass exact matching (IDs, timestamps, cents)|
        |  - Variance isolation (fees, timing, fx, refunds)    |
        +------------------------------------------------------+
                                   |
                 +-----------------+-----------------+
                 |                                   |
                 v                                   v
        [ Reconciled Batches ]             [ Exception Queue ]
         (100% matched)                              |
                                                     v
                                  +--------------------------------------+
                                  | STAGE 3: Evidence-Grounded AI Copilot|
                                  |  - Root-cause analysis & citations  |
                                  |  - Suggests remediation action       |
                                  +--------------------------------------+
                                                     |
                                                     v
                                  +--------------------------------------+
                                  | STAGE 4: Human-in-the-Loop Gate      |
                                  |  - Controller review & sign-off     |
                                  |  - Strict permission validation      |
                                  +--------------------------------------+
                                                     |
                                                     v
                                  +--------------------------------------+
                                  | STAGE 5: Server-Side Execution       |
                                  |  - Safe PayPal API invocation        |
                                  |  - Immutable Audit Event recorded    |
                                  +--------------------------------------+
```

### Detailed Workflow Stages:
1. **Ingestion & Minor-Unit Normalization:**
   - PayPal transaction events (payments, captures, refunds, dispute fees, partner fees) are fetched via PayPal APIs and normalized into integer minor units (e.g., \$10.50 USD $\rightarrow$ 1050 cents).
   - Merchant internal ledger records (orders, invoices, CRM IDs) are similarly normalized.
2. **Deterministic Matching Engine:**
   - Rule-based algorithmic matching evaluates Tier 1 (Exact transaction ID match), Tier 2 (Order ID + exact amount), Tier 3 (Fuzzy reference + timestamp window + exact amount).
   - Records are partitioned into **Matched**, **Variance / Discrepancy**, and **Unmatched**.
3. **Evidence-Grounded AI Diagnosis:**
   - Discrepant transactions are routed to the AI Copilot.
   - The copilot is fed structured, factual context (exact fee charged vs expected fee schedule, currency conversion spread, settlement timing).
   - The copilot drafts an explanation with citations to PayPal transaction IDs and proposes remediation (e.g., "Post adjusting entry for \$0.35 cross-border fee tier variance").
4. **Human Approval Gate:**
   - No financial write operation or adjusting ledger entry may occur without explicit human authorization.
   - Approvals require role authorization and cryptographically verifiable intent.
5. **Execution & Audit Trail:**
   - The backend validates the action independently and issues the appropriate API request.
   - Every action, approval, timestamp, and user identity is recorded to the immutable audit log.

---

## 4. Separation of Deterministic Math from AI Reasoning

CloseLoop enforces an uncompromising architectural boundary between calculation and language generation:

```
+-------------------------------------------------------------------------------+
|                        FINANCIAL COMPUTATION BOUNDARY                         |
+-------------------------------------------------------------------------------+
|  DETERMINISTIC ENGINE (Code / DB)       |  EVIDENCE-GROUNDED AI (Gemini)      |
|  -------------------------------------  |  ---------------------------------  |
|  - Integer minor-unit math (cents)      |  - Natural language explanation     |
|  - Currency boundary preservation       |  - Root cause hypothesis generation |
|  - Authoritative match determination    |  - Drafts remediation proposals     |
|  - Authoritative discrepancy calculation|  - Cites retrieved transaction IDs |
|  - Ledger balance validation            |  - CANNOT fabricate transactions    |
|  - Permission & authorization checks    |  - CANNOT modify ledger balances    |
|                                         |  - CANNOT authorize actions         |
+-------------------------------------------------------------------------------+
```

---

## 5. PayPal Developer Platform Capabilities (Integration Scope)

CloseLoop centers around key PayPal APIs via `@paypal/paypal-server-sdk`:

1. **Transactions & Reporting API:**
   - Ingest transaction records, fees, gross amounts, net amounts, and balance impact.
   - Sync settlement reports (`v1/reporting/transactions`).
2. **Orders & Payments API:**
   - Retrieve order context, authorization, and capture details (`v2/checkout/orders`, `v2/payments/captures`).
3. **Disputes API:**
   - Ingest chargebacks, inquiries, and claims to isolate held funds from available balances.
4. **Refunds API:**
   - Track partial and full refunds to correlate debit adjustments with original captures.

*(All interactions are strictly configured for Sandbox during development and testing).*

---

## 6. AG Studio & AG Grid Integration

CloseLoop utilizes **AG Grid Community** and **AG Studio** for professional financial data operations:
- **AG Grid Data Surface:** High-performance tabular rendering capable of handling tens of thousands of reconciliation records with instant sorting, filtering, column grouping by currency, and conditional cell highlighting for discrepancies.
- **AG Studio Workflow Integration (Planned):** Embedding conversational AI agent capabilities within the grid context, allowing operators to trigger contextual row analysis and batch exception resolution directly from the data grid.

---

## 7. Product Surface & Navigation Map

1. **Overview (`/`):** High-level financial operations status, PayPal Sandbox connection state, onboarding guides, and active reconciliation batch summary.
2. **Reconciliation (`/reconciliation`):** High-density tabular workspace powered by AG Grid for matched and pending transactions.
3. **Exceptions (`/exceptions`):** Discrepancy triage queue categorized by fee mismatches, timing differences, currency variance, and missing records.
4. **AI Copilot (`/copilot`):** Interactive AI workspace grounded in factual transaction evidence with root-cause explanations and suggested actions.
5. **Approvals (`/approvals`):** Human-in-the-loop authorization center for reviewing pending adjustments, disputes, and syncs.
6. **Activity & Audit (`/audit`):** Chronological, tamper-evident audit ledger capturing every reconciliation cycle, approval, and system event.
7. **Settings (`/settings`):** PayPal Sandbox credentials status, matching thresholds, currency preferences, and webhook configurations.

---

## 8. Current Implementation Status (Phase 1)

- **Completed:** Clean project foundation, TypeScript architecture, strict minor-unit typing definitions, responsive enterprise UI shell with sidebar navigation, health check endpoint, environment validation, and technical documentation.
- **Planned for Subsequent Phases:**
  - Phase 2: PayPal Sandbox API Client & Merchant Ledger Ingestion Engine.
  - Phase 3: Deterministic Reconciliation Engine & AG Grid Data Views.
  - Phase 4: Evidence-Grounded AI Copilot & Exception Investigator.
  - Phase 5: Human Approval System & Immutable Audit Architecture.
  - Phase 6: End-to-End Integration, Demonstration Scenarios & Polish.

