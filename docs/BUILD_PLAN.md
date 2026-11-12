# CloseLoop — Staged Implementation & Build Plan

> **Project:** CloseLoop (PayPal AI Hackathon Submission)  
> **Status:** Phase 1 Complete (Foundation Stage)

---

## Roadmap Overview

```
[ Phase 1: Foundation ] ---> [ Phase 2: PayPal Ingestion ] ---> [ Phase 3: Deterministic Engine & AG Grid ]
         |
         v
[ Phase 4: Evidence-Grounded AI ] ---> [ Phase 5: Approvals & Audit ] ---> [ Phase 6: Demo Scenarios & Polish ]
```

---

## Phase Details

### Phase 1: Project Foundation (Current)
- [x] Next.js App Router, TypeScript strict mode, Tailwind CSS configuration.
- [x] Package installation: `@paypal/paypal-server-sdk@2.5.0`, `ag-grid-community@36.2.0`, `ag-grid-react@36.2.0`, `ag-studio@3.0.0`, `ag-studio-react@3.0.0`, `zod`, `lucide-react`.
- [x] Engineering specifications: `PRODUCT_SPEC.md`, `ARCHITECTURE.md`, `BUILD_PLAN.md`, `SECURITY.md`.
- [x] Structured workspace directories (`src/app`, `src/components`, `src/lib`, `src/types`).
- [x] Safe environment configuration with Zod validation (`.env.example`, `env.ts`).
- [x] Enterprise fintech visual shell (Deep Navy sidebar, light content canvas, responsive layout).
- [x] Standard UI primitives (`Button`, `StatusBadge`, `EmptyState`, `Skeleton`, `ErrorState`, `PageHeader`, `Breadcrumbs`).
- [x] Seven core application pages (`Overview`, `Reconciliation`, `Exceptions`, `AI Copilot`, `Approvals`, `Activity & Audit`, `Settings`).
- [x] Safe `GET /api/health` endpoint returning system configuration readiness without exposing secrets.
- [x] Strict linting and build validation passes.

---

### Phase 2: PayPal Server SDK Client & Data Ingestion (Planned)
- [ ] Initialize PayPal Server SDK client singleton with sandbox credentials.
- [ ] Implement PayPal token caching and rate-limit retry handling.
- [ ] Implement PayPal Transaction Ingestion Service:
  - Fetch transaction histories (`/v1/reporting/transactions`).
  - Retrieve settlement details and fee breakdowns (`/v2/payments/captures`).
  - Fetch dispute details (`/v1/customer/disputes`).
- [ ] Implement Merchant Ledger Ingestion Service:
  - CSV / JSON order and invoice upload parser.
  - Normalization of all currencies into exact minor units.
- [ ] Safe sandbox mock/sample data generator for demonstration without live external credentials.

---

### Phase 3: Deterministic Financial Reconciliation Engine & AG Grid (Planned)
- [ ] Implement exact integer minor-unit math library (`Money` class / pure functions):
  - Add, subtract, multiply with rounding rules, exact compare.
  - Strict currency isolation (disallows adding USD to EUR).
- [ ] Implement multi-pass deterministic matching algorithm:
  - Pass 1: Exact Transaction ID / Capture ID match.
  - Pass 2: Order Reference + timestamp window + exact amount.
  - Pass 3: Amount tolerance / fee variance categorization.
- [ ] Implement discrepancy classification (Fee Discrepancy, Timing Difference, Currency Variance, Missing in PayPal, Missing in Ledger).
- [ ] Integrate AG Grid Community & AG Studio:
  - High-performance virtualized grid view for transactions.
  - Custom cell renderers for status badges, currencies, and variance callouts.
  - Multi-column sorting and filtering by variance status.

---

### Phase 4: Evidence-Grounded AI Copilot (Planned)
- [ ] Configure Gemini AI client with structured prompting and output constraints.
- [ ] Develop Discrepancy Investigator:
  - Feed deterministic variance data and transaction metadata to the model.
  - Prompt enforces citing only provided transaction IDs and PayPal fee rules.
  - Generate human-readable root cause explanation.
- [ ] Develop Remediation Action Drafter:
  - Propose exact structured actions (e.g. `ADJUST_LEDGER_FEE`, `SYNC_MISSING_ORDER`, `FLAG_DISPUTE_HOLD`).
  - Enforce Zod validation on model outputs to prevent hallucinated action types.
- [ ] Implement interactive Copilot Chat UI with transaction context cards.

---

### Phase 5: Human Approval System & Immutable Audit Architecture (Planned)
- [ ] Implement human-in-the-loop action queue (`/approvals`):
  - Detailed side-by-side impact preview (ledger balance before vs after).
  - Explicit Approve and Reject controls with optional justification notes.
- [ ] Implement backend execution gate:
  - Double-checks authorization before executing any PayPal API call or ledger write.
- [ ] Implement cryptographic audit trail:
  - Hash-chained audit events for every ingestion, match run, AI investigation, approval, and execution.
  - Read-only audit viewer (`/audit`).

---

### Phase 6: End-to-End Integration, Demo Scenarios & Final Polish (Planned)
- [ ] Seed realistic, clearly-labeled demo scenarios:
  1. *Clean Batch:* 100% matched transactions across standard PayPal checkout.
  2. *Cross-Border Fee Discrepancy:* International card fee causing an unexpected \$0.35 variance.
  3. *Partial Refund Timing Lag:* Refund settled in PayPal but not yet posted in ERP.
  4. *Disputed Transaction:* Customer initiated a dispute, holding funds.
- [ ] Full responsiveness check across desktop, tablet, and mobile.
- [ ] Video demonstration script and presentation materials for PayPal AI Hackathon judging.

