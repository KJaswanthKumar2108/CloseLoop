import { z } from 'zod';
import { getEnv, PAYPAL_SANDBOX_BASE_URL } from '@/lib/env';

/**
 * PayPal Sandbox OAuth2 Token URL.
 * Locked strictly to Sandbox.
 */
export const PAYPAL_OAUTH_TOKEN_URL = `${PAYPAL_SANDBOX_BASE_URL}/v1/oauth2/token` as const;

/**
 * Required PayPal read scope for transaction reconciliation ingestion.
 */
export const REQUIRED_TRANSACTION_SEARCH_SCOPE =
  'https://uri.paypal.com/services/reporting/search/read' as const;

/**
 * Default network request timeout in milliseconds.
 */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Default safety buffer before token expiration in milliseconds (60 seconds).
 */
export const DEFAULT_SAFETY_BUFFER_MS = 60_000;

/**
 * Schema for strict runtime validation of PayPal's OAuth2 token response.
 */
export const paypalOAuthResponseSchema = z.object({
  scope: z.string().min(1, 'Token scope must not be empty'),
  access_token: z.string().min(1, 'Access token must not be empty'),
  token_type: z.string().min(1, 'Token type must not be empty'),
  app_id: z.string().optional(),
  expires_in: z.number().int().positive('expires_in must be a positive integer'),
  nonce: z.string().optional(),
});

export type PayPalOAuthResponse = z.infer<typeof paypalOAuthResponseSchema>;

/**
 * Process-local token representation.
 * Kept exclusively in server memory; never returned to the browser.
 */
export interface CachedServerToken {
  accessToken: string;
  tokenType: string;
  scope: string;
  scopes: string[];
  hasTransactionSearchScope: boolean;
  appId?: string;
  expiresAt: number; // Unix epoch ms
  issuedAt: number;  // Unix epoch ms
}

/**
 * Standardized, sanitized error categories for PayPal OAuth operations.
 */
export type PayPalAuthErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_ENVIRONMENT'
  | 'AUTHENTICATION_FAILED'
  | 'FORBIDDEN'
  | 'INSUFFICIENT_SCOPE'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'MALFORMED_RESPONSE'
  | 'UNKNOWN_ERROR';

/**
 * Sanitized error class for PayPal OAuth operations.
 * Explicitly excludes raw PayPal payload secrets and authorization headers.
 */
export class PayPalAuthError extends Error {
  readonly code: PayPalAuthErrorCode;
  readonly httpStatus: number;

  constructor(code: PayPalAuthErrorCode, message: string, httpStatus = 500) {
    super(message);
    this.name = 'PayPalAuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Possible status strings returned by the connectivity check.
 */
export type PayPalConnectivityStatus =
  | 'CONNECTED'
  | 'NOT_CONFIGURED'
  | 'AUTHENTICATION_FAILED'
  | 'INSUFFICIENT_SCOPE'
  | 'SERVICE_UNAVAILABLE';

/**
 * Public connectivity check result returned to the operator workbench / API.
 * Never includes tokens, secrets, or authorization headers.
 */
export interface PayPalConnectionStatusResult {
  provider: 'PayPal';
  environment: 'sandbox';
  configured: boolean;
  authenticated: boolean;
  transactionSearchAuthorized: boolean;
  status: PayPalConnectivityStatus;
  message: string;
  checkedAt: string;
  appId?: string;
}

// ============================================================================
// Process-Local Memory Cache & In-Flight Promise Management
// ============================================================================

let memoryTokenCache: CachedServerToken | null = null;
let inflightPromise: Promise<CachedServerToken> | null = null;

/**
 * Resets process-local token cache. Used for testing and on critical auth failure.
 */
export function clearTokenCache(): void {
  memoryTokenCache = null;
  inflightPromise = null;
}

/**
 * Checks whether a given scope string contains the required Transaction Search scope.
 */
export function containsTransactionSearchScope(scopeString: string): boolean {
  if (!scopeString) return false;
  const scopes = scopeString.split(/\s+/).filter(Boolean);
  return scopes.includes(REQUIRED_TRANSACTION_SEARCH_SCOPE);
}

/**
 * Options for requesting an OAuth token.
 */
export interface RequestTokenOptions {
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  safetyBufferMs?: number;
  forceRefresh?: boolean;
  fetchFn?: typeof fetch;
}

/**
 * Internal worker that executes the raw OAuth HTTP POST request against PayPal Sandbox.
 */
async function fetchOAuthTokenFromPayPal(
  clientId: string,
  clientSecret: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch
): Promise<CachedServerToken> {
  // Construct Basic Auth header safely
  const credentials = `${clientId}:${clientSecret}`;
  const base64Credentials = Buffer.from(credentials).toString('base64');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(PAYPAL_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${base64Credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'Accept-Language': 'en_US',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }).toString(),
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PayPalAuthError(
        'TIMEOUT',
        `PayPal Sandbox request timed out after ${timeoutMs}ms.`,
        504
      );
    }
    throw new PayPalAuthError(
      'NETWORK_ERROR',
      'Network failure when contacting PayPal Sandbox OAuth service.',
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP status errors with sanitized messages
  if (!response.ok) {
    if (response.status === 401) {
      throw new PayPalAuthError(
        'AUTHENTICATION_FAILED',
        'PayPal Sandbox authentication failed. Please verify PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.',
        401
      );
    }

    if (response.status === 403) {
      throw new PayPalAuthError(
        'FORBIDDEN',
        'PayPal Sandbox client is forbidden from generating credentials.',
        403
      );
    }

    if (response.status >= 500) {
      throw new PayPalAuthError(
        'SERVICE_UNAVAILABLE',
        'PayPal Sandbox OAuth service is temporarily unavailable.',
        503
      );
    }

    throw new PayPalAuthError(
      'SERVICE_UNAVAILABLE',
      `PayPal Sandbox rejected OAuth token request with HTTP ${response.status}.`,
      response.status
    );
  }

  // Parse JSON response body safely
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch {
    throw new PayPalAuthError(
      'MALFORMED_RESPONSE',
      'PayPal Sandbox returned an unparseable response body.',
      502
    );
  }

  // Validate response schema
  const parsed = paypalOAuthResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new PayPalAuthError(
      'MALFORMED_RESPONSE',
      'PayPal Sandbox OAuth response did not match expected structure.',
      502
    );
  }

  const data = parsed.data;
  const now = Date.now();
  const expiresAt = now + data.expires_in * 1000;
  const scopesList = data.scope.split(/\s+/).filter(Boolean);
  const hasSearchScope = scopesList.includes(REQUIRED_TRANSACTION_SEARCH_SCOPE);

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    scope: data.scope,
    scopes: scopesList,
    hasTransactionSearchScope: hasSearchScope,
    appId: data.app_id,
    expiresAt,
    issuedAt: now,
  };
}

/**
 * Retrieves a valid server-side OAuth token for PayPal Sandbox operations.
 * Utilizes in-memory caching and single-flight request deduplication.
 * NEVER return the resulting token to the client browser.
 */
export async function getValidOAuthToken(
  options: RequestTokenOptions = {}
): Promise<CachedServerToken> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    safetyBufferMs = DEFAULT_SAFETY_BUFFER_MS,
    forceRefresh = false,
    fetchFn = fetch,
  } = options;

  // Resolve credentials
  const env = getEnv();
  const clientId = options.clientId || env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret =
    options.clientSecret ||
    env.PAYPAL_CLIENT_SECRET?.trim() ||
    env.PAYPAL_SECRET?.trim();

  if (!clientId) {
    throw new PayPalAuthError(
      'NOT_CONFIGURED',
      'PAYPAL_CLIENT_ID is not configured in .env.local.',
      400
    );
  }

  if (!clientSecret) {
    throw new PayPalAuthError(
      'NOT_CONFIGURED',
      'PAYPAL_CLIENT_SECRET is not configured in .env.local.',
      400
    );
  }

  // Check in-memory cache if not forced refresh
  const now = Date.now();
  if (
    !forceRefresh &&
    memoryTokenCache &&
    now < memoryTokenCache.expiresAt - safetyBufferMs
  ) {
    return memoryTokenCache;
  }

  // Deduplicate concurrent calls via single-flight promise
  if (inflightPromise) {
    return inflightPromise;
  }

  inflightPromise = fetchOAuthTokenFromPayPal(
    clientId,
    clientSecret,
    timeoutMs,
    fetchFn
  )
    .then((token) => {
      memoryTokenCache = token;
      return token;
    })
    .catch((err) => {
      // Clear token cache on authentication or critical failure
      memoryTokenCache = null;
      throw err;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}

/**
 * Executes a full PayPal Sandbox connectivity check and verifies Transaction Search permission.
 * Safe to expose to the API status endpoint; never reveals tokens or secrets.
 */
export async function verifyPayPalConnection(
  options: RequestTokenOptions = {}
): Promise<PayPalConnectionStatusResult> {
  const checkedAt = new Date().toISOString();
  const env = getEnv();
  const clientId = options.clientId || env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret =
    options.clientSecret ||
    env.PAYPAL_CLIENT_SECRET?.trim() ||
    env.PAYPAL_SECRET?.trim();

  // 1. Check if configured
  if (!clientId || !clientSecret) {
    return {
      provider: 'PayPal',
      environment: 'sandbox',
      configured: false,
      authenticated: false,
      transactionSearchAuthorized: false,
      status: 'NOT_CONFIGURED',
      message: 'PayPal Sandbox credentials are not configured in .env.local.',
      checkedAt,
    };
  }

  // 2. Attempt authentication & scope check
  try {
    const token = await getValidOAuthToken(options);

    if (!token.hasTransactionSearchScope) {
      return {
        provider: 'PayPal',
        environment: 'sandbox',
        configured: true,
        authenticated: true,
        transactionSearchAuthorized: false,
        status: 'INSUFFICIENT_SCOPE',
        message:
          'Authenticated successfully, but the Sandbox app lacks required Transaction Search scope (https://uri.paypal.com/services/reporting/search/read).',
        checkedAt,
        appId: token.appId,
      };
    }

    return {
      provider: 'PayPal',
      environment: 'sandbox',
      configured: true,
      authenticated: true,
      transactionSearchAuthorized: true,
      status: 'CONNECTED',
      message: 'Connected to PayPal Sandbox with Transaction Search read permission verified.',
      checkedAt,
      appId: token.appId,
    };
  } catch (err: unknown) {
    if (err instanceof PayPalAuthError) {
      if (err.code === 'AUTHENTICATION_FAILED') {
        return {
          provider: 'PayPal',
          environment: 'sandbox',
          configured: true,
          authenticated: false,
          transactionSearchAuthorized: false,
          status: 'AUTHENTICATION_FAILED',
          message: err.message,
          checkedAt,
        };
      }

      if (err.code === 'INSUFFICIENT_SCOPE') {
        return {
          provider: 'PayPal',
          environment: 'sandbox',
          configured: true,
          authenticated: true,
          transactionSearchAuthorized: false,
          status: 'INSUFFICIENT_SCOPE',
          message: err.message,
          checkedAt,
        };
      }

      return {
        provider: 'PayPal',
        environment: 'sandbox',
        configured: true,
        authenticated: false,
        transactionSearchAuthorized: false,
        status: 'SERVICE_UNAVAILABLE',
        message: err.message,
        checkedAt,
      };
    }

    return {
      provider: 'PayPal',
      environment: 'sandbox',
      configured: true,
      authenticated: false,
      transactionSearchAuthorized: false,
      status: 'SERVICE_UNAVAILABLE',
      message: 'Unexpected error connecting to PayPal Sandbox service.',
      checkedAt,
    };
  }
}

