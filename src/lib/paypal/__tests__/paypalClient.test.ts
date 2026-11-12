import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPayPalStatus } from '@/lib/api/paypalClient';

describe('Phase 3A: PayPal Client API Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. fetchPayPalStatus successfully parses CONNECTED response from /api/paypal/status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'PayPal',
          environment: 'sandbox',
          configured: true,
          authenticated: true,
          transactionSearchAuthorized: true,
          status: 'CONNECTED',
          message: 'Connected to PayPal Sandbox with Transaction Search read permission verified.',
          checkedAt: '2026-11-08T18:00:00.000Z',
        }),
        { status: 200 }
      )
    );

    const result = await fetchPayPalStatus();

    expect(result.status).toBe('CONNECTED');
    expect(result.authenticated).toBe(true);
    expect(result.transactionSearchAuthorized).toBe(true);
    expect(result.configured).toBe(true);
  });

  it('2. fetchPayPalStatus parses 401 AUTHENTICATION_FAILED response cleanly', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'PayPal',
          environment: 'sandbox',
          configured: true,
          authenticated: false,
          transactionSearchAuthorized: false,
          status: 'AUTHENTICATION_FAILED',
          message: 'PayPal Sandbox authentication failed.',
          checkedAt: '2026-11-08T18:00:00.000Z',
        }),
        { status: 401 }
      )
    );

    const result = await fetchPayPalStatus();

    expect(result.status).toBe('AUTHENTICATION_FAILED');
    expect(result.authenticated).toBe(false);
    expect(result.configured).toBe(true);
  });

  it('3. fetchPayPalStatus parses 403 INSUFFICIENT_SCOPE response cleanly', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          provider: 'PayPal',
          environment: 'sandbox',
          configured: true,
          authenticated: true,
          transactionSearchAuthorized: false,
          status: 'INSUFFICIENT_SCOPE',
          message: 'Lacks required Transaction Search scope.',
          checkedAt: '2026-11-08T18:00:00.000Z',
        }),
        { status: 403 }
      )
    );

    const result = await fetchPayPalStatus();

    expect(result.status).toBe('INSUFFICIENT_SCOPE');
    expect(result.authenticated).toBe(true);
    expect(result.transactionSearchAuthorized).toBe(false);
  });

  it('4. fetchPayPalStatus handles client-side fetch network exception safely without throwing', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Browser offline'));

    const result = await fetchPayPalStatus();

    expect(result.status).toBe('SERVICE_UNAVAILABLE');
    expect(result.authenticated).toBe(false);
    expect(result.message).toContain('Browser offline');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });
});

