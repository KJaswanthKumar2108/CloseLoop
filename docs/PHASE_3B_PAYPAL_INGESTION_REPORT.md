# CloseLoop — Phase 3B Implementation Report: PayPal Transaction Search & Normalization (Remediated)

**Project:** CloseLoop  
**Tagline:** Every payment accounted for. Every discrepancy explained. Every action under control.  
**Milestone:** Phase 3B — PayPal Transaction Search API & Deterministic Transaction Normalization (Remediation)  
**Status:** Completed, Remediated & Verified  
**Date:** November 2026  

---

## 1. Architecture and Data Flow

Phase 3B implements a secure, read-only transaction search and normalization bridge between the PayPal Sandbox Reporting API and CloseLoop's internal financial domain.

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Browser / UI Layer                                   │
│  src/app/settings/page.tsx -> src/components/settings/PayPalTransactionPreviewCard │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ fetchPayPalTransactionPreview()
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      Server-Side API Route (Next.js)                             │
│                  GET /api/paypal/transactions?startDate=...&endDate=...          │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ validateSearchQueryParams()
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                      Transaction Search Service                                  │
│                 src/lib/paypal/transactionSearch.ts                              │
│   • Enforces 31-day date range limit & RFC 3339 timestamps                       │
│   • Reuses Phase 3A getValidOAuthToken() from src/lib/paypal/auth.ts             │
│   • Bounded pagination loop with safety caps                                     │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ GET /v1/reporting/transactions
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        PayPal Sandbox Reporting API                              │
│                      https://api-m.sandbox.paypal.com                            │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Raw JSON payload
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                 Runtime Schema Validation (Zod)                                  │
│                 src/lib/paypal/transactionSchemas.ts                             │
│   • Validates transaction_info, amounts, currency codes, pagination metadata    │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Validated PayPalTransactionDetail[]
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│             Strict Customer-Payment Normalizer (Remediated)                      │
│                     src/lib/paypal/normalizer.ts                                 │
│   • Conservative Customer-Payment Allowlist (Checkout, Refunds, Reversals, Holds)│
│   • Official Status Contract (S, P, D, V only; F rejected as UNMAPPED_STATUS)    │
│   • Directional Consistency Gate (CAPTURE > 0, REFUND < 0, etc.)                │
│   • Deterministic Record Identity from immutable source fields (zero index dep)  │
│   • Explicit Structured Rejection Matrix for non-order balance movements         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
                                         ▼
                       TransactionSearchPreviewResult
        (Normalized PaymentTransaction[] + Rejected Items + Lag Notice)
```

---

## 2. Files Modified and Maintained

| File Path | Purpose |
| :--- | :--- |
| `src/lib/paypal/normalizer.ts` | Remediated pure normalization engine enforcing a strict customer-payment allowlist, official status mapping, directional integrity, deterministic composite record identity without array-index dependence, and structured rejection reasons. |
| `src/lib/paypal/transactionSchemas.ts` | Strict runtime Zod schemas for PayPal Transaction Search API items, currency amounts, payer info, and pagination metadata. |
| `src/lib/paypal/transactionSearch.ts` | Server-side query validator, bounded pagination client, timeout handler, and preview orchestrator. |
| `src/app/api/paypal/transactions/route.ts` | Server-side GET endpoint returning typed, sanitized preview results with zero secret leakage. |
| `src/components/settings/PayPalTransactionPreviewCard.tsx` | Interactive UI component for selecting dates, previewing normalized customer records, viewing rejected non-reconciling records, and displaying latency advisories. |
| `src/lib/paypal/__tests__/transactionSearch.test.ts` | 46 comprehensive unit and integration tests covering query validation, schema parsing, strict customer-payment allowlist, non-order event rejections, directional checks, stable identity, error handling, and zero leakage. |
| `docs/PHASE_3B_PAYPAL_INGESTION_REPORT.md` | This technical architectural report. |

---

## 3. Strict Customer-Payment Allowlist (Remediated)

CloseLoop's `PaymentTransaction` domain is a customer-payment reconciliation model designed to match merchant sales orders against settled funds, customer refunds, chargebacks, and holds. It is **not** a general-ledger balance dump.

To protect the reconciliation engine from ledger contamination, a **conservative allowlist** is enforced:

| PayPal Event Code | Official PayPal Description | CloseLoop `TransactionType` | Allowlist Criteria Satisfied |
| :--- | :--- | :--- | :--- |
| `T0000` | General PayPal checkout payment | `CAPTURE` | Direct customer payment for merchant order; gross amount > 0. |
| `T0002` | Subscription / recurring payment | `CAPTURE` | Automated recurring customer purchase; gross amount > 0. |
| `T0006` | Express Checkout payment | `CAPTURE` | Express customer order capture; gross amount > 0. |
| `T0007` | Website Payments Standard | `CAPTURE` | Standard website button customer payment; gross amount > 0. |
| `T0011` | Mobile payment | `CAPTURE` | In-app / mobile customer order capture; gross amount > 0. |
| `T0012` | Virtual Terminal payment | `CAPTURE` | Phone / back-office card payment; gross amount > 0. |
| `T0013` | Donation payment | `CAPTURE` | Voluntary customer contribution payment; gross amount > 0. |
| `T0018` | Point of sale (PoS) payment | `CAPTURE` | In-person card reader customer payment; gross amount > 0. |
| `T1107` | Payment refund | `REFUND` | Merchant refund to customer; debit amount < 0. |
| `T1106` | Payment reversal | `REVERSAL` | Payment reversal of settled transaction; debit amount < 0. |
| `T1201` | Chargeback debit | `DISPUTE_HOLD` | Customer bank credit card dispute hold; debit amount < 0. |
| `T1300` | General authorization | `AUTHORIZATION` | Pre-authorization hold prior to capture; amount > 0. |
| `T1301` | Reauthorization | `AUTHORIZATION` | Pre-authorization extension; amount > 0. |

---

## 4. Explicitly Rejected Event Categories and Rationale

Any event code not in the conservative customer-payment allowlist is **strictly rejected** from the reconciliation collection with `status: 'REJECTED'`, `reason: 'UNSUPPORTED_EVENT_CODE'`, and an authoritative accounting description:

| Event Family | Example Codes | Official Nature | Exclusion Rationale |
| :--- | :--- | :--- | :--- |
| **Mass Payouts** | `T0001` | Mass Pay payout disbursement | Non-order disbursement to affiliates/vendors, not customer revenue. Excluded from order reconciliation. |
| **Merchant / Partner Fees** | `T0100`–`T0118` | General merchant fees, cross-border fees, interchange, monthly service fees | Merchant operating fee deductions, not customer payment captures. Excluded from order reconciliation. |
| **Currency Conversions** | `T0200`, `T0201` | General foreign exchange balance redenomination, user-initiated conversion | Internal multi-currency balance transfers between wallet buckets, not customer payments or fees. Excluded from order reconciliation. |
| **Account Funding / Deposits** | `T0300`–`T0303` | Bank deposits into PayPal, Balance Manager funding, ACH balance replenishment | Inbound cash deposits by merchant to fund account balance, not customer sales or outbound payouts. Excluded from order reconciliation. |
| **Bank Withdrawals** | `T0400` | General bank withdrawal | Outbound merchant cash sweep to external checking account, not customer pre-authorization. Excluded from order reconciliation. |
| **Hold Adjustments** | `T1105` | Reversal of general account hold | Internal risk hold release, not a customer payment reversal. Excluded from order reconciliation. |
| **Fee Adjustments** | `T1108` | Fee reversal | Partner processing fee refund/adjustment, not customer order reversal. Excluded from order reconciliation. |
| **Dispute Reimbursements** | `T1202` | Chargeback reversal / merchant reimbursement | Funds returned to merchant after winning dispute, not an active dispute hold. Excluded from customer reconciliation. |
| **Bad Debt Adjustments** | `T1203` | Charge-off adjustment | Accounting bad-debt write-off, not an active dispute hold. Excluded from customer reconciliation. |
| **Authorization Voids** | `T1302` | Void of authorization | Authorization cancellation, not capture or refund. Excluded from customer reconciliation. |
| **Unknown / Custom** | `T9999`, etc. | Unmapped / internal PayPal codes | Explicitly rejected with `UNSUPPORTED_EVENT_CODE`. |

Rejected records are preserved and displayed under the "Rejected / Unsupported" tab in the Workbench Settings UI, with zero silent drops.

---

## 5. Official PayPal Reporting Status Contract

CloseLoop strictly adheres to the official PayPal Transaction Search reporting status contract:
- `S` / `COMPLETED` / `SUCCESS` / `CLEARED` -> `COMPLETED`
- `P` / `PENDING` / `IN_PROGRESS` / `PROCESSING` -> `PENDING`
- `D` / `DENIED` / `DECLINED` -> `DENIED`
- `V` / `REVERSED` -> `REVERSED`

### Status "F" Exclusion
Status `F` (or `FAILED`) is **not** an official PayPal Reporting Transaction Search status code (PayPal Reporting uses `D` for Denied and `V` for Reversed). Any record presenting `F` or unrecognized strings is explicitly rejected with `reason: 'UNMAPPED_STATUS'` and an informative diagnostic message. An unknown status is never defaulted to `COMPLETED`.

---

## 6. Financial Direction and Amount Policy

CloseLoop enforces strict directional integrity to prevent accounting contradictions:
1. **CAPTURE:** Must have `grossAmount.amountMinor > 0`. A negative or zero capture is rejected with `INVALID_AMOUNT` (`Directional conflict: CAPTURE transaction must have a positive gross amount`).
2. **AUTHORIZATION:** Must have `grossAmount.amountMinor > 0`. A negative or zero authorization is rejected with `INVALID_AMOUNT`.
3. **REFUND, REVERSAL, DISPUTE_HOLD:** Must have `grossAmount.amountMinor < 0`. A positive or zero debit/hold is rejected with `INVALID_AMOUNT` (`Directional conflict: REFUND transaction must have a negative gross amount`).
4. **Exact Minor Units:** All conversions use `parseDecimalToMoney(value, currency)` from [`src/lib/reconciliation/money.ts`](file:///c:/MY%20PROGRAMMING/closeloop/src/lib/reconciliation/money.ts). No floating point arithmetic is used anywhere in the pipeline.

---

## 7. Deterministic Record Identity Design

The prior implementation relied on page-local array indices (`:${index}`), which was unstable across pagination, date window shifts, and response reordering.

### Remediated Composite Identity
The new deterministic record identity is constructed exclusively from immutable source fields:

```ts
const refPart = info.paypal_reference_id
  ? `:${info.paypal_reference_id_type || 'REF'}_${info.paypal_reference_id.trim()}`
  : '';
const compositeId = `PP_${rawTxnId}:${eventCode}:${transactionStatus}:${transactionTime}:${currency}_${info.transaction_amount.value}${refPart}`;
```

### Properties and Guarantees:
1. **Zero Index Dependency:** Does not depend on array index, loop counter, page number, or query limits.
2. **Pagination Stability:** Calling `normalizePayPalTransactionDetail` on a record produces the identical ID whether fetched alone or as part of a 500-item page.
3. **Reordering Invariance:** Adding, removing, or reordering unrelated records in a batch leaves every existing record's composite ID intact.
4. **Shared `transaction_id` Preservation:** Multiple reporting items sharing the same PayPal transaction ID (e.g. an authorization and a capture, or a capture and a reversal) generate distinct, non-colliding composite IDs.
5. **Raw ID Preservation:** The pristine PayPal transaction ID is retained in `transaction.paypalTransactionId = rawTxnId`.

### Remaining Limitation / Collision Risk:
If PayPal reports two distinct reporting lines that have identical `transaction_id`, identical `transaction_event_code`, identical `transaction_status`, identical `transaction_initiation_date`, identical `currency` and `amount`, and identical `paypal_reference_id`, they would yield the same composite ID. In practice, PayPal reporting records differ in timestamp, reference, event code, or amount.

---

## 8. Quality-Gate Results and Exit Codes

All four mandatory quality gates were executed and passed with exit code 0:

| Quality Gate | Command | Exit Code | Verified Output |
| :--- | :--- | :--- | :--- |
| **Vitest Tests** | `npm test` | **0** | **230 / 230 passing across 12 suites** |
| **ESLint** | `npm run lint` | **0** | **0 errors, 0 warnings** |
| **TypeScript Compiler** | `npx tsc --noEmit` | **0** | **Clean compilation (0 errors)** |
| **Production Build** | `npm run build` | **0** | **All 20 routes compiled clean (Turbopack)** |

### Vitest Test Breakdown (230 tests total):
- `src/lib/paypal/__tests__/transactionSearch.test.ts`: **46 tests (PASS)**
- `src/lib/paypal/__tests__/auth.test.ts`: **26 tests (PASS)**
- `src/lib/paypal/__tests__/paypalClient.test.ts`: **4 tests (PASS)**
- `src/lib/reconciliation/__tests__/phase2a_final_audit.test.ts`: **13 tests (PASS)**
- `src/lib/reconciliation/__tests__/final_remediations.test.ts`: **32 tests (PASS)**
- `src/lib/reconciliation/__tests__/money.test.ts`: **30 tests (PASS)**
- `src/lib/reconciliation/__tests__/regression.test.ts`: **29 tests (PASS)**
- `src/lib/reconciliation/__tests__/matcher.test.ts`: **15 tests (PASS)**
- `src/lib/reconciliation/__tests__/workbench.test.ts`: **14 tests (PASS)**
- `src/lib/reconciliation/__tests__/importer.test.ts`: **9 tests (PASS)**
- `src/lib/reconciliation/__tests__/adversarial.test.ts`: **7 tests (PASS)**
- `src/lib/reconciliation/__tests__/fixtures.test.ts`: **5 tests (PASS)**

---

## 9. Protected-File Immutability Verification

Verification confirms **zero modifications** to Phase 2A and Phase 2B protected paths:
- `src/lib/reconciliation/matcher/**` — **UNTOUCHED**
- `src/lib/reconciliation/importer/**` — **UNTOUCHED**
- `src/lib/reconciliation/fixtures/**` — **UNTOUCHED**
- `src/lib/reconciliation/money.ts` — **UNTOUCHED**
- `src/types/financial.ts` — **UNTOUCHED**
- `src/lib/validation/schemas.ts` — **UNTOUCHED**
- All 9 Phase 2A & 2B baseline test suites — **UNTOUCHED & 100% PASSING**

Verification confirms **Phase 3A OAuth remains intact**:
- `src/lib/paypal/auth.ts` — **UNTOUCHED**
- `/api/paypal/status` — **UNTOUCHED**

---

## 10. Explicit Confirmation of Exclusions

- **NO Phase 3C Work:** No database persistence, no reconciliation run execution, no webhooks, no mutations.
- **NO Financial Mutations:** No refund/capture execution, no balance updates.
- **NO Live Endpoints:** Strictly targets PayPal Sandbox endpoints (`https://api-m.sandbox.paypal.com`).
- **NO Secret Leakage:** Zero credentials or access tokens returned in API responses.
