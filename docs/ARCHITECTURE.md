# CloseLoop — Architectural Specification

---

## 1. System Architecture Overview

CloseLoop is structured as a full-stack Next.js application following clean-architecture principles, enforcing a strict separation between presentation, deterministic financial computation, AI orchestration, and external payment APIs.

```
+---------------------------------------------------------------------------------------+
|                                    PRESENTATION LAYER                                 |
|  - Next.js App Router (React 19 Server & Client Components)                           |
|  - Tailwind CSS Enterprise Theme (Deep Navy, Slate, Teal, Amber)                      |
|  - AG Grid Community (Tabular Financial Operations) & AG Studio Agent Hooks          |
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                                      API ROUTES                                       |
|  /api/health       /api/paypal/*       /api/reconciliation/*    /api/ai/*             |
|  (System Health)   (Sync & Ingest)     (Run Matches & Export)   (Investigate & Copilot)|
+---------------------------------------------------------------------------------------+
                                           |
                                           v
+---------------------------------------------------------------------------------------+
|                                   CORE DOMAIN LOGIC                                   |
|                                                                                       |
|  +---------------------------------+        +--------------------------------------+  |
|  | DETERMINISTIC ENGINE            |        | EVIDENCE-GROUNDED AI ORCHESTRATOR    |  |
|  | - Integer Minor-Unit Math       |        | - Gemini Context Grounding           |  |
|  | - Multi-Pass Match Algorithms   |        | - Discrepancy Reasoner               |  |
|  | - Variance Isolation Rules      |        | - Remediation Action Drafter         |  |
|  +---------------------------------+        +--------------------------------------+  |
|                   \                                      /                            |
|                    v                                    v                             |
|          +------------------------------------------------------+                     |
|          | HUMAN APPROVAL GATE & IMMUTABLE AUDIT LEDGER         |                     |
|          | - Action State Machine (Pending -> Approved -> Exec) |                     |
|          | - Cryptographic Hash Chaining & Event Audit Log      |                     |
|          +------------------------------------------------------+                     |
+---------------------------------------------------------------------------------------+
                        |                                       |
                        v                                       v
+-----------------------------------------------+   +-----------------------------------+
|         PAYPAL DEVELOPER PLATFORM             |   |        AI FOUNDATION MODEL        |
|  - @paypal/paypal-server-sdk                  |   |  - Google Gemini API              |
|  - Sandbox Environment                        |   |  - Structured JSON Output Schema  |
|  - Transactions, Orders, Disputes, Reporting  |   |  - Grounded Context Citing        |
+-----------------------------------------------+   +-----------------------------------+
```

---

## 2. Core Architectural Principles

### 2.1 Principle 1: Financial Correctness & Exact Math
- **Integer Minor Units:** All financial figures are parsed and stored as integer minor units (e.g., cents for USD/EUR, integers for JPY).
  ```typescript
  export interface Money {
    amountMinor: bigint | number; // e.g., 1050 for $10.50 USD
    currency: string;             // ISO 4217 (e.g. "USD")
    precision: number;            // 2 for USD, 0 for JPY, 3 for BHD
  }
  ```
- **Zero Floating-Point Drift:** Native JavaScript `Number` floating-point arithmetic (`0.1 + 0.2 = 0.30000000000000004`) is strictly forbidden for financial calculations.
- **Currency Isolation:** Summing amounts across disparate currency codes without an explicit, verifiable exchange rate lookup produces a strict validation error.

### 2.2 Principle 2: Deterministic Reconciliation Engine
- The reconciliation engine produces verifiable, binary match results based on explicit rules:
  1. **Pass 1 — Exact ID Match:** PayPal `transaction_id` or `order_id` matches Merchant Order ID, and amount minor units match exactly.
  2. **Pass 2 — Reference & Exact Amount:** Merchant Invoice Reference matches PayPal custom metadata with identical currency and minor units within a configurable settlement time window ($\pm 48\text{h}$).
  3. **Pass 3 — Discrepancy Isolation:** IDs match, but amounts differ (e.g., unexpected fee deductions, foreign exchange slippage, or partial refunds).
- Discrepancies are categorized with mathematical precision before being passed to any human or AI agent.

### 2.3 Principle 3: Evidence-Grounded AI Reasoning
- AI models (Gemini) operate in an advisory capacity only:
  - **Input Context:** Structured transaction JSON, calculated variance figures, and PayPal fee schedule parameters.
  - **Prompt Grounding:** Prompts mandate that every claim, explanation, or proposal must cite verified transaction IDs present in the input payload.
  - **Output Contracts:** AI outputs are validated against strict Zod schemas. If the model hallucinates a non-existent transaction ID or proposes an unauthorized action type, the output is rejected.
  - **No Autonomous Authority:** AI cannot mark a discrepancy as "reconciled" without deterministic verification or human sign-off.

### 2.4 Principle 4: Human-in-the-Loop Financial Approvals
- Any action with financial implications (e.g., executing a refund, posting an adjusting journal entry, disputing a fee, adjusting ledger balances) enters a **Pending Approval** state.
- **State Machine:**
  $$\text{DRAFT} \longrightarrow \text{PENDING\_APPROVAL} \longrightarrow \begin{cases} \text{APPROVED} \longrightarrow \text{EXECUTED} \mid \text{FAILED} \\ \text{REJECTED} \end{cases}$$
- The backend independently re-validates the business logic before executing any approved action against the PayPal API.

---

## 3. PayPal Developer Platform Integration

- **SDK:** `@paypal/paypal-server-sdk` (v2.5.0).
- **Environment:** Strictly Sandbox during development and evaluation.
- **Server-Side Isolation:** All credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`), OAuth2 tokens, and API requests reside strictly on the server (Route Handlers and Server Actions). Never exposed to browser bundles.
- **API Endpoints Utilized (Planned):**
  - `/v1/reporting/transactions` — Settlement and transaction history reports.
  - `/v2/checkout/orders` — Order details and payment intent.
  - `/v2/payments/captures` — Settlement confirmation, fees, and net payouts.
  - `/v1/customer/disputes` — Active disputes and claim resolutions.

---

## 4. AG Studio & AG Grid Integration (Planned)

- **AG Grid Community (v36.2.0):** Powers the core reconciliation data table:
  - High performance with virtualized rendering for 50,000+ records.
  - Pinning, column-based currency formatting, and quick search.
  - Custom cell renderers for status badges (Matched, Fee Variance, Timing Lag, Unmatched).
- **AG Studio (v3.0.0):** Provides developer studio and agentic grid integration, enabling context-aware operational tools and assistive AI interactions right beside the financial records.

---

## 5. Audit Trail Architecture (Planned)

Every significant system action is recorded as an immutable audit event:
```typescript
export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: 'INGESTION' | 'RECONCILIATION_RUN' | 'EXCEPTION_DETECTED' | 'AI_INVESTIGATION' | 'APPROVAL_GRANTED' | 'ACTION_EXECUTED';
  actor: {
    type: 'SYSTEM' | 'AI_AGENT' | 'HUMAN_USER';
    id: string;
    role?: string;
  };
  details: Record<string, unknown>;
  previousEventHash?: string;
}
```

---

## 6. Directory Layout & Module Responsibilities

```
src/
├── app/                        # Next.js App Router (Layouts, Pages, Route Handlers)
│   ├── api/
│   │   ├── health/             # GET /api/health (safe environment verification)
│   │   ├── paypal/             # Planned PayPal sync and webhook endpoints
│   │   ├── reconciliation/     # Planned batch reconciliation runners
│   │   ├── ai/                 # Planned Gemini exception analysis endpoints
│   │   └── approvals/          # Planned human approval queue endpoints
│   ├── reconciliation/         # Reconciliation workspace page
│   ├── exceptions/             # Discrepancy triage page
│   ├── copilot/                # AI Copilot interactive workspace
│   ├── approvals/              # Human approval queue page
│   ├── audit/                  # Audit log viewer page
│   ├── settings/               # Environment & matching rules settings
│   ├── layout.tsx              # Root layout with sidebar navigation shell
│   └── page.tsx                # Overview & onboarding dashboard
├── components/
│   ├── layout/                 # Sidebar, Header, Breadcrumbs, PageHeader
│   ├── dashboard/              # Overview widgets & setup checklist
│   ├── reconciliation/         # Grid wrappers and filter toolbars
│   ├── exceptions/             # Discrepancy detail panels
│   ├── copilot/                # Chat workspace & suggested action cards
│   ├── approvals/              # Approval review modals & action cards
│   └── ui/                     # Primitives (Button, Badge, Skeleton, EmptyState, ErrorState)
├── lib/
│   ├── env.ts                  # Zod-validated type-safe environment configuration
│   ├── paypal/                 # PayPal SDK client wrapper & helpers (Server-only)
│   ├── reconciliation/         # Deterministic matching & minor-unit money math
│   ├── ai/                     # Gemini client, prompt templates, and output schemas
│   ├── audit/                  # Audit event logger and verification
│   ├── security/               # Sanitizers, role validators, and credential guards
│   └── validation/             # Shared Zod schemas for all request/response models
└── types/                      # Universal domain interfaces & TypeScript definitions
```

