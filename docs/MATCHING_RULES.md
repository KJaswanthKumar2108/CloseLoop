# CloseLoop — Matching Rules & Confidence Methodology

> **Milestone:** Phase 2A — Financial Data Foundation & Deterministic Matching Engine  
> **Status:** Hardened & Formally Remediated

---

## 1. Matching Strategy Overview

The CloseLoop matching engine processes records across deterministically ordered passes. A transaction consumed in an earlier pass is never re-allocated in a later pass.

```
+-----------------------------------------------------------------------------------------+
|                                    MATCHING PASSES                                      |
|                                                                                         |
|  Pre-Pass: Multi-Capture Evaluation  ==> Aggregates eligible completed partial captures |
|  Pass 1: Authoritative Identifiers   ==> Strong ID links + Conflict checks (100% conf)  |
|  Pass 2: Global Composite Matching   ==> Exact Amount + CCY + Time Window (90% conf)    |
|  Pass 3: Candidate Scoring (Draft)   ==> Scored 0–100; Requires Human Sign-Off (Draft)   |
|  Pass 4: Unmatched Orders            ==> Isolated into MISSING_PAYMENT                   |
|  Pass 5: Unmatched Transactions      ==> Isolated into TIMING_DELAY / MISSING_METADATA   |
+-----------------------------------------------------------------------------------------+
```

---

## 2. Pre-Pass & Multi-Capture Aggregation Rules

When an order is paid across multiple partial transactions (e.g., split shipment, backorders), the engine applies strict eligibility checks:

1. **Capture Eligibility:**  
   Only transactions where `transactionType === 'CAPTURE'` and `transactionStatus === 'COMPLETED'` contribute to the settled capture total.
2. **Ineligible Transaction Segregation:**  
   Transactions with status `PENDING` flag `TIMING_DELAY`. Transactions with status `DENIED` or `FAILED` flag `MULTI_CAPTURE_VARIANCE`. They are never counted toward paid balance.
3. **Capture ID Deduplication:**  
   Transactions are deduplicated by `paypalTransactionId`. A duplicated record row cannot contribute its gross amount multiple times.
4. **Currency Isolation:**  
   All partial captures referencing an order must match `order.currency`. If currencies diverge, the engine flags `CURRENCY_MISMATCH` and prohibits arithmetic aggregation.
5. **Variance Accounting:**  
   If the sum of completed captures is less than the expected order amount, the engine flags `MULTI_CAPTURE_VARIANCE` with minor-unit shortfall. If it exceeds expected amount, it flags `MULTI_CAPTURE_VARIANCE` with over-capture variance.
6. **Auth-and-Single-Capture Separation:**  
   If an order references 1 completed capture and 1 authorization hold, it is recognized as a standard auth-capture flow rather than a multi-capture variance; Pass 1 evaluates and matches the completed capture, leaving the authorization hold cleanly separated.

---

## 3. Pass 1 — Authoritative Identifier Rules & Cross-Validation

Records are matched if verified identifier relationships exist:
1. **Rule 1.1 (`RULE_AUTH_PAYPAL_ORDER_ID`):** PayPal `paypalOrderId` matches `merchantOrderId` OR `externalReference`.
2. **Rule 1.2 (`RULE_AUTH_CAPTURE_ID`):** PayPal `paypalCaptureId` matches `externalReference` OR `merchantOrderId`.
3. **Rule 1.3 (`RULE_AUTH_MERCHANT_REFERENCE`):** PayPal `merchantReference` (`custom_id` / `invoice_id`) matches `merchantOrderId` OR `externalReference`.
4. **Rule 1.4 (`RULE_AUTH_INVOICE_ID`):** PayPal `invoiceId` matches `externalReference` OR `merchantOrderId`.

### 3.1 Contradictory Reference Detection:
In payment systems, compromised or corrupted records may contain a valid `paypalOrderId` matching Order A, but a `merchantReference` pointing to Order B.
- The engine cross-validates all present identifiers on the transaction against the order.
- If any present identifier explicitly contradicts the order's references, the engine marks the record as `matchStatus: DISCREPANCY`, `discrepancyType: CONFLICTING_REFERENCES`, and `confidence: MANUAL_REVIEW_REQUIRED`.
- It is never auto-confirmed as clean settlement.

### 3.2 Authorization Hold Classification:
- Uncaptured credit holds (`transactionType === 'AUTHORIZATION'`) are credit reservations, not settled revenue.
- Even if PayPal marks the authorization transaction status as `COMPLETED` (authorizing the hold), the engine classifies it as `matchStatus: DISCREPANCY` with `discrepancyType: TIMING_DELAY`.
- When an order contains both an `AUTHORIZATION` hold and a subsequent completed `CAPTURE`, Pass 1 prioritizes the completed capture to confirm settlement, leaving the hold isolated.

### 3.3 Full vs. Partial Refund Classification:
- If a linked transaction is a `REFUND`:
  - When $| \text{grossAmount} | \ge \text{expectedAmount}$, the discrepancy is classified as `FULL_REFUND_SETTLEMENT`.
  - When $| \text{grossAmount} | < \text{expectedAmount}$, the discrepancy is classified as `PARTIAL_REFUND_MISMATCH`.

---

## 4. Pass 2 — Global Composite Heuristic Matching & Ambiguity Threshold

When no authoritative identifier is present, unallocated records are evaluated against composite criteria:
1. **Exact Amount:** Minor units match exactly (`order.expectedAmount.amountMinor === txn.grossAmount.amountMinor`).
2. **Exact Currency:** ISO 4217 currency match.
3. **Completed Capture State:** Transaction must be a completed `CAPTURE`.
4. **Timestamp Proximity Window:**  
   $$|t_{\text{transaction}} - t_{\text{order}}| \le T_{\text{tolerance}} \quad (\text{Default: 48 hours = 172,800 seconds})$$

### 4.1 Ambiguity Tolerance Window Justification:
In e-commerce payment flows, payment gateway roundtrips, Webhook deliveries, and customer checkout sessions introduce network jitter between 1 and 180 seconds.
- CloseLoop enforces an **`ambiguityToleranceSeconds` threshold of 300 seconds (5 minutes)**.
- If two or more candidate transactions share identical amounts and currencies within 300 seconds of each other (and lack distinguishing customer reference data), treating a 1-second or 2-second timestamp difference as an authoritative tie-breaker is financially reckless.
- **Ambiguity Policy:** When competing candidates fall within the 300-second ambiguity window without distinguishing metadata, the engine flags `matchStatus: AMBIGUOUS` with `confidence: MANUAL_REVIEW_REQUIRED`. Neither transaction is auto-confirmed.
- When timestamp differences exceed 300 seconds, the closest candidate is deterministically selected.

---

## 5. Pass 3 — Candidate Scoring Methodology

For unlinked orders, remaining candidates are scored using deterministic weights (summing to 100):

| Component | Weight | Criteria |
|---|---|---|
| **Exact Amount** | 45 points | Minor units match exactly. |
| **Exact Currency** | 25 points | ISO currency codes match. |
| **Timestamp Proximity** | 15 points | $\le 24\text{h}$: 15 pts; $\le 48\text{h}$: 11 pts; $\le 7\text{d}$: 5 pts. |
| **Partial Reference** | 15 points | Token or partial substring overlap between order ref and custom text. |

> **Crucial Guarantee:** Candidate scores are **heuristic weights**, NOT probabilities. Heuristic candidates are **never** confirmed automatically; they are routed to the Human Authorization Gate.
