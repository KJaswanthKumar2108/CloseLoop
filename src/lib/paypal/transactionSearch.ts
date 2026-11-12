import { getValidOAuthToken, PayPalAuthError } from '@/lib/paypal/auth';
import { PAYPAL_SANDBOX_BASE_URL } from '@/lib/env';
import {
  paypalTransactionSearchResponseSchema,
  PayPalTransactionDetail,
  PayPalTransactionSearchResponse,
} from './transactionSchemas';
import {
  normalizePayPalBatch,
} from './normalizer';
import { PaymentTransaction } from '@/types/financial';

/**
 * PayPal Sandbox Transaction Search Endpoint
 */
export const PAYPAL_TRANSACTION_SEARCH_URL =
  `${PAYPAL_SANDBOX_BASE_URL}/v1/reporting/transactions` as const;

/**
 * Default and maximum configuration limits.
 */
export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 500;
export const DEFAULT_MAX_PAGES = 5;
export const ABSOLUTE_MAX_PAGES = 10;
export const MAX_DATE_RANGE_DAYS = 31;
export const MAX_DATE_RANGE_MS = MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_SEARCH_TIMEOUT_MS = 15_000;

export const PAYPAL_REPORTING_LAG_NOTICE =
  'PayPal reporting advisory: Executed transactions may take up to 3 hours to appear in Transaction Search reporting. An empty query result does not prove that no transaction occurred.';

/**
 * Strict RFC 3339 regex: requires year-month-day, hours:minutes:seconds, and explicit timezone (Z or offset).
 */
export const RFC_3339_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Query parameters for PayPal Transaction Search.
 */
export interface TransactionSearchQueryParams {
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * Sanitized Error Class for Transaction Search operations.
 */
export class TransactionSearchError extends Error {
  readonly code:
    | 'INVALID_PARAMETERS'
    | 'AUTHENTICATION_FAILED'
    | 'INSUFFICIENT_SCOPE'
    | 'RATE_LIMITED'
    | 'SERVICE_UNAVAILABLE'
    | 'NETWORK_ERROR'
    | 'TIMEOUT'
    | 'PARSE_ERROR';
  readonly httpStatus: number;

  constructor(
    code: TransactionSearchError['code'],
    message: string,
    httpStatus = 500
  ) {
    super(message);
    this.name = 'TransactionSearchError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/**
 * Validates search query parameters against PayPal constraints.
 */
export function validateSearchQueryParams(params: {
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  maxPages?: number;
}): {
  startDate: string;
  endDate: string;
  page: number;
  pageSize: number;
  maxPages: number;
} {
  const { startDate, endDate, page = 1, pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES } = params;

  if (!startDate || typeof startDate !== 'string') {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      'Missing required query parameter "startDate". Must be an RFC 3339 timestamp.',
      400
    );
  }

  if (!endDate || typeof endDate !== 'string') {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      'Missing required query parameter "endDate". Must be an RFC 3339 timestamp.',
      400
    );
  }

  if (!RFC_3339_REGEX.test(startDate.trim())) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `startDate "${startDate}" is not a valid RFC 3339 timestamp (e.g. 2026-11-01T00:00:00Z).`,
      400
    );
  }

  if (!RFC_3339_REGEX.test(endDate.trim())) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `endDate "${endDate}" is not a valid RFC 3339 timestamp (e.g. 2026-11-09T23:59:59Z).`,
      400
    );
  }

  const startMillis = Date.parse(startDate.trim());
  const endMillis = Date.parse(endDate.trim());

  if (isNaN(startMillis)) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `startDate "${startDate}" could not be parsed into a calendar timestamp.`,
      400
    );
  }

  if (isNaN(endMillis)) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `endDate "${endDate}" could not be parsed into a calendar timestamp.`,
      400
    );
  }

  if (startMillis > endMillis) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `startDate (${startDate}) cannot be after endDate (${endDate}).`,
      400
    );
  }

  const durationMs = endMillis - startMillis;
  if (durationMs > MAX_DATE_RANGE_MS) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `Date range spans ${Math.ceil(durationMs / (1000 * 60 * 60 * 24))} days. PayPal restricts Transaction Search to a maximum of ${MAX_DATE_RANGE_DAYS} days.`,
      400
    );
  }

  if (page < 1 || !Number.isInteger(page)) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `page must be an integer >= 1. Received: ${page}.`,
      400
    );
  }

  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE || !Number.isInteger(pageSize)) {
    throw new TransactionSearchError(
      'INVALID_PARAMETERS',
      `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}. Received: ${pageSize}.`,
      400
    );
  }

  const safeMaxPages = Math.min(Math.max(1, maxPages), ABSOLUTE_MAX_PAGES);

  return {
    startDate: startDate.trim(),
    endDate: endDate.trim(),
    page,
    pageSize,
    maxPages: safeMaxPages,
  };
}

/**
 * Executes a single HTTP GET page request against PayPal Transaction Search API.
 */
async function fetchSinglePage(
  accessToken: string,
  startDate: string,
  endDate: string,
  page: number,
  pageSize: number,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch
): Promise<PayPalTransactionSearchResponse> {
  const url = new URL(PAYPAL_TRANSACTION_SEARCH_URL);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('fields', 'all');
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('page', String(page));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new TransactionSearchError(
        'TIMEOUT',
        `PayPal Transaction Search timed out after ${timeoutMs}ms.`,
        504
      );
    }
    throw new TransactionSearchError(
      'NETWORK_ERROR',
      'Network failure communicating with PayPal Sandbox Transaction Search.',
      503
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 400) {
      throw new TransactionSearchError(
        'INVALID_PARAMETERS',
        'PayPal rejected the search parameters. Ensure date formats and account permissions are valid.',
        400
      );
    }
    if (response.status === 401) {
      throw new TransactionSearchError(
        'AUTHENTICATION_FAILED',
        'PayPal Sandbox access token was rejected or expired.',
        401
      );
    }
    if (response.status === 403) {
      throw new TransactionSearchError(
        'INSUFFICIENT_SCOPE',
        'PayPal Sandbox application is not authorized for Transaction Search read access.',
        403
      );
    }
    if (response.status === 429) {
      throw new TransactionSearchError(
        'RATE_LIMITED',
        'PayPal API rate limit reached. Please back off before retrying.',
        429
      );
    }
    if (response.status >= 500) {
      throw new TransactionSearchError(
        'SERVICE_UNAVAILABLE',
        'PayPal Sandbox Transaction Search reporting service is temporarily unavailable.',
        503
      );
    }
    throw new TransactionSearchError(
      'SERVICE_UNAVAILABLE',
      `PayPal Transaction Search responded with HTTP status ${response.status}.`,
      response.status
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new TransactionSearchError(
      'PARSE_ERROR',
      'PayPal returned an invalid JSON response body.',
      502
    );
  }

  const parsed = paypalTransactionSearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new TransactionSearchError(
      'PARSE_ERROR',
      'PayPal response body did not match the expected reporting schema.',
      502
    );
  }

  return parsed.data;
}

/**
 * Public response contract for the read-only transaction search preview.
 */
export interface TransactionSearchPreviewResult {
  provider: 'PayPal';
  environment: 'sandbox';
  dateRange: {
    startDate: string;
    endDate: string;
  };
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalItems: number;
    pagesFetched: number;
  };
  records: {
    totalRetrieved: number;
    normalizedCount: number;
    rejectedCount: number;
    normalized: PaymentTransaction[];
    rejected: Array<{
      reason: string;
      message: string;
      rawDetail: PayPalTransactionDetail;
    }>;
  };
  fetchedAt: string;
  durationMs: number;
  lagNotice: string;
}

/**
 * Queries PayPal Transaction Search API with bounded pagination and returns normalized preview results.
 * Never persists records or executes reconciliation.
 */
export async function executeTransactionSearchPreview(
  params: TransactionSearchQueryParams
): Promise<TransactionSearchPreviewResult> {
  const startTime = Date.now();
  const validQuery = validateSearchQueryParams(params);

  const timeoutMs = params.timeoutMs || DEFAULT_SEARCH_TIMEOUT_MS;
  const fetchFn = params.fetchFn || fetch;

  // Obtain verified server-only OAuth token
  let token;
  try {
    token = await getValidOAuthToken({ fetchFn, timeoutMs });
  } catch (err: unknown) {
    if (err instanceof PayPalAuthError) {
      throw new TransactionSearchError('AUTHENTICATION_FAILED', err.message, err.httpStatus);
    }
    throw err;
  }

  if (!token.hasTransactionSearchScope) {
    throw new TransactionSearchError(
      'INSUFFICIENT_SCOPE',
      'Authenticated successfully, but application lacks required Transaction Search scope (https://uri.paypal.com/services/reporting/search/read).',
      403
    );
  }

  const rawDetails: PayPalTransactionDetail[] = [];
  let currentPage = validQuery.page;
  let reportedTotalPages = 1;
  let reportedTotalItems = 0;
  let pagesFetched = 0;

  // Bounded pagination loop
  while (pagesFetched < validQuery.maxPages) {
    const pageData = await fetchSinglePage(
      token.accessToken,
      validQuery.startDate,
      validQuery.endDate,
      currentPage,
      validQuery.pageSize,
      timeoutMs,
      fetchFn
    );

    pagesFetched++;
    reportedTotalPages = pageData.total_pages || reportedTotalPages;
    reportedTotalItems = pageData.total_items ?? reportedTotalItems;

    const items = pageData.transaction_details || [];
    rawDetails.push(...items);

    // Stop if page returned 0 items
    if (items.length === 0) {
      break;
    }

    // Stop if we have fetched up to total_pages
    if (pageData.total_pages && currentPage >= pageData.total_pages) {
      break;
    }

    currentPage++;
  }

  // Normalization
  const { normalized, rejected, totalInput } = normalizePayPalBatch(rawDetails);

  return {
    provider: 'PayPal',
    environment: 'sandbox',
    dateRange: {
      startDate: validQuery.startDate,
      endDate: validQuery.endDate,
    },
    pagination: {
      page: validQuery.page,
      pageSize: validQuery.pageSize,
      totalPages: reportedTotalPages,
      totalItems: reportedTotalItems || totalInput,
      pagesFetched,
    },
    records: {
      totalRetrieved: totalInput,
      normalizedCount: normalized.length,
      rejectedCount: rejected.length,
      normalized,
      rejected,
    },
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    lagNotice: PAYPAL_REPORTING_LAG_NOTICE,
  };
}
