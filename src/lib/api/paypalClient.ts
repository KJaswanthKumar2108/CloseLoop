import { PayPalConnectionStatusResult } from '@/lib/paypal/auth';
import type { TransactionSearchPreviewResult } from '@/lib/paypal/transactionSearch';

/**
 * Fetches PayPal Sandbox connectivity status from the CloseLoop server status endpoint.
 *
 * This function calls CloseLoop's server endpoint (/api/paypal/status).
 * It never calls PayPal APIs directly from the browser.
 */
export async function fetchPayPalStatus(): Promise<PayPalConnectionStatusResult> {
  try {
    const response = await fetch('/api/paypal/status', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const data = await response.json();
    return data as PayPalConnectionStatusResult;
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : 'Network error communicating with CloseLoop server.';
    return {
      provider: 'PayPal',
      environment: 'sandbox',
      configured: false,
      authenticated: false,
      transactionSearchAuthorized: false,
      status: 'SERVICE_UNAVAILABLE',
      message: `Failed to contact CloseLoop server: ${message}`,
      checkedAt: new Date().toISOString(),
    };
  }
}

export interface FetchTransactionsClientParams {
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
  maxPages?: number;
}

/**
 * Calls CloseLoop's server preview endpoint (/api/paypal/transactions).
 * Never communicates with PayPal directly from the browser.
 */
export async function fetchPayPalTransactionPreview(
  params: FetchTransactionsClientParams
): Promise<TransactionSearchPreviewResult> {
  const url = new URL('/api/paypal/transactions', window.location.origin);
  url.searchParams.set('startDate', params.startDate);
  url.searchParams.set('endDate', params.endDate);
  if (params.page) url.searchParams.set('page', String(params.page));
  if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
  if (params.maxPages) url.searchParams.set('maxPages', String(params.maxPages));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.message || data.error || `HTTP ${response.status} transaction preview error`
    );
  }

  return data as TransactionSearchPreviewResult;
}


