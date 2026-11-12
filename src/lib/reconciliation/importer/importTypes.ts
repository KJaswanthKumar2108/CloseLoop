import { MerchantOrder, PaymentTransaction } from '@/types/financial';

export interface RowValidationError {
  rowNumber: number;
  field: string;
  rawValue?: string;
  message: string;
}

export interface CsvImportResult<T> {
  datasetType: 'MERCHANT_ORDERS' | 'PAYPAL_TRANSACTIONS';
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  validationErrors: RowValidationError[];
  normalizedRecords: T[];
  rawHeaders: string[];
  mappedColumns: Record<string, string>;
}

export type OrderImportResult = CsvImportResult<MerchantOrder>;
export type TransactionImportResult = CsvImportResult<PaymentTransaction>;

