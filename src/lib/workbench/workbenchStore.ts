import { ReconciliationRun } from '@/types/financial';

export type ReviewStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED';

export interface RecordReviewState {
  recordId: string;
  status: ReviewStatus;
  notes?: string;
  updatedAt: string; // ISO 8601
  operator: string;
}

export type DatasetOrigin = 'IMPORTED' | 'SYNTHETIC_DEMO' | 'NONE';

interface WorkbenchState {
  activeRun: ReconciliationRun | null;
  runHistory: ReconciliationRun[];
  datasetOrigin: DatasetOrigin;
  reviews: Record<string, RecordReviewState>;
}

// In-memory global store singleton for the active server session
// Explicit limitation: in-memory persistence only; resets on server restart
const state: WorkbenchState = {
  activeRun: null,
  runHistory: [],
  datasetOrigin: 'NONE',
  reviews: {},
};

export function getActiveRun(): ReconciliationRun | null {
  return state.activeRun;
}

export function setActiveRun(run: ReconciliationRun, origin: DatasetOrigin): void {
  state.activeRun = run;
  state.datasetOrigin = origin;

  // Add to run history (keep up to 20 most recent runs)
  const exists = state.runHistory.some((r) => r.id === run.id);
  if (!exists) {
    state.runHistory = [run, ...state.runHistory].slice(0, 20);
  }
}

export function getRunHistory(): ReconciliationRun[] {
  return [...state.runHistory];
}

export function getDatasetOrigin(): DatasetOrigin {
  return state.datasetOrigin;
}

export function getRecordReviews(): Record<string, RecordReviewState> {
  return { ...state.reviews };
}

export function setRecordReview(
  recordId: string,
  reviewStatus: ReviewStatus,
  notes?: string,
  operator: string = 'Financial Operator'
): RecordReviewState {
  const review: RecordReviewState = {
    recordId,
    status: reviewStatus,
    notes: notes?.trim() || undefined,
    updatedAt: new Date().toISOString(),
    operator,
  };

  state.reviews[recordId] = review;
  return review;
}

export function clearWorkbenchState(): void {
  state.activeRun = null;
  state.runHistory = [];
  state.datasetOrigin = 'NONE';
  state.reviews = {};
}

