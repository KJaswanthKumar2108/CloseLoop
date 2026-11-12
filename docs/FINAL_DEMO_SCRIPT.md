# CloseLoop — Final Hackathon 5-Minute Demonstration Script
## "Find it. Explain it. Fix it. Close it."

**Product:** CloseLoop — AI Agent for PayPal Payment Exception Resolution  
**Audience:** PayPal AI Hackathon Judges, FinTech Product Evaluators, Financial Engineers  
**Duration:** Exactly 5 Minutes  
**Demo Mode URL:** `http://localhost:3000/demo`  

---

## Pitch Overview (30 Seconds)

> **Speaker:**  
> "Every merchant running at scale on PayPal experiences payment exceptions: amount variances, timing delays, duplicate checkout taps, and missing order links.  
> Today, finance teams waste hundreds of hours manually cross-referencing order CSVs with PayPal statements.  
>
> Meet **CloseLoop**. Our motto is: **Find it. Explain it. Fix it. Close it.**  
> CloseLoop combines a frozen deterministic financial reconciliation engine with an evidence-grounded AI copilot, cryptographic human approval gates, and a controlled execution layer.  
> Crucially, our architecture guarantees absolute financial safety: AI proposes, humans authorize, and all simulations are cryptographically bound without unauthorized money movement."

---

## Step 1: Ingest & Detect — "Find It" (60 Seconds)

> **Action:** Navigate to **Reconciliation** (`/reconciliation`) or **Demo Workspace** (`/demo`).  
> **Screen:** Point out the reconciliation engine with exact minor-unit integer math.

> **Speaker:**  
> "Step 1 is **Find It**. CloseLoop connects directly to PayPal's Sandbox API via OAuth or ingests durable settlement ledgers. It matches external PayPal transactions against internal merchant orders.  
> 
> Unlike probabilistic matchers, our reconciliation core is deterministic and frozen. It does not use floating-point math; every calculation is in exact cents.  
> In our demo, the engine immediately flags exceptions into categorized buckets: `AMOUNT_MISMATCH`, `DUPLICATE_PAYMENT`, and `MISSING_ORDER_IN_MERCHANT`."

---

## Step 2: Grounded AI Investigation — "Explain It" (60 Seconds)

> **Action:** Open an exception case (e.g. `DEMO-ORD-101`) in **Exceptions** (`/exceptions`) or select Scenario 1 in `/demo`.  
> **Screen:** Show the **Evidence Graph** and the **AI Investigation Panel**.

> **Speaker:**  
> "Step 2 is **Explain It**. In traditional tools, AI is either disconnected or hallucinates fake transactions.  
> CloseLoop solves this through **relational financial evidence grounding**. Before the Gemini AI model is called, CloseLoop builds an immutable evidence graph verified by an SHA-256 fingerprint.  
> 
> The AI investigates only observed facts. Here, for order `DEMO-ORD-101`, it detects that while the customer was billed $100.00, PayPal captured $85.00 due to a fee schedule divergence. Notice the factual citations linked directly to database record IDs."

---

## Step 3: Declarative Recommendations & Uncertainty Scoring (45 Seconds)

> **Action:** Scroll down to the **Deterministic Resolution Copilot** panel.  
> **Screen:** Point out the `INVESTIGATE_AMOUNT_VARIANCE` recommendation card and uncertainty badge.

> **Speaker:**  
> "AI does not invent actions. CloseLoop uses a finite, declarative action catalog.  
> The engine evaluates strict preconditions and contraindications, scoring uncertainty from 0 to 100%.  
> Here, uncertainty is low (18%), so `INVESTIGATE_AMOUNT_VARIANCE` is recommended as the primary action.  
> In contrast, in Scenario 3 where data is missing, CloseLoop's uncertainty engine hits 72% and actively suppresses automated action, demanding supervisory review."

---

## Step 4: Cryptographic Human Approval — "Fix It" (60 Seconds)

> **Action:** Click **Request Approval** on the recommendation, then click **Review & Decide** (or navigate to `/approvals`).  
> **Screen:** Show the **Approval Decision Modal** with canonical binding hash and disclaimer.

> **Speaker:**  
> "Step 3 is **Fix It**. Under FinTech safety governance, no financial adjustment can occur without explicit human authorization.  
> 
> When the operator requests approval, CloseLoop serializes the action parameters, parent case version, and evidence fingerprint using RFC 8785 canonical JSON into an immutable 64-character SHA-256 hash. If any parameter or case version changes, the approval is automatically invalidated.  
> 
> The operator inputs their rationale and grants approval. This writes to an append-only, hash-chained audit ledger protected by PostgreSQL triggers that actively reject any UPDATE or DELETE."

---

## Step 5: Controlled Execution Simulation & Audit Verification — "Close It" (45 Seconds)

> **Action:** Click **Execute Action** to open the **Controlled Execution Modal**. Select **DRY RUN** and click **Execute Controlled Simulation**.  
> **Screen:** Show the simulated ledger vouchers and the `SIMULATED — NO FINANCIAL ACTION WAS EXECUTED` banner. Then click **Verify Hash Chain** to show the unbroken audit chain.

> **Speaker:**  
> "Step 4 is **Close It**. We now run the approved action through our Controlled Resolution layer.  
> 
> Notice the execution modes: Live execution is strictly disabled. PayPal Sandbox write is guarded. In `DRY_RUN` mode, CloseLoop generates an exact simulated adjusting journal entry debiting accounts receivable and crediting fee expense.  
> 
> Notice the mandatory disclaimer: **SIMULATED — NO FINANCIAL ACTION WAS EXECUTED.**  
> When we inspect the audit trail, we see a complete cryptographic chain of custody: from requested to approved to simulated execution, cryptographically linked and mathematically verifiable."

---

## Closing Summary (15 Seconds)

> **Speaker:**  
> "CloseLoop proves that AI can safely solve high-stakes FinTech exceptions:  
> - **Find it:** Deterministic reconciliation with zero floating point drift.  
> - **Explain it:** Grounded AI investigation with factual evidence citations.  
> - **Fix it:** Declarative recommendations with cryptographic human approval.  
> - **Close it:** Controlled simulation with tamper-evident audit trails.  
> 
> Thank you."

---

## Backup FAQ for Evaluators

1. **Why is live execution disabled?**  
   Financial safety first. CloseLoop operates as an advisory copilot and safe execution demonstration engine to prevent unverified financial mutations.
2. **How is demo data isolated from real transactions?**  
   Demo data lives in an isolated test harness tagged `DEMO DATA` and is never merged into the persisted merchant ledger.
3. **What happens if someone tampers with the database?**  
   PostgreSQL triggers reject direct UPDATE/DELETE operations with SQLSTATE `23514`. Furthermore, the audit hash chain validator detects any byte modification instantly.

