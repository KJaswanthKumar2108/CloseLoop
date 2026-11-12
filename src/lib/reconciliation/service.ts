import {
  MerchantOrder,
  PaymentTransaction,
  ReconciliationRun,
} from '@/types/financial';
import {
  MatchingConfiguration,
  DEFAULT_MATCHING_CONFIG,
} from './matcher/matchingRules';
import { runDeterministicMatching } from './matcher/matchingEngine';
import {
  importMerchantOrdersCsv,
  importPayPalTransactionsCsv,
} from './importer';

export interface ReconciliationServiceInput {
  orders: MerchantOrder[];
  transactions: PaymentTransaction[];
  config?: Partial<MatchingConfiguration>;
  datasetReferences?: {
    ordersFileId?: string;
    transactionsFileId?: string;
  };
}

export interface CsvReconciliationServiceInput {
  ordersCsv: string;
  transactionsCsv: string;
  config?: Partial<MatchingConfiguration>;
  datasetReferences?: {
    ordersFileId?: string;
    transactionsFileId?: string;
  };
}

/**
 * Execute in-memory deterministic reconciliation on validated domain models.
 * Pure function with reproducible output given identical inputs.
 */
export function executeReconciliationRun(
  input: ReconciliationServiceInput
): ReconciliationRun {
  const startedAt = new Date().toISOString();
  const mergedConfig = {
    ...DEFAULT_MATCHING_CONFIG,
    ...(input.config || {}),
  };

  const engineResult = runDeterministicMatching(
    input.orders,
    input.transactions,
    mergedConfig
  );

  const completedAt = new Date().toISOString();

  return {
    id: `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    startedAt,
    completedAt,
    totalOrders: input.orders.length,
    totalTransactions: input.transactions.length,
    matchedCount: engineResult.matchedOrdersCount,
    unmatchedOrderCount: engineResult.unmatchedOrdersCount,
    unmatchedTransactionCount: engineResult.unmatchedTransactionsCount,
    exceptionCount: engineResult.exceptionCount,
    status: 'COMPLETED',
    datasetReferences: {
      ordersFileId: input.datasetReferences?.ordersFileId,
      transactionsFileId: input.datasetReferences?.transactionsFileId,
      orderCount: input.orders.length,
      transactionCount: input.transactions.length,
    },
    records: engineResult.records,
  };
}

/**
 * Convenience service function that parses raw CSV strings for both orders and transactions,
 * normalizes them into domain models, and executes the deterministic engine.
 */
export function executeCsvReconciliationRun(
  input: CsvReconciliationServiceInput
): {
  run: ReconciliationRun;
  ordersImportResult: ReturnType<typeof importMerchantOrdersCsv>;
  transactionsImportResult: ReturnType<typeof importPayPalTransactionsCsv>;
} {
  const ordersImportResult = importMerchantOrdersCsv(input.ordersCsv);
  const transactionsImportResult = importPayPalTransactionsCsv(input.transactionsCsv);

  const run = executeReconciliationRun({
    orders: ordersImportResult.normalizedRecords,
    transactions: transactionsImportResult.normalizedRecords,
    config: input.config,
    datasetReferences: input.datasetReferences,
  });

  return {
    run,
    ordersImportResult,
    transactionsImportResult,
  };
}

