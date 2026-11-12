'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ReconciliationRun } from '@/types/financial';
import {
  DatasetOrigin,
  RecordReviewState,
  ReviewStatus,
} from '@/lib/workbench/workbenchStore';
import {
  executeCsvReconciliation,
  executePersistedReconciliation,
  fetchWorkbenchState,
  fetchSampleDataset,
  updateRecordReviewStatus,
  CsvImportSummary,
  PersistedReconciliationParams,
  PersistedReconciliationResponse,
  PersistedReconciliationError,
} from '@/lib/api/reconciliationClient';

interface WorkbenchContextType {
  activeRun: ReconciliationRun | null;
  datasetOrigin: DatasetOrigin;
  importSummary: { orders?: CsvImportSummary; transactions?: CsvImportSummary } | null;
  persistedMetadata: PersistedReconciliationResponse['metadata'] | null;
  runHistory: ReconciliationRun[];
  reviews: Record<string, RecordReviewState>;
  isLoading: boolean;
  error: string | null;
  persistedError: PersistedReconciliationError | null;
  selectedRecordId: string | null;
  setSelectedRecordId: (id: string | null) => void;
  runReconciliationFromCsv: (
    ordersCsv: string,
    transactionsCsv: string,
    origin?: DatasetOrigin
  ) => Promise<ReconciliationRun>;
  runPersistedReconciliation: (
    params: PersistedReconciliationParams
  ) => Promise<ReconciliationRun>;
  loadSampleDataset: () => Promise<{ ordersCsv: string; transactionsCsv: string }>;
  updateReview: (recordId: string, status: ReviewStatus, notes?: string) => Promise<void>;
  clearError: () => void;
  refreshState: () => Promise<void>;
}

const WorkbenchContext = createContext<WorkbenchContextType | undefined>(undefined);

const SESSION_STORAGE_KEY = 'closeloop_active_run_v1';

export const WorkbenchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeRun, setActiveRun] = useState<ReconciliationRun | null>(null);
  const [datasetOrigin, setDatasetOrigin] = useState<DatasetOrigin>('NONE');
  const [importSummary, setImportSummary] = useState<{
    orders?: CsvImportSummary;
    transactions?: CsvImportSummary;
  } | null>(null);
  const [runHistory, setRunHistory] = useState<ReconciliationRun[]>([]);
  const [reviews, setReviews] = useState<Record<string, RecordReviewState>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [persistedError, setPersistedError] = useState<PersistedReconciliationError | null>(null);
  const [persistedMetadata, setPersistedMetadata] = useState<PersistedReconciliationResponse['metadata'] | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Initial load: sync with backend and session cache
  const refreshState = useCallback(async () => {
    try {
      const data = await fetchWorkbenchState();
      if (data.activeRun) {
        setActiveRun(data.activeRun);
        setDatasetOrigin(data.datasetOrigin || 'IMPORTED');
      } else if (typeof window !== 'undefined') {
        const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            setActiveRun(parsed.run);
            setDatasetOrigin(parsed.origin || 'IMPORTED');
          } catch (e) {
            console.warn('Failed to parse cached session run:', e);
          }
        }
      }
      if (data.runHistory) setRunHistory(data.runHistory);
      if (data.reviews) setReviews(data.reviews);
    } catch (e) {
      console.warn('Workbench state sync failed:', e);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    fetchWorkbenchState()
      .then((data) => {
        if (!isMounted) return;
        if (data.activeRun) {
          setActiveRun(data.activeRun);
          setDatasetOrigin(data.datasetOrigin || 'IMPORTED');
        } else if (typeof window !== 'undefined') {
          const cached = sessionStorage.getItem(SESSION_STORAGE_KEY);
          if (cached) {
            try {
              const parsed = JSON.parse(cached);
              if (isMounted) {
                setActiveRun(parsed.run);
                setDatasetOrigin(parsed.origin || 'IMPORTED');
              }
            } catch (e) {
              console.warn('Failed to parse cached session run:', e);
            }
          }
        }
        if (isMounted) {
          if (data.runHistory) setRunHistory(data.runHistory);
          if (data.reviews) setReviews(data.reviews);
        }
      })
      .catch((e) => {
        console.warn('Initial workbench state sync failed:', e);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const runReconciliationFromCsv = useCallback(
    async (
      ordersCsv: string,
      transactionsCsv: string,
      origin: DatasetOrigin = 'IMPORTED'
    ): Promise<ReconciliationRun> => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await executeCsvReconciliation(ordersCsv, transactionsCsv, origin);
        setActiveRun(res.run);
        setDatasetOrigin(origin);
        if (res.importSummary) {
          setImportSummary(res.importSummary);
        }

        // Cache in session storage for persistence across client page navigations
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            JSON.stringify({ run: res.run, origin })
          );
        }

        // Add to local history list
        setRunHistory((prev) => [res.run, ...prev.filter((r) => r.id !== res.run.id)].slice(0, 20));

        return res.run;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Reconciliation execution failed';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const loadSampleDataset = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const sample = await fetchSampleDataset();
      return {
        ordersCsv: sample.ordersCsv,
        transactionsCsv: sample.transactionsCsv,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load sample dataset';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateReview = useCallback(
    async (recordId: string, status: ReviewStatus, notes?: string) => {
      try {
        const updated = await updateRecordReviewStatus(recordId, status, notes);
        setReviews((prev) => ({
          ...prev,
          [recordId]: updated,
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update review status';
        setError(message);
        throw err;
      }
    },
    []
  );

  const runPersistedReconciliation = useCallback(
    async (params: PersistedReconciliationParams): Promise<ReconciliationRun> => {
      setIsLoading(true);
      setError(null);
      setPersistedError(null);

      try {
        const res = await executePersistedReconciliation(params);
        setActiveRun(res.run);
        setDatasetOrigin('IMPORTED');
        setPersistedMetadata(res.metadata);
        setImportSummary(null);

        // Cache in session storage for persistence across client page navigations
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(
            SESSION_STORAGE_KEY,
            JSON.stringify({ run: res.run, origin: 'IMPORTED' })
          );
        }

        // Add to local history list
        setRunHistory((prev) => [res.run, ...prev.filter((r) => r.id !== res.run.id)].slice(0, 20));

        return res.run;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Persisted reconciliation failed';
        setError(message);
        if (err && typeof err === 'object' && 'code' in err) {
          setPersistedError(err as PersistedReconciliationError);
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clearError = useCallback(() => {
    setError(null);
    setPersistedError(null);
  }, []);

  return (
    <WorkbenchContext.Provider
      value={{
        activeRun,
        datasetOrigin,
        importSummary,
        persistedMetadata,
        runHistory,
        reviews,
        isLoading,
        error,
        persistedError,
        selectedRecordId,
        setSelectedRecordId,
        runReconciliationFromCsv,
        runPersistedReconciliation,
        loadSampleDataset,
        updateReview,
        clearError,
        refreshState,
      }}
    >
      {children}
    </WorkbenchContext.Provider>
  );
};

export function useWorkbench() {
  const context = useContext(WorkbenchContext);
  if (!context) {
    throw new Error('useWorkbench must be used within a WorkbenchProvider');
  }
  return context;
}
