# CloseLoop — Security & Compliance Architecture

---

## 1. Threat Model & Security Boundaries

CloseLoop processes financial transaction data and interfaces with the PayPal Developer Platform. Securing API credentials, preventing unauthorized financial operations, and ensuring deterministic execution are critical priorities.

```
+-------------------------------------------------------------------------------+
|                            UNTRUSTED CLIENT BROWSER                           |
|  - Renders UI, receives sanitized data summaries.                             |
|  - Has NO access to PayPal API secrets, tokens, or Gemini keys.               |
|  - Can only submit action approval requests with user session context.        |
+-------------------------------------------------------------------------------+
                                       |
                                       | HTTPS (Strict CORS, CSRF Protection)
                                       v
+-------------------------------------------------------------------------------+
|                          TRUSTED SERVER-SIDE RUNTIME                          |
|  - Next.js Route Handlers & Server Components.                                |
|  - Loads environment variables (PAYPAL_CLIENT_ID, PAYPAL_SECRET, GEMINI_KEY). |
|  - Validates all client inputs with strict Zod schemas.                       |
|  - Enforces role-based authorization for all financial approvals.             |
|  - Runs deterministic math and never trusts client-supplied balances.         |
+-------------------------------------------------------------------------------+
           |                                                 |
           | TLS 1.3 (mTLS / OAuth2 Bearer)                  | TLS 1.3 (API Key)
           v                                                 v
+-------------------------------------+   +-------------------------------------+
|        PAYPAL SANDBOX API           |   |           GOOGLE GEMINI API         |
|  - https://api-m.sandbox.paypal.com |   |  - LLM Inference Service           |
+-------------------------------------+   +-------------------------------------+
```

---

## 2. PayPal Credentials & Environment Isolation

### 2.1 Server-Side Isolation
- Under no circumstance are `PAYPAL_CLIENT_ID` or `PAYPAL_SECRET` exposed to the browser.
- No client-facing variable may carry the `NEXT_PUBLIC_` prefix for sensitive keys.
- All PayPal API communication occurs strictly within server-side modules (`src/lib/paypal/`).

### 2.2 Strict Sandbox Enforcement
- During all development, staging, and hackathon evaluation runs, `PAYPAL_ENVIRONMENT` defaults strictly to `sandbox`.
- The base URL is constrained to `https://api-m.sandbox.paypal.com`.
- Hardcoding credentials in source code is strictly forbidden. All values are read from environment variables.

---

## 3. Human Approval & Financial Action Safeguards

Financial operations (such as approving an adjusting entry, syncing records, or issuing dispute responses) must never be executed autonomously by an AI agent:

1. **Two-Phase Commit for Financial Actions:**
   - AI Copilot may only propose actions in draft form (`status: PENDING_APPROVAL`).
   - Execution requires an authenticated user with appropriate permissions to submit an explicit approval.
2. **Server-Side Re-Validation:**
   - The backend never trusts the client's payload alone; it recalculates the variance and verifies the transaction status against PayPal before executing the action.
3. **Idempotency Protection:**
   - All approval execution requests must include a unique idempotency key to prevent double execution or duplicate postings.

---

## 4. AI Guardrails & Prompt Injection Defense

1. **Deterministic Grounding:**
   - AI models receive strictly sanitized transaction JSON objects.
   - Prompts mandate that the model explain only the provided data and never assume or hallucinate external transactions.
2. **Schema-Constrained Outputs:**
   - All AI responses are validated against a Zod schema specifying allowed fields and enumeration types for suggested actions.
   - Any response violating the schema is rejected, preventing unexpected model instructions from reaching downstream systems.
3. **No Direct System Control:**
   - The AI model has no direct database write access or direct network access to PayPal endpoints. It can only generate structured proposals for human review.

---

## 5. Input Validation & Data Minimization

- **Zod Validation:** Every API route validates request bodies and query parameters with Zod schemas.
- **PII Minimization:** Customer payment card numbers, CVVs, and sensitive banking numbers are never received or stored by CloseLoop. PayPal handles PCI-compliant card capture; CloseLoop only ingests high-level identifiers (`transaction_id`, `payer_id`, `payer_email`, masked names).
- **Sanitized Health Checks:** The `/api/health` endpoint reports boolean flags (`true`/`false`) indicating configuration presence, never returning secret strings or token previews.

---

## 6. Audit Trail & Non-Repudiation

- All critical events (logins, reconciliation runs, manual overrides, AI suggestions, approvals, API calls) are written to an append-only audit log.
- Audit records store timestamps, actor IDs, previous event hash pointers, and payload summaries to provide a tamper-evident audit trail for financial compliance.

