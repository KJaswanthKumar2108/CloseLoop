# CloseLoop — CSV Import Format & Column Mapping Specification

> **Milestone:** Phase 2A — Financial Data Foundation & Deterministic Matching Engine  
> **Status:** Hardened & Formally Remediated

---

## 1. Overview

CloseLoop supports two separately uploaded CSV formats:
1. **Merchant Order Ledger CSV** (records from your e-commerce platform, CRM, or ERP).
2. **PayPal Transaction Export CSV** (settlement activity reports exported from PayPal).

The import pipeline handles UTF-8 Byte Order Marks (BOM), quoted values containing commas, and case-insensitive column variations.

---

## 2. Merchant Order CSV Specification

### Required Columns:
| Canonical Field | Supported Column Header Aliases | Type / Format | Example |
|---|---|---|---|
| **Order ID** | `order_id`, `order id`, `merchant_order_id`, `order number`, `order #`, `orderid`, `id` | Alphanumeric String | `ORD-9021` |
| **Amount** | `amount`, `order amount`, `total`, `expected_amount`, `grand_total`, `gross amount`, `order_total` | Decimal String (Exact precision) | `120.00` |
| **Currency** | `currency`, `currency_code`, `currency code`, `ccy` | ISO 4217 (3 uppercase letters) | `USD`, `EUR`, `JPY` |
| **Date** | `date`, `order_date`, `created_at`, `order date`, `timestamp`, `created at` | ISO 8601 or `YYYY-MM-DD HH:MM:SS` | `2026-11-01T10:00:00Z` |

### Optional Columns:
| Canonical Field | Supported Column Header Aliases | Type / Format | Example |
|---|---|---|---|
| **Invoice / Reference** | `external_reference`, `reference`, `ref`, `invoice_id`, `invoice number`, `payment_reference`, `custom_id` | String | `INV-2026-001` |
| **Customer Reference** | `customer`, `customer_email`, `email`, `customer_name`, `customer_id` | String (Masked in UI) | `alice@example.com` |
| **Order Status** | `order_status`, `status`, `fulfillment_status` | `CREATED`, `CONFIRMED`, `FULFILLED`, `CANCELLED` | `CONFIRMED` |
| **Payment Status** | `payment_status`, `pay_status` | `UNPAID`, `AUTHORIZED`, `PAID`, `PARTIALLY_PAID` | `PAID` |

### Sample Merchant Orders CSV:
```csv
order_id,amount,currency,date,customer,external_reference
ORD-DEMO-001,120.00,USD,2026-11-01T10:00:00Z,alice@example.com,INV-2026-001
ORD-DEMO-002,85.50,EUR,2026-11-01T11:00:00Z,bob@example.de,INV-2026-002
ORD-DEMO-003,15000,JPY,2026-11-01T12:00:00Z,charlie@example.jp,INV-2026-003
```

---

## 3. PayPal Transaction Export CSV Specification

### Required Columns:
| Canonical Field | Supported Column Header Aliases | Type / Format | Example |
|---|---|---|---|
| **Transaction ID** | `transaction id`, `txn_id`, `transaction_id`, `paypal transaction id`, `transactionid`, `id` | PayPal Alphanumeric ID | `9AB12345CD67890EF` |
| **Gross Amount** | `gross`, `gross amount`, `amount`, `total`, `transaction amount` | Decimal String | `120.00` |
| **Currency** | `currency`, `currency code`, `currency_code`, `ccy` | ISO 4217 | `USD`, `EUR` |
| **Date** | `date`, `transaction date`, `datetime`, `timestamp`, `creation date` | ISO 8601 or `YYYY-MM-DD` | `2026-11-01` |

### Optional Columns:
| Canonical Field | Supported Column Header Aliases | Type / Format | Example |
|---|---|---|---|
| **Time** | `time`, `transaction time` | `HH:MM:SS` (merged with Date) | `10:02:15` |
| **Fee Amount** | `fee`, `fee amount`, `paypal fee`, `fees` | Decimal String (negative or positive) | `-4.68` |
| **Net Amount** | `net`, `net amount`, `settlement amount` | Decimal String | `115.32` |
| **Type** | `type`, `transaction type`, `event code`, `event type` | Validated Type | `Payment` |
| **Status** | `status`, `transaction status`, `payment status` | Validated Status | `Completed` |
| **Order ID** | `order id`, `order_id`, `paypal order id`, `checkout order id` | PayPal Order Reference | `ORD-DEMO-001` |
| **Capture ID** | `capture id`, `capture_id`, `paypal capture id` | PayPal Capture ID | `CAP-9912` |
| **Invoice ID** | `invoice id`, `invoice_id`, `invoice number` | Invoice ID | `INV-2026-001` |
| **Merchant Reference** | `custom number`, `custom id`, `reference`, `memo`, `item id` | String | `ORD-DEMO-001` |

### Sample PayPal Transactions CSV:
```csv
Transaction ID,Gross,Fee,Net,Currency,Date,Type,Status,Order ID,Custom Reference
TXN-DEMO-001,120.00,-4.68,115.32,USD,2026-11-01T10:02:15Z,Payment,Completed,ORD-DEMO-001,INV-2026-001
TXN-DEMO-002,85.50,-3.37,82.13,EUR,2026-11-01T11:05:00Z,Payment,Completed,ORD-DEMO-002,INV-2026-002
TXN-DEMO-003,15000,-550,14450,JPY,2026-11-01T12:10:00Z,Payment,Completed,ORD-DEMO-003,INV-2026-003
```

---

## 4. Strict Validation & Rejection Policy (Zero Silent Fallbacks)

In accordance with CloseLoop's financial integrity standards, **silent defaulting of corrupted or unrecognized inputs is strictly prohibited**:

1. **Transaction Type Strictness:**
   - Empty, missing, or unrecognized transaction types (e.g., `ACCOUNT_HOLD`, `SUSPENDED_PAYMENT`, `CHARGE_FAILED`) **never** default to `CAPTURE`.
   - The importer rejects the row, records a `RowValidationError` (`field: 'type'`), and excludes it from the normalized dataset.
2. **Transaction Status Strictness:**
   - Empty, missing, or unrecognized transaction statuses (e.g., `EXPIRED_AUTH`, `UNKNOWN_STATUS`) **never** default to `COMPLETED`.
   - The importer rejects the row, records a `RowValidationError` (`field: 'status'`), and excludes it from the normalized dataset.
3. **Row-Level Tracking:**
   Every rejected row is logged with its exact source row number, field name, raw input value, and diagnostic error message.
4. **Duplicate ID Detection:**
   Duplicate order IDs or transaction IDs within an ingested CSV are identified and flagged as duplicate rows.
5. **API Ingestion Safeguards (CSV Preview Route):**
   - **Row Limit:** CSV batches are limited to a maximum of **5,000 rows** per file. Requests exceeding 5,000 rows are rejected immediately with `400 Payload Too Large / Row Limit Exceeded`.
   - **Byte Guard:** Streaming byte guards enforce a **10MB ceiling** across all incoming uploads.
