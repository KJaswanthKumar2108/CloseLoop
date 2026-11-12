# CloseLoop — Financial Precision & Mathematical Safety

> **Milestone:** Phase 2A — Financial Data Foundation & Deterministic Matching Engine  
> **Status:** Hardened & Formally Remediated

---

## 1. Zero Floating-Point Drift

Standard IEEE 754 floating-point arithmetic introduces rounding drift in computer software:
$$\text{JavaScript: } 0.1 + 0.2 = 0.30000000000000004$$

In CloseLoop, **floating-point arithmetic is strictly prohibited** for all authoritative financial totals, aggregations, variances, fees, and comparisons.

---

## 2. Integer Minor-Unit Representation

All monetary values are parsed into and stored as **integer minor units** (`amountMinor: number`) alongside the ISO 4217 currency code and designated precision:

```typescript
export interface Money {
  amountMinor: number; // e.g. 1050 for $10.50 USD, 500 for ¥500 JPY
  currency: string;    // e.g. "USD", "JPY", "BHD"
  precision: number;   // 2 for USD, 0 for JPY, 3 for BHD
}
```

### Currency Precision Registry:
- **0 Decimal Places:** `JPY` (Japanese Yen), `KRW` (Korean Won), `CLP` (Chilean Peso), `VND` (Vietnamese Dong), `PYG`, `UGX`, `RWF`.
- **2 Decimal Places:** `USD`, `EUR`, `GBP`, `CAD`, `AUD`, `CHF`, `SGD`, `NZD`, `SEK`, `NOK`, etc.
- **3 Decimal Places:** `BHD` (Bahraini Dinar), `KWD` (Kuwaiti Dinar), `OMR` (Omani Rial), `JOD`, `TND`, `LYD`, `IQD`.

---

## 3. Strict Decimal Parsing Rules

When parsing string inputs into `Money` (`parseDecimalToMoney`):
1. **Excess Fractional Digit Rejection:**
   If USD is provided with `$10.505`, parsing throws an error because USD supports at most 2 decimal places.
2. **Zero-Decimal Strictness:**
   Providing `¥500.5` for JPY throws an error because JPY has zero decimal places.
3. **Malformed Input Rejection:**
   Strings such as `"10..5"`, `"--10"`, `"abc"`, and empty strings are rejected.
4. **Integer Overflow Protection:**
   Amounts where $| \text{amountMinor} | > \text{Number.MAX\_SAFE\_INTEGER}$ ($9,007,199,254,740,991$) throw an overflow error.
5. **Negative Value Preservation & Refunds:**
   Refunds and reversals preserve negative minor units (`-5000` minor units = `-$50.00`).
   When evaluating refund coverage against expected order revenue, the absolute magnitude $| \text{refundMinor} |$ is calculated strictly in integer minor units.

---

## 4. Refund Accounting: Full vs. Partial Classification

Refunds are debits, not revenue settlements. When an order is matched to refund records:
1. **Full Refund Settlement (`FULL_REFUND_SETTLEMENT`):**  
   Occurs when cumulative refund magnitude $| \text{refundMinor} | \ge \text{expectedAmountMinor}$. The entire order gross has been reversed back to the buyer.
2. **Partial Refund Mismatch (`PARTIAL_REFUND_MISMATCH`):**  
   Occurs when cumulative refund magnitude $| \text{refundMinor} | < \text{expectedAmountMinor}$. A partial credit was issued, leaving a residual unadjusted balance on the order.

---

## 5. Gross vs. Net vs. Fee Isolation

PayPal settlement activity tracks three distinct monetary figures:
$$\text{Gross Capture Amount} - \text{PayPal Fee} = \text{Net Settlement Payout}$$

CloseLoop enforces strict architectural boundaries:
- A merchant order for \$100.00 is compared against the PayPal **Gross Amount** (\$100.00), not the Net Settlement (\$96.02).
- The PayPal fee (\$3.98) is recorded in `feeAmount` and evaluated against expected merchant fee schedules.
- Fees are never subtracted from gross amounts during matching passes.
- Gross amounts are never conflated with net settlement amounts.

---

## 6. Arithmetic and Currency Boundaries

### 6.1 Cross-Currency Isolation
Adding or subtracting amounts of different currencies is strictly prohibited:
```typescript
addMoney(usdMoney, eurMoney); 
// Throws Error: Cannot add amounts with mismatched currencies: USD and EUR
```
Cross-currency aggregation requires an explicit, verified exchange rate conversion operation.

### 6.2 Formatting Immutability
`formatMoney()` and `moneyToDecimalString()` are pure functions. Formatting a `Money` instance never alters or mutates the underlying integer minor units.
