import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getValidOAuthToken,
  verifyPayPalConnection,
  clearTokenCache,
  containsTransactionSearchScope,
  PAYPAL_OAUTH_TOKEN_URL,
  REQUIRED_TRANSACTION_SEARCH_SCOPE,
  PayPalAuthError,
} from '@/lib/paypal/auth';
import { GET as getStatusRoute } from '@/app/api/paypal/status/route';
import { getEnv, resetEnvCacheForTesting } from '@/lib/env';

describe('Phase 3A: PayPal Sandbox OAuth Authentication & Connectivity Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearTokenCache();
    resetEnvCacheForTesting();
    process.env = { ...originalEnv };
    process.env.PAYPAL_ENV = 'sandbox';
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: OAuth Request Construction & Wire Protocol
  // =========================================================================
  describe('Suite 1: OAuth Request Construction & Wire Protocol', () => {
    it('1. Correct Sandbox OAuth URL is targeted', async () => {
      expect(PAYPAL_OAUTH_TOKEN_URL).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    });

    it('2. Correct Basic authentication construction without leaking secrets', async () => {
      let capturedHeaders: HeadersInit | undefined;
      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedHeaders = init.headers;
        return new Response(
          JSON.stringify({
            scope: `https://uri.paypal.com/services/invoicing ${REQUIRED_TRANSACTION_SEARCH_SCOPE}`,
            access_token: 'A21AA_TEST_TOKEN',
            token_type: 'Bearer',
            app_id: 'APP-TEST-SANDBOX',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await getValidOAuthToken({
        clientId: 'my-client-id',
        clientSecret: 'my-secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const headers = capturedHeaders as Record<string, string>;
      const expectedBasic = Buffer.from('my-client-id:my-secret').toString('base64');
      expect(headers['Authorization']).toBe(`Basic ${expectedBasic}`);
      // Confirm raw secret is not plain in the header string
      expect(headers['Authorization']).not.toContain('my-secret');
    });

    it('3. Correct form-encoded grant_type=client_credentials request body', async () => {
      let capturedBody: BodyInit | null | undefined;
      let capturedContentType: string | undefined;

      const mockFetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        capturedBody = init.body;
        capturedContentType = (init.headers as Record<string, string>)['Content-Type'];
        return new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: 'A21AA_TEST_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200 }
        );
      });

      await getValidOAuthToken({
        clientId: 'client-1',
        clientSecret: 'secret-1',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(capturedContentType).toBe('application/x-www-form-urlencoded');
      expect(capturedBody).toBe('grant_type=client_credentials');
    });

    it('4. Successful token response parsing extracts valid metadata', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: `https://uri.paypal.com/services/invoicing ${REQUIRED_TRANSACTION_SEARCH_SCOPE}`,
            access_token: 'A21AA_TEST_TOKEN_123',
            token_type: 'Bearer',
            app_id: 'APP-80W284485P519543T',
            expires_in: 32400,
          }),
          { status: 200 }
        )
      );

      const token = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(token.accessToken).toBe('A21AA_TEST_TOKEN_123');
      expect(token.tokenType).toBe('Bearer');
      expect(token.appId).toBe('APP-80W284485P519543T');
      expect(token.hasTransactionSearchScope).toBe(true);
      expect(token.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  // =========================================================================
  // SUITE 2: Configuration & Environment Integrity
  // =========================================================================
  describe('Suite 2: Configuration & Environment Integrity', () => {
    it('5. Missing client ID throws safe NOT_CONFIGURED error', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      resetEnvCacheForTesting();

      await expect(
        getValidOAuthToken({ clientId: '' })
      ).rejects.toThrowError(/PAYPAL_CLIENT_ID is not configured/);
    });

    it('6. Missing client secret throws safe NOT_CONFIGURED error', async () => {
      delete process.env.PAYPAL_CLIENT_SECRET;
      delete process.env.PAYPAL_SECRET;
      resetEnvCacheForTesting();

      await expect(
        getValidOAuthToken({ clientSecret: '' })
      ).rejects.toThrowError(/PAYPAL_CLIENT_SECRET is not configured/);
    });

    it('7. Invalid environment value (non-sandbox) throws an explicit configuration error', async () => {
      process.env.PAYPAL_ENV = 'production';
      resetEnvCacheForTesting();

      expect(() => {
        getEnv();
      }).toThrowError(/strictly enforces PayPal Sandbox mode/);
    });
  });

  // =========================================================================
  // SUITE 3: HTTP Resilience & Error Handling
  // =========================================================================
  describe('Suite 3: HTTP Resilience & Error Handling', () => {
    it('8. HTTP 401 returns sanitized AUTHENTICATION_FAILED without leaking secrets', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: 'Client Authentication failed',
          }),
          { status: 401 }
        )
      );

      await expect(
        getValidOAuthToken({
          clientId: 'bad-client',
          clientSecret: 'bad-secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/authentication failed/i);
    });

    it('9. HTTP 403 returns FORBIDDEN sanitized error', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'access_denied', error_description: 'Forbidden' }),
          { status: 403 }
        )
      );

      await expect(
        getValidOAuthToken({
          clientId: 'forbidden-client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/forbidden from generating credentials/i);
    });

    it('10. PayPal HTTP 5xx returns SERVICE_UNAVAILABLE', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', { status: 500 })
      );

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/temporarily unavailable/i);
    });

    it('11. Network failure produces NETWORK_ERROR', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'));

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/Network failure/i);
    });

    it('12. Request timeout throws TIMEOUT error with AbortError', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      const mockFetch = vi.fn().mockRejectedValue(abortError);

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          timeoutMs: 100,
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/timed out/i);
    });

    it('13. Invalid non-JSON response produces MALFORMED_RESPONSE', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('<html><body>Cloudflare Bad Gateway</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      );

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/unparseable response/i);
    });

    it('14. Malformed token response structure fails runtime schema validation', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            something_else: 'value',
          }),
          { status: 200 }
        )
      );

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/did not match expected structure/i);
    });

    it('15. Missing access_token in response fails validation', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            token_type: 'Bearer',
            expires_in: 3600,
            // access_token missing!
          }),
          { status: 200 }
        )
      );

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/did not match expected structure/i);
    });
  });

  // =========================================================================
  // SUITE 4: Scope Validation & Authorization
  // =========================================================================
  describe('Suite 4: Scope Validation & Authorization', () => {
    it('16. Missing Transaction Search scope correctly reports insufficient scope', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: 'https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/payments/realtimepayment',
            access_token: 'LIMITED_SCOPE_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      const result = await verifyPayPalConnection({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.configured).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.transactionSearchAuthorized).toBe(false);
      expect(result.status).toBe('INSUFFICIENT_SCOPE');
      expect(result.message).toContain('lacks required Transaction Search scope');
    });

    it('17. Successful required-scope detection verifies full CONNECTED status', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: `https://uri.paypal.com/services/invoicing ${REQUIRED_TRANSACTION_SEARCH_SCOPE}`,
            access_token: 'FULL_SCOPE_TOKEN',
            token_type: 'Bearer',
            app_id: 'APP-123',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      const result = await verifyPayPalConnection({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(result.configured).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(result.transactionSearchAuthorized).toBe(true);
      expect(result.status).toBe('CONNECTED');
      expect(result.appId).toBe('APP-123');
    });

    it('Helper containsTransactionSearchScope correctly parses whitespace-delimited scopes', () => {
      expect(containsTransactionSearchScope('')).toBe(false);
      expect(containsTransactionSearchScope('scope1 scope2')).toBe(false);
      expect(
        containsTransactionSearchScope(
          `scope1   ${REQUIRED_TRANSACTION_SEARCH_SCOPE}   scope3`
        )
      ).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 5: Process-Local Token Caching & Concurrency
  // =========================================================================
  describe('Suite 5: Process-Local Token Caching & Concurrency', () => {
    it('18. Token cache reuses valid token before expiry without triggering new network request', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: 'CACHED_TOKEN_1',
            token_type: 'Bearer',
            expires_in: 3600, // 1 hour
          }),
          { status: 200 }
        )
      );

      const token1 = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const token2 = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(token1.accessToken).toBe('CACHED_TOKEN_1');
      expect(token2.accessToken).toBe('CACHED_TOKEN_1');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('19. Token refreshes when within safety buffer or expired', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: `TOKEN_REFRESH_${callCount}`,
            token_type: 'Bearer',
            expires_in: 30, // 30 seconds
          }),
          { status: 200 }
        );
      });

      // Safety buffer is 60s, so a 30s token is immediately within safety buffer!
      const token1 = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        safetyBufferMs: 60_000,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const token2 = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        safetyBufferMs: 60_000,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(token1.accessToken).toBe('TOKEN_REFRESH_1');
      expect(token2.accessToken).toBe('TOKEN_REFRESH_2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('20. Concurrent calls share one in-flight token request (single-flight deduplication)', async () => {
      let resolveCall: (val: Response) => void;
      const deferredPromise = new Promise<Response>((resolve) => {
        resolveCall = resolve;
      });

      const mockFetch = vi.fn().mockReturnValue(deferredPromise);

      const call1 = getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const call2 = getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });
      const call3 = getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      // Resolve the single network call
      resolveCall!(
        new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: 'SINGLE_FLIGHT_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      const [res1, res2, res3] = await Promise.all([call1, call2, call3]);
      expect(res1.accessToken).toBe('SINGLE_FLIGHT_TOKEN');
      expect(res2.accessToken).toBe('SINGLE_FLIGHT_TOKEN');
      expect(res3.accessToken).toBe('SINGLE_FLIGHT_TOKEN');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('21. Failed token request is not cached; subsequent request retries cleanly', async () => {
      let attempt = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        attempt++;
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: 'RECOVERED_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200 }
        );
      });

      await expect(
        getValidOAuthToken({
          clientId: 'client',
          clientSecret: 'secret',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(PayPalAuthError);

      const recovered = await getValidOAuthToken({
        clientId: 'client',
        clientSecret: 'secret',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(recovered.accessToken).toBe('RECOVERED_TOKEN');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // SUITE 6: Status API Endpoint Security & Data Leakage Prevention
  // =========================================================================
  describe('Suite 6: Status API Endpoint Security & Data Leakage Prevention', () => {
    it('22. Status API never exposes token, client secret, or authorization header', async () => {
      // Mock global fetch for route test
      const originalGlobalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
            access_token: 'SECRET_ACCESS_TOKEN_DO_NOT_LEAK',
            token_type: 'Bearer',
            app_id: 'APP-SECRET-APP',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      try {
        const response = await getStatusRoute();
        const json = await response.json();
        const stringified = JSON.stringify(json);

        expect(response.status).toBe(200);
        expect(json.status).toBe('CONNECTED');
        expect(json.authenticated).toBe(true);
        expect(json.transactionSearchAuthorized).toBe(true);

        // Security assertions: absolutely no credential leakage
        expect(stringified).not.toContain('SECRET_ACCESS_TOKEN_DO_NOT_LEAK');
        expect(stringified).not.toContain('test-client-secret');
        expect(stringified).not.toContain('Basic ');
        expect(json.access_token).toBeUndefined();
        expect(json.client_secret).toBeUndefined();
        expect(json.clientSecret).toBeUndefined();
      } finally {
        global.fetch = originalGlobalFetch;
      }
    });

    it('23. Status API returns HTTP 200 with NOT_CONFIGURED when credentials missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
      delete process.env.PAYPAL_SECRET;
      resetEnvCacheForTesting();

      const response = await getStatusRoute();
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(json.status).toBe('NOT_CONFIGURED');
      expect(json.configured).toBe(false);
      expect(json.authenticated).toBe(false);
      expect(json.transactionSearchAuthorized).toBe(false);
    });

    it('24. Status API returns HTTP 401 when authentication fails', async () => {
      const originalGlobalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })
      );

      try {
        const response = await getStatusRoute();
        const json = await response.json();

        expect(response.status).toBe(401);
        expect(json.status).toBe('AUTHENTICATION_FAILED');
        expect(json.authenticated).toBe(false);
      } finally {
        global.fetch = originalGlobalFetch;
      }
    });

    it('25. Status API returns HTTP 403 when Transaction Search scope is missing', async () => {
      const originalGlobalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            scope: 'https://uri.paypal.com/services/invoicing',
            access_token: 'LIMITED_TOKEN',
            token_type: 'Bearer',
            expires_in: 3600,
          }),
          { status: 200 }
        )
      );

      try {
        const response = await getStatusRoute();
        const json = await response.json();

        expect(response.status).toBe(403);
        expect(json.status).toBe('INSUFFICIENT_SCOPE');
        expect(json.authenticated).toBe(true);
        expect(json.transactionSearchAuthorized).toBe(false);
      } finally {
        global.fetch = originalGlobalFetch;
      }
    });
  });
});
