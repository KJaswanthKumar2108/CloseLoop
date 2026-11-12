import { getValidOAuthToken, PayPalAuthError } from '@/lib/paypal/auth';
import {
  validateSearchQueryParams,
  TransactionSearchError,
  DEFAULT_SEARCH_TIMEOUT_MS,
  PAYPAL_TRANSACTION_SEARCH_URL,
  PAYPAL_REPORTING_LAG_NOTICE,
} from './transactionSearch';
import {
  paypalTransactionSearchResponseSchema,
  PayPalTransactionDetail,
  PayPalTransactionSearchResponse,
} from './transactionSchemas';
import { normalizePayPalTransactionDetail } from './normalizer';
import { initiateImportRunLease, finalizeImportRun, getImportRunById } from '@/lib/db/repositories/importRunRepository';
import { recordPayPalImportBatch, BatchItemInput } from '@/lib/db/provenanceService';
import { ImportRunRecord, ImportStatus } from '@/lib/db/types';

export interface ImportPayPalTransactionsParams {
  startDate: string;
  endDate: string;
  page?: number;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface ImportServiceResult {
  success: boolean;
  importRunId: string;
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
  metrics: {
    recordsReceived: number;
    recordsInserted: number;
    recordsAlreadyPresent: number;
    recordsRejected: number;
    identityCollisionsDetected: number;
    crossBatchDiscrepancies: number;
    importStatus: ImportStatus;
  };
  importRun: ImportRunRecord;
  durationMs: number;
  lagNotice: string;
}

async function fetchSingleSearchPage(
  accessToken: string,
  startDate: string,
  endDate: string,
  page: number,
  pageSize: number,
  timeoutMs: number,
  fetchFn: typeof fetch
): Promise<PayPalTransactionSearchResponse> {
  const url = new URL(PAYPAL_TRANSACTION_SEARCH_URL);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(pageSize));
  url.searchParams.set('fields', 'all');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url.toString(), {
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
      throw new TransactionSearchError('TIMEOUT', `PayPal Transaction Search timed out after ${timeoutMs}ms.`, 504);
    }
    throw new TransactionSearchError(
      'NETWORK_ERROR',
      `Failed to connect to PayPal reporting endpoint: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errBody = await res.json();
      errorDetail = errBody.message || errBody.error_description || JSON.stringify(errBody);
    } catch {
      errorDetail = res.statusText;
    }

    if (res.status === 401) {
      throw new TransactionSearchError('AUTHENTICATION_FAILED', `PayPal token rejected: ${errorDetail}`, 401);
    }
    if (res.status === 403) {
      throw new TransactionSearchError('INSUFFICIENT_SCOPE', `PayPal permission denied: ${errorDetail}`, 403);
    }
    if (res.status === 429) {
      throw new TransactionSearchError('RATE_LIMITED', 'PayPal reporting API rate limit exceeded. Retry later.', 429);
    }
    if (res.status >= 500) {
      throw new TransactionSearchError(
        'SERVICE_UNAVAILABLE',
        `PayPal reporting service temporarily unavailable (${res.status}): ${errorDetail}`,
        503
      );
    }

    throw new TransactionSearchError(
      'NETWORK_ERROR',
      `PayPal reporting API returned error (${res.status}): ${errorDetail}`,
      res.status
    );
  }

  const rawJson = await res.json();
  const parsed = paypalTransactionSearchResponseSchema.safeParse(rawJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new TransactionSearchError(
      'PARSE_ERROR',
      `Invalid reporting response from PayPal: ${issues}`,
      502
    );
  }

  return parsed.data;
}

/**
 * Executes a server-side, durable PayPal Transaction Ingestion workflow.
 *
 * Guarantees:
 * 1. Validates requested date window (max 31 days).
 * 2. Verifies OAuth credentials and Transaction Search reporting scope.
 * 3. Tracks full provenance in import_runs.
 * 4. Normalizes reporting rows using Phase 3B rules without mutation.
 * 5. Persists records atomically into PostgreSQL via recordPayPalImportBatch.
 * 6. Quarantines intra-batch and cross-batch collisions with audit logs.
 * 7. NEVER automatically executes reconciliation.
 */
export async function importPayPalTransactions(
  params: ImportPayPalTransactionsParams
): Promise<ImportServiceResult> {
  const startTime = Date.now();
  const validQuery = validateSearchQueryParams({
    startDate: params.startDate,
    endDate: params.endDate,
    page: params.page,
    pageSize: params.pageSize,
    maxPages: params.maxPages,
  });

  const timeoutMs = params.timeoutMs || DEFAULT_SEARCH_TIMEOUT_MS;
  const fetchFn = params.fetchFn || fetch;

  // 1. Verify OAuth token & reporting scope
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
      'PayPal credentials lack required Transaction Search scope (https://uri.paypal.com/services/reporting/search/read).',
      403
    );
  }

  // 2. Initialize Import Run in database under exclusive advisory lock lease
  const importRun = await initiateImportRunLease({
    sourceProvider: 'PAYPAL',
    sourceEnvironment: 'SANDBOX',
    requestedStartDate: validQuery.startDate,
    requestedEndDate: validQuery.endDate,
    pageSize: validQuery.pageSize,
    maxPages: validQuery.maxPages,
  });

  const rawDetails: PayPalTransactionDetail[] = [];
  let currentPage = validQuery.page;
  let reportedTotalPages = 1;
  let reportedTotalItems = 0;
  let pagesFetched = 0;

  // 3. Bounded pagination loop
  try {
    while (pagesFetched < validQuery.maxPages) {
      const pageData = await fetchSingleSearchPage(
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

      if (items.length === 0) {
        break;
      }

      if (pageData.total_pages && currentPage >= pageData.total_pages) {
        break;
      }

      currentPage++;
    }
  } catch (fetchErr: unknown) {
    // Record failed import run in database
    const errCode =
      fetchErr instanceof TransactionSearchError ? fetchErr.code : 'FETCH_FAILED';
    const errMsg =
      fetchErr instanceof Error ? fetchErr.message : String(fetchErr);

    await finalizeImportRun(importRun.id, {
      pagesFetched,
      recordsReceived: rawDetails.length,
      recordsInserted: 0,
      recordsAlreadyPresent: 0,
      recordsRejected: 0,
      identityCollisionsDetected: 0,
      importStatus: 'FAILED',
      safeErrorCode: errCode,
      safeErrorMessage: errMsg,
    });

    throw fetchErr;
  }

  // 4. Normalize records and build batch items for provenance service
  const batchItems: BatchItemInput[] = [];

  for (const detail of rawDetails) {
    const norm = normalizePayPalTransactionDetail(detail);
    if (norm.success) {
      batchItems.push({
        normalized: norm.transaction,
        rawDetail: norm.rawDetail,
      });
    } else {
      batchItems.push({
        rejected: {
          reason: norm.reason,
          message: norm.message,
          rawDetail: norm.rawDetail,
        },
        rawDetail: norm.rawDetail,
      });
    }
  }

  const isTruncated = reportedTotalPages > pagesFetched;

  // 6. Record batch atomically into durable PostgreSQL persistence
  const batchResult = await recordPayPalImportBatch({
    importRunId: importRun.id,
    pagesFetched,
    isTruncated,
    items: batchItems,
  });

  const finalRun = await getImportRunById(importRun.id);

  return {
    success: true,
    importRunId: importRun.id,
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
      totalItems: reportedTotalItems || rawDetails.length,
      pagesFetched,
    },
    metrics: {
      recordsReceived: batchResult.recordsReceived,
      recordsInserted: batchResult.recordsInserted,
      recordsAlreadyPresent: batchResult.recordsAlreadyPresent,
      recordsRejected: batchResult.recordsRejected,
      identityCollisionsDetected: batchResult.identityCollisionsDetected,
      crossBatchDiscrepancies: batchResult.crossBatchDiscrepancies,
      importStatus: batchResult.status,
    },
    importRun: finalRun || importRun,
    durationMs: Date.now() - startTime,
    lagNotice: isTruncated
      ? `${PAYPAL_REPORTING_LAG_NOTICE} Ingestion stopped at maxPages limit (${pagesFetched}/${reportedTotalPages} pages fetched). Import status marked PARTIAL.`
      : PAYPAL_REPORTING_LAG_NOTICE,
  };
}
