import { ReconciliationRun } from '@/types/financial';
import { DatasetOrigin, RecordReviewState, ReviewStatus } from '@/lib/workbench/workbenchStore';

export interface CsvImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  validationErrors: Array<{
    row: number;
    field: string;
    message: string;
    rawRecordSnippet?: string;
  }>;
}

export interface ReconciliationPreviewResponse {
  success: boolean;
  mode: 'CSV' | 'JSON';
  importSummary?: {
    orders: CsvImportSummary;
    transactions: CsvImportSummary;
  };
  run: ReconciliationRun;
}

export interface WorkbenchApiResponse {
  success: boolean;
  activeRun: ReconciliationRun | null;
  runHistory: ReconciliationRun[];
  datasetOrigin: DatasetOrigin;
  reviews: Record<string, RecordReviewState>;
  persistenceType?: string;
}

export interface SampleDatasetResponse {
  success: boolean;
  datasetOrigin: 'SYNTHETIC_DEMO';
  label: string;
  disclaimer: string;
  metadata: {
    totalOrders: number;
    totalTransactions: number;
    scenariosCount: number;
  };
  ordersCsv: string;
  transactionsCsv: string;
}

export interface PersistedReconciliationParams {
  startDate: string;
  endDate: string;
  acknowledgedPartial?: boolean;
  ordersCsv?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  orders?: any[];
  config?: Record<string, unknown>;
}

export interface PersistedReconciliationResponse {
  success: boolean;
  run: ReconciliationRun;
  metadata: {
    datasetOrigin: 'PAYPAL_DURABLE_LEDGER';
    startDate: string;
    endDate: string;
    totalEligibleCount: number;
    reconciledTransactionCount: number;
    adapterRejectedCount: number;
    adapterRejections: Array<{ transactionId: string; reason: string; detail: string }>;
    isPartial: boolean;
    partialNotice?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    intersectingIncompleteRuns: any[];
    ordersSource: 'CSV' | 'JSON';
    ordersCount: number;
  };
}

export interface PersistedReconciliationError extends Error {
  code?: string;
  details?: unknown;
  status?: number;
}

/**
 * Executes reconciliation using persisted PayPal transactions from the PostgreSQL ledger.
 */
export async function executePersistedReconciliation(
  params: PersistedReconciliationParams,
  signal?: AbortSignal
): Promise<PersistedReconciliationResponse> {
  const response = await fetch('/api/reconciliation/preview-persisted', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
    signal,
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data.message || data.error || `HTTP ${response.status} persisted reconciliation error`
    ) as PersistedReconciliationError;
    error.code = data.code;
    error.details = data.details;
    error.status = response.status;
    throw error;
  }

  // Synchronize active run to server workbench store
  if (data.run) {
    try {
      await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run: data.run,
          origin: 'IMPORTED',
        }),
      });
    } catch (e) {
      console.warn('Failed to sync active run to server store:', e);
    }
  }

  return data;
}

/**
 * Executes a deterministic reconciliation preview run from two CSV file payloads.
 */
export async function executeCsvReconciliation(
  ordersCsv: string,
  transactionsCsv: string,
  origin: DatasetOrigin = 'IMPORTED',
  signal?: AbortSignal
): Promise<ReconciliationPreviewResponse> {
  const response = await fetch('/api/reconciliation/preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mode: 'CSV',
      ordersCsv,
      transactionsCsv,
    }),
    signal,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || data.error || `HTTP ${response.status} reconciliation error`);
  }

  // Synchronize active run to server workbench store
  if (data.run) {
    try {
      await fetch('/api/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run: data.run,
          origin,
        }),
      });
    } catch (e) {
      console.warn('Failed to sync active run to server store:', e);
    }
  }

  return data;
}

/**
 * Retrieves the current workbench state (active run, history, dataset origin, reviews).
 */
export async function fetchWorkbenchState(): Promise<WorkbenchApiResponse> {
  const response = await fetch('/api/reconciliation', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    cache: 'no-store',
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch reconciliation workbench state');
  }

  return data;
}

/**
 * Fetches the synthetic demonstration CSV datasets from Phase 2A fixtures.
 */
export async function fetchSampleDataset(): Promise<SampleDatasetResponse> {
  const response = await fetch('/api/reconciliation/sample', {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to fetch sample dataset');
  }

  return data;
}

/**
 * Updates human operator review status for a specific reconciliation record.
 */
export async function updateRecordReviewStatus(
  recordId: string,
  reviewStatus: ReviewStatus,
  notes?: string,
  operator: string = 'Financial Operator'
): Promise<RecordReviewState> {
  const response = await fetch('/api/reconciliation/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordId,
      reviewStatus,
      notes,
      operator,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Failed to update review status');
  }

  return data.review;
}

