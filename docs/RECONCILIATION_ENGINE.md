# CloseLoop — Deterministic Financial Reconciliation Engine

> **Milestone:** Phase 2A — Financial Data Foundation & Deterministic Matching Engine  
> **Status:** Hardened & Formally Remediated (Zero LLM Dependency)

---

## 1. Overview & Architectural Philosophy

The **CloseLoop Deterministic Reconciliation Engine** is an algorithmic, multi-pass matching system designed to reconcile internal merchant ledger orders against payment settlement records (such as PayPal transaction exports).

Under CloseLoop's core architectural tenets:
1. **Mathematical Determinism:** Reconciliation matches and discrepancy classifications are determined strictly by rule-based algorithmic passes—never by probabilistic language models.
2. **Permutation Invariance & Reproducibility:** Input arrays of orders and transactions are canonically sorted by timestamp and unique identifier prior to processing. Shuffling the order or transaction arrays produces identical match results across runs.
3. **Capture Eligibility Rigor:** Only transactions with `transactionType === 'CAPTURE'` and `transactionStatus === 'COMPLETED'` can satisfy settled order balances. Authorizations, holds, pending transfers, and failed captures can never confirm settlement.
4. **Single-Record Ownership:** Every physical transaction is guaranteed to appear in at most one reconciliation record across all passes.
5. **Evidence-Grounded Auditability:** Every match, variance, and rejection produces an explicit, cryptographically verifiable `MatchingEvidence` record detailing compared fields, numerical minor-unit variances, timestamp deltas, and acceptance/rejection rationales.

---

## 2. Multi-Pass Matching Pipeline

```
[ Input: Merchant Orders ]             [ Input: Payment Transactions ]
             \                                      /
              \                                    /
               v                                  v
    +-------------------------------------------------------+
    | PRE-PASS: Canonical Sort & Multi-Capture Evaluation   |
    | - Orders sorted canonically: createdAt ASC, ID ASC.  |
    | - Txns sorted canonically: transactionTime ASC, ID.   |
    | - Aggregates multiple COMPLETED partial captures      |
    |   referencing the same merchant order.                |
    | - Flags MULTI_CAPTURE_VARIANCE, TIMING_DELAY, or     |
    |   CURRENCY_MISMATCH if non-completed txns present.   |
    +-------------------------------------------------------+
                               |
                               v
    +-------------------------------------------------------+
    | PASS 1: Authoritative Identifier Matching             |
    | - Evaluates PayPal Order ID, Capture ID, Merchant     |
    |   Reference, and Invoice ID.                          |
    | - Cross-validates all present identifiers to detect   |
    |   contradictory references (CONFLICTING_REFERENCES).  |
    | - Prioritizes completed CAPTURE over AUTHORIZATION.   |
    | - Classifies uncaptured AUTHORIZATION holds as       |
    |   TIMING_DELAY discrepancy.                           |
    +-------------------------------------------------------+
                               |
                               v
    +-------------------------------------------------------+
    | PASS 2: Global Deterministic Composite Matching      |
    | - Evaluates unlinked completed captures matching      |
    |   exact gross amount, currency, and time window.     |
    | - Constructs a global candidate bipartite graph.      |
    | - Resolves via Customer Reference priority and       |
    |   timestamp proximity.                                |
    | - Flags AMBIGUOUS if competing candidates lie within |
    |   the 300-second ambiguity tolerance window.          |
    +-------------------------------------------------------+
                               |
                               v
    +-------------------------------------------------------+
    | PASS 3: Candidate Scoring (Transparent Weights)      |
    | - Scores remaining candidates on 0–100 scale.         |
    | - Routes candidates to Human Authorization Gate;     |
    |   NEVER auto-confirms ambiguous records.              |
    | - Consumes candidate transactions into single-record |
    |   ownership tracking to prevent duplicate records.    |
    +-------------------------------------------------------+
                               |
                               v
    +-------------------------------------------------------+
    | PASS 4 & 5: Unmatched Classification                  |
    | - Pass 4: Categorizes unallocated orders             |
    |   (MISSING_PAYMENT).                                  |
    | - Pass 5: Categorizes unallocated transactions       |
    |   (AUTHORIZATION hold, REFUND, or MISSING_METADATA).  |
    +-------------------------------------------------------+
                               |
                               v
                [ Output: ReconciliationRun ]
```

---

## 3. Discrepancy Classification

When records match by identifier or composite attributes but exhibit variances, the engine classifies the discrepancy with mathematical precision:

| Discrepancy Type | Trigger Condition | Operational Implication |
|---|---|---|
| `NONE` | Exact minor-unit amount, currency, and completed capture status. | Fully reconciled. Clean batch balance. |
| `AMOUNT_MISMATCH` | Authoritative ID matches, but gross settled amount differs from order. | Price adjustment, unrecorded discount, or billing discrepancy. |
| `CURRENCY_MISMATCH` | Authoritative ID matches, but transaction settled in unexpected currency. | Cross-border billing error or missing automated conversion. |
| `TIMING_DELAY` | Linked transaction is in `PENDING` status or capture `AUTHORIZATION` hold. | Clearing lag. Expected to settle in subsequent banking window. |
| `DISPUTE_HOLD` | Linked transaction status is `REVERSED` or type `DISPUTE_HOLD`. | Customer dispute, chargeback, or risk hold. Balance frozen. |
| `PARTIAL_REFUND_MISMATCH` | Linked refund transaction total is less than expected order amount. | Customer refund settled in PayPal without matching ERP credit memo. |
| `FULL_REFUND_SETTLEMENT` | Linked refund transaction(s) equal or exceed full expected order amount. | Complete order refund settled; balance offset recognized. |
| `MULTI_CAPTURE_VARIANCE` | Sum of completed captures does not equal expected order amount, or capture failed. | Incomplete capture or partial fulfillment variance. |
| `MISSING_PAYMENT` | Merchant order exists with no settlement in PayPal. | Unpaid checkout, abandoned cart, or failed payment. |
| `MISSING_METADATA` | PayPal transaction exists with no corresponding merchant order. | External direct payment or missing ERP order ingestion. |
| `CONFLICTING_REFERENCES` | Transaction contains contradictory identifiers (e.g. Order ID points to Order A, but custom reference points to Order B). | Data corruption or hijacking attempt. Routed to Human Authorization Gate. |

---

## 4. Single-Record Ownership & Global Determinism Guarantees

1. **Permutation Invariance:**
   The engine guarantees identical outcomes regardless of array ingestion order. All orders and transactions are canonically sorted up-front. Pass 2 constructs a global edge graph across the entire unconsumed batch rather than greedily processing orders in input order.
2. **Strict Single-Record Ownership:**
   Each physical transaction is tracked in `consumedTransactionIds` and can appear in at most one reconciliation record across all passes. When Pass 3 scores candidate transactions for an unlinked order, those candidate transactions are marked consumed so Pass 5 does not generate duplicate `UNMATCHED_TRANSACTION` records for the same physical payment.
3. **Capture Settlement Exclusivity:**
   An `AUTHORIZATION` transaction is a credit hold, not settled funds. Even if PayPal marks the authorization status as `COMPLETED`, the reconciliation engine classifies it as a `TIMING_DELAY` discrepancy. Only `CAPTURE` transactions with `COMPLETED` status can confirm settlement.
4. **Multi-Capture Currency Integrity:**
   Multi-capture aggregation strictly prohibits mixing currencies. Any batch of partial captures containing divergent currencies immediately produces `CURRENCY_MISMATCH` with zero currency cross-addition.

---

## 5. Preview API Surface

```http
POST /api/reconciliation/preview
Content-Type: application/json
```

### JSON Mode:
```json
{
  "mode": "JSON",
  "orders": [ ... ],
  "transactions": [ ... ],
  "config": {
    "timestampToleranceSeconds": 172800,
    "ambiguityToleranceSeconds": 300,
    "allowMultiCapture": true
  }
}
```

### CSV Mode:
```json
{
  "mode": "CSV",
  "ordersCsv": "order_id,amount,currency,date\nORD-1,10.00,USD,2026-11-01T12:00:00Z\n",
  "transactionsCsv": "transaction_id,gross,currency,date\nTXN-1,10.00,USD,2026-11-01T12:00:00Z\n"
}
```

### API Security & Resilience Bounds:
- **Content-Type Enforcement:** Requires `application/json`; returns `415 Unsupported Media Type` otherwise.
- **Payload Guard:** Streaming byte counter aborts with `413 Payload Too Large` if payload exceeds 10MB.
- **Row Limit:** CSV parsing enforces a strict 5,000-row limit per file; returns `400 Payload Too Large / Row Limit Exceeded` if exceeded.
- **Sanitized Errors:** Internal server errors (500) return sanitized client messages, while logging diagnostic traces exclusively to secure server-side logs.
