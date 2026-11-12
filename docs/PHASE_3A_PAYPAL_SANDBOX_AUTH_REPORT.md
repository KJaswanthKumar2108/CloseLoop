# CloseLoop — Phase 3A Implementation Report: PayPal Sandbox Authentication & Connectivity

**Project:** CloseLoop  
**Tagline:** Every payment accounted for. Every discrepancy explained. Every action under control.  
**Milestone:** Phase 3A — PayPal Sandbox OAuth Authentication & Connectivity  
**Status:** Completed & Formally Verified  
**Date:** November 2026  

---

## 1. Scope & Explicit Exclusions

### Scope of Phase 3A
Phase 3A establishes the secure, server-only OAuth2 authentication bridge and connectivity verification against the PayPal Sandbox platform.
- Server-side environment configuration for PayPal Sandbox credentials.
- Server-process OAuth2 client credentials flow with HTTP Basic authentication.
- Strict runtime Zod schema parsing and validation of PayPal token responses.
- Permission enforcement for the required Transaction Search scope (`https://uri.paypal.com/services/reporting/search/read`).
- Process-local in-memory token cache with pre-expiration safety buffering and single-flight in-flight request deduplication.
- Sanitized `GET /api/paypal/status` connectivity endpoint that never leaks secrets, access tokens, or Authorization headers.
- Interactive Settings UI card (`PayPalSandboxCard`) with clear status badges and "Test Sandbox Connection" verification action.
- Comprehensive 30-test Vitest suite covering wire protocol, environment validation, error handling, scope authorization, concurrency, and security leakage prevention.

### Explicit Exclusions
Strictly following the project boundaries:
- **NO Transaction Search Ingestion:** No calls to `/v1/reporting/transactions` were made or implemented.
- **NO Financial Mutations:** No payment creation, capture, refund, void, payout, order placement, or balance adjustment exists in any route, component, or helper.
- **NO Webhooks:** No webhook listener or ingestion endpoints were created.
- **NO Phase 2A Alterations:** All Phase 2A financial math, matching algorithms, importers, and fixtures remain 100% frozen and untouched.
- **NO AI Features:** Google Gemini AI integration remains scheduled for Phase 4.

---

## 2. Files Created & Modified

### Created Files
| File Path | Description |
| :--- | :--- |
| `src/lib/paypal/auth.ts` | Server-only OAuth2 client, in-memory token cache, single-flight deduplication, error taxonomy, and connection verifier. |
| `src/app/api/paypal/status/route.ts` | Server-side GET endpoint returning sanitized connectivity status with appropriate HTTP codes (200, 401, 403, 503). |
| `src/lib/api/paypalClient.ts` | Typed client-side API helper invoking `/api/paypal/status` from the browser. |
| `src/components/settings/PayPalSandboxCard.tsx` | Interactive React client component for testing Sandbox connectivity and displaying verified scope states. |
| `src/lib/paypal/__tests__/auth.test.ts` | 26 unit and integration tests covering OAuth request headers, scope verification, caching, and security leakage. |
| `src/lib/paypal/__tests__/paypalClient.test.ts` | 4 client-side tests verifying client parsing of all status codes and network failure resilience. |
| `docs/PHASE_3A_PAYPAL_SANDBOX_AUTH_REPORT.md` | This architectural implementation and verification report. |

### Modified Files
| File Path | Description |
| :--- | :--- |
| `.env.example` | Updated with explicit `PAYPAL_ENV=sandbox`, `PAYPAL_CLIENT_ID=`, and `PAYPAL_CLIENT_SECRET=` placeholders. |
| `src/lib/env.ts` | Added `PAYPAL_SANDBOX_BASE_URL`, strict validation enforcing `PAYPAL_ENV="sandbox"`, and `getPayPalCredentials()`. |
| `src/lib/paypal/client.ts` | Enforced strict Sandbox environment and supported `PAYPAL_CLIENT_SECRET` alongside backward-compatible aliases. |
| `src/app/settings/page.tsx` | Replaced static PayPal placeholder card with interactive `<PayPalSandboxCard />`. |

---

## 3. Existing Architecture Reused
- **Next.js 16 App Router & Server Components:** Utilized server-side route handlers (`/api/paypal/status`) and kept secret access strictly within Node.js runtime boundaries.
- **Tailwind CSS v4 & Lucide Icons:** Preserved CloseLoop's warm slate/beige/amber design aesthetic and high-density operator UI.
- **Zod 4 Runtime Validation:** Reused project-standard Zod library for strict OAuth response payload parsing.
- **Vitest Testing Framework:** Integrated seamlessly with existing Vitest configuration and mocking conventions.

---

## 4. OAuth Endpoint & Wire Protocol

- **Target Base URL:** `https://api-m.sandbox.paypal.com` (strictly locked; no production switch).
- **OAuth Token URL:** `POST https://api-m.sandbox.paypal.com/v1/oauth2/token`
- **Authentication Method:** HTTP Basic Authentication.
  - Header: `Authorization: Basic <base64(PAYPAL_CLIENT_ID:PAYPAL_CLIENT_SECRET)>`
  - Header: `Content-Type: application/x-www-form-urlencoded`
  - Header: `Accept: application/json`
  - Header: `Accept-Language: en_US`
- **Request Body:** `grant_type=client_credentials`
- **Runtime Validation Schema:**
  ```typescript
  export const paypalOAuthResponseSchema = z.object({
    scope: z.string().min(1, 'Token scope must not be empty'),
    access_token: z.string().min(1, 'Access token must not be empty'),
    token_type: z.string().min(1, 'Token type must not be empty'),
    app_id: z.string().optional(),
    expires_in: z.number().int().positive('expires_in must be a positive integer'),
    nonce: z.string().optional(),
  });
  ```

---

## 5. Required Scope & Authorization Check

CloseLoop strictly requires the Transaction Search read scope to enable downstream reconciliation data ingestion:
```
https://uri.paypal.com/services/reporting/search/read
```

### Authorization Logic:
1. When PayPal returns an OAuth token, the space-delimited `scope` field is split and parsed.
2. If `https://uri.paypal.com/services/reporting/search/read` is present:
   - `transactionSearchAuthorized = true`
   - `status = 'CONNECTED'`
3. If the token is generated successfully but lacks this specific scope:
   - `transactionSearchAuthorized = false`
   - `status = 'INSUFFICIENT_SCOPE'`
   - The system reports that the app is authenticated but lacks required reporting permissions. It **refuses** to report full connectivity success.

---

## 6. Environment Configuration

### Required Server-Only Variables
```env
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=your_sandbox_client_id_here
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret_here
```

### Enforcement Rules
1. `PAYPAL_ENV` must be strictly `sandbox`. Any attempt to set `production` or other environments throws an immediate configuration validation error.
2. Missing credentials produce clean, non-crashing status states (`NOT_CONFIGURED`) on the server.
3. The Next.js production build (`npm run build`) succeeds cleanly even when credentials are empty or unconfigured.
4. Secrets are never prefixed with `NEXT_PUBLIC_` and `.env.local` is confirmed ignored by `.gitignore`.

---

## 7. Local Sandbox Setup Instructions

1. Log in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
2. Under **REST API apps**, select or create a Sandbox application.
3. Ensure the app has the **Transaction Search** feature enabled in its Sandbox App Settings.
4. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
5. Populate `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` with the credentials from the Developer Dashboard.
6. Verify `PAYPAL_ENV=sandbox`.

---

## 8. How to Test the Connection

1. Start the development server:
   ```bash
   npm run dev
   ```
2. Navigate to `http://localhost:3000/settings`.
3. Locate the **PayPal Developer Platform (Sandbox)** card.
4. Click **Test Sandbox Connection**.
5. Observe the live status:
   - If credentials are valid and authorized: A green **Connected & Authorized** badge appears with verification of the `reporting/search/read` scope.
   - If credentials are valid but the app lacks reporting permissions: An amber **Missing Search Scope** warning appears.
   - If credentials are invalid: A rose **Authentication Failed** badge appears.
   - If credentials are not configured: A slate **Not Configured** notice appears.

---

## 9. Token Caching & Expiry Behavior

- **Storage Location:** Process-local server memory only (`CachedServerToken | null`).
- **Persistence:** Never persisted in `localStorage`, `sessionStorage`, cookies, databases, or disk.
- **Expiry Calculation:** `expiresAt = Date.now() + (expires_in * 1000)`.
- **Pre-Expiration Safety Buffer:** Tokens are refreshed if requested within 60 seconds of expiration (`DEFAULT_SAFETY_BUFFER_MS = 60_000`).
- **Single-Flight Deduplication:** Concurrent requests share a single in-flight Promise (`inflightPromise`), preventing redundant network calls to PayPal during token renewal.
- **Failure Cleanliness:** Any HTTP error, timeout, or schema failure clears the memory cache immediately, preventing stale or invalid tokens from being reused.

---

## 10. Security Controls & Secret-Handling Decisions

1. **Zero Client Leakage:**
   - The OAuth token, client secret, and Authorization headers exist exclusively in server memory.
   - The status endpoint `/api/paypal/status` returns only high-level status metadata (`provider`, `environment`, `configured`, `authenticated`, `transactionSearchAuthorized`, `status`, `message`, `checkedAt`).
   - Unit tests explicitly verify that stringified API responses contain no token fragments, secret strings, or `Basic ` headers.
2. **Network Resilience & Timeout:**
   - Uses `AbortController` with a bounded timeout (`10,000ms`).
   - Network aborts and DNS failures are caught cleanly and mapped to sanitized `TIMEOUT` or `NETWORK_ERROR` categories.
3. **No Blind Retries:**
   - Authentication failures (HTTP 401/403) are not automatically retried in loops, preventing account lockouts or spamming the PayPal API.

---

## 11. Error Handling Taxonomy

| Condition | Internal Code | HTTP Status | User-Facing Message |
| :--- | :--- | :--- | :--- |
| Unconfigured Credentials | `NOT_CONFIGURED` | 200 | "PayPal Sandbox credentials are not configured in .env.local." |
| Invalid Environment | `INVALID_ENVIRONMENT` | 500 | "CloseLoop strictly enforces PayPal Sandbox mode ('sandbox')." |
| HTTP 401 Unauthorized | `AUTHENTICATION_FAILED` | 401 | "PayPal Sandbox authentication failed. Please verify PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local." |
| HTTP 403 Forbidden | `FORBIDDEN` | 403 | "PayPal Sandbox client is forbidden from generating credentials." |
| Missing Search Scope | `INSUFFICIENT_SCOPE` | 403 | "Authenticated successfully, but the Sandbox app lacks required Transaction Search scope." |
| HTTP 5xx Server Error | `SERVICE_UNAVAILABLE` | 503 | "PayPal Sandbox OAuth service is temporarily unavailable." |
| Network Timeout | `TIMEOUT` | 504 | "PayPal Sandbox request timed out after 10000ms." |
| Malformed Response | `MALFORMED_RESPONSE` | 502 | "PayPal Sandbox OAuth response did not match expected structure." |

---

## 12. Test Suite & Exact Results

The Phase 3A test suite adds 30 new tests across 2 test files, bringing the project total to **184 passing tests across 11 suites**.

### Test Execution Command
```bash
npm test
```

### Exact Output
```text
 RUN  v5.1.0 C:/MY PROGRAMMING/closeloop

 ✓ src/lib/paypal/__tests__/paypalClient.test.ts (4 tests) 99ms
 ✓ src/lib/reconciliation/__tests__/importer.test.ts (9 tests) 18ms
 ✓ src/lib/reconciliation/__tests__/money.test.ts (30 tests) 58ms
 ✓ src/lib/reconciliation/__tests__/matcher.test.ts (15 tests) 27ms
 ✓ src/lib/reconciliation/__tests__/adversarial.test.ts (7 tests) 63ms
 ✓ src/lib/reconciliation/__tests__/final_remediations.test.ts (32 tests) 45ms
 ✓ src/lib/reconciliation/__tests__/fixtures.test.ts (5 tests) 97ms
 ✓ src/lib/paypal/__tests__/auth.test.ts (26 tests) 45ms
 ✓ src/lib/reconciliation/__tests__/workbench.test.ts (14 tests) 370ms
 ✓ src/lib/reconciliation/__tests__/phase2a_final_audit.test.ts (13 tests) 56ms
 ✓ src/lib/reconciliation/__tests__/regression.test.ts (29 tests) 59ms

 Test Files  11 passed (11)
      Tests  184 passed (184)
   Duration  1.21s
```

### Key Scenarios Verified in `auth.test.ts`
1. Correct Sandbox OAuth URL targeting (`https://api-m.sandbox.paypal.com/v1/oauth2/token`).
2. Correct Basic authentication construction with base64 encoding without leaking the plain secret.
3. Form-encoded `grant_type=client_credentials` POST body.
4. Parsing and extraction of token, token_type, expires_in, and app_id.
5. Missing client ID handling (`NOT_CONFIGURED`).
6. Missing client secret handling (`NOT_CONFIGURED`).
7. Invalid environment rejection (`PAYPAL_ENV !== 'sandbox'`).
8. HTTP 401 sanitized error handling.
9. HTTP 403 sanitized error handling.
10. HTTP 5xx sanitized service unavailable handling.
11. Network failure handling (`TypeError`).
12. Bounded timeout handling via `AbortError`.
13. Invalid non-JSON payload handling.
14. Runtime schema validation failure on unexpected structure.
15. Missing `access_token` validation failure.
16. Missing Transaction Search scope detection (`INSUFFICIENT_SCOPE`).
17. Successful required-scope detection (`CONNECTED`).
18. In-memory token cache reuse before expiry.
19. Token refresh when within the 60-second safety buffer.
20. Single-flight request deduplication for concurrent calls.
21. Cache clearing on failed requests.
22. Status API zero-leakage verification (no token, secret, or Authorization header in JSON).
23. Status API HTTP 200 response when unconfigured.
24. Status API HTTP 401 response on authentication failure.
25. Status API HTTP 403 response on missing scope.
26. Whitespace-delimited scope parser verification.

---

## 13. Quality Gates Verification

### 1. ESLint (`npm run lint`)
```bash
> closeloop@0.1.0 lint
> eslint
```
**Result:** 0 errors, 0 warnings. (Exit code 0).

### 2. TypeScript (`npx tsc --noEmit`)
```bash
> npx tsc --noEmit
```
**Result:** Clean type check. (Exit code 0).

### 3. Production Build (`npm run build`)
```bash
▲ Next.js 16.4.5 (Turbopack)
✓ Compiled successfully in 22.3s
  Running TypeScript ...
  Finished TypeScript in 8.2s ...
  Generating static pages using 17 workers (19/19) in 1175ms

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /api/ai
├ ○ /api/approvals
├ ƒ /api/health
├ ○ /api/paypal
├ ƒ /api/paypal/status
├ ƒ /api/reconciliation
├ ƒ /api/reconciliation/preview
├ ƒ /api/reconciliation/review
├ ○ /api/reconciliation/sample
├ ○ /approvals
├ ○ /audit
├ ○ /copilot
├ ○ /exceptions
├ ○ /reconciliation
└ ○ /settings
```
**Result:** All 19 routes compiled successfully. (Exit code 0). Build succeeds without requiring local credentials.

---

## 14. Phase 2A Immutability Evidence

All protected modules from Phase 2A and Phase 2B were completely preserved:
- `src/lib/reconciliation/matcher/**` — **UNMODIFIED**
- `src/lib/reconciliation/importer/**` — **UNMODIFIED**
- `src/lib/reconciliation/fixtures/**` — **UNMODIFIED**
- `src/lib/reconciliation/money.ts` — **UNMODIFIED**
- `src/types/financial.ts` — **UNMODIFIED**
- `src/lib/validation/schemas.ts` — **UNMODIFIED**
- All 9 Phase 2A/2B test suites (154 tests) — **UNMODIFIED & 100% PASSING**

---

## 15. Known Limitations & Audit Verification State

1. **Process-Local Cache:**
   The OAuth token cache is stored in server process memory. If the Node.js server process restarts or scales to multiple instances, each instance will independently authenticate with PayPal Sandbox on its first request. This is standard for serverless and containerized deployments.
2. **Read-Only Verification:**
   Phase 3A only confirms OAuth authentication and read permissions. It does not ingest transactions or test rate limits.
3. **Live Handshake Verification Status:**
   Marked **UNVERIFIED** (Mocked in unit tests). Live network handshakes against `api-m.sandbox.paypal.com` require local developer credentials in `.env.local`, which are not tracked in version control.
4. **Targeted Syntax Remediation:**
   An independent audit identified trailing orphaned closing tags on lines 128–130 in `src/app/settings/page.tsx` following component integration. This was cleanly removed in a targeted 3-line remediation, restoring 100% clean passes for `npm run lint`, `npx tsc --noEmit`, and `npm run build`.


---

## 16. Explicit Architectural Principle

> **Crucial Principle:** CloseLoop never confuses successful authentication with successful financial reconciliation.  
> A verified Sandbox OAuth connection proves only that the application can authenticate and possesses the required read permission. It does not prove that transaction data is available, complete, current, or correctly reconciled.

This distinction is explicitly documented in the system UI and encoded in the state machine.

