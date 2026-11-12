import {
  PaymentTransaction,
  TransactionType,
  TransactionStatus,
} from '@/types/financial';
import { parseDecimalToMoney } from '../money';
import { parseCsvContent } from './csvNormalizer';
import {
  resolveColumn,
  parseAndValidateIsoTimestamp,
  DuplicateDetector,
} from './importValidation';
import { TransactionImportResult, RowValidationError } from './importTypes';

const TRANSACTION_COLUMN_CANDIDATES = {
  transactionId: ['transaction id', 'txn_id', 'transaction_id', 'paypal transaction id', 'transactionid', 'id'],
  grossAmount: ['gross', 'gross amount', 'amount', 'total', 'transaction amount'],
  currency: ['currency', 'currency code', 'currency_code', 'ccy'],
  date: ['date', 'transaction date', 'datetime', 'timestamp', 'creation date'],
  time: ['time', 'transaction time'],
  feeAmount: ['fee', 'fee amount', 'paypal fee', 'fees'],
  netAmount: ['net', 'net amount', 'settlement amount'],
  type: ['type', 'transaction type', 'event code', 'event type'],
  status: ['status', 'transaction status', 'payment status'],
  orderId: ['order id', 'order_id', 'paypal order id', 'checkout order id'],
  captureId: ['capture id', 'capture_id', 'paypal capture id'],
  invoiceId: ['invoice id', 'invoice_id', 'invoice number'],
  merchantReference: ['custom number', 'custom id', 'custom_id', 'reference', 'merchant reference', 'memo', 'item id'],
};

export function normalizeTransactionType(rawType?: string): TransactionType | null {
  if (rawType === undefined) return 'CAPTURE';
  const norm = rawType.toUpperCase().trim();
  if (norm === '') return null;
  if (norm.includes('REFUND')) return 'REFUND';
  if (norm.includes('REVERSAL')) return 'REVERSAL';
  if (norm.includes('AUTHORIZ') || norm === 'AUTH') return 'AUTHORIZATION';
  if (norm.includes('VOID')) return 'VOID';
  if (norm.includes('DISPUTE') || norm === 'PAYMENT HOLD' || norm === 'CHARGEBACK HOLD' || norm === 'DISPUTE_HOLD') return 'DISPUTE_HOLD';
  if (norm.includes('FEE')) return 'FEE';
  if (norm.includes('PAYOUT') || norm.includes('WITHDRAWAL')) return 'PAYOUT';
  if (norm === 'PAYMENT' || norm === 'CAPTURE' || norm.includes('CHECKOUT') || norm.includes('SALE')) return 'CAPTURE';
  return null;
}

export function normalizeTransactionStatus(rawStatus?: string): TransactionStatus | null {
  if (rawStatus === undefined) return 'COMPLETED';
  const norm = rawStatus.toUpperCase().trim();
  if (norm === '') return null;
  if (norm === 'S' || norm === 'COMPLETED' || norm === 'CLEARED' || norm === 'SUCCESS' || norm === 'PAID') return 'COMPLETED';
  if (norm === 'P' || norm === 'PENDING' || norm === 'IN_PROGRESS' || norm === 'PROCESSING') return 'PENDING';
  if (norm === 'D' || norm === 'DENIED' || norm === 'FAILED' || norm === 'DECLINED') return 'DENIED';
  if (norm === 'V' || norm === 'REVERSED' || norm === 'CHARGEBACK') return 'REVERSED';
  if (norm === 'REFUNDED' || norm === 'PARTIALLY_REFUNDED') return 'REFUNDED';
  if (norm === 'VOIDED' || norm === 'CANCELED' || norm === 'CANCELLED') return 'VOIDED';
  return null;
}

export function importPayPalTransactionsCsv(csvContent: string): TransactionImportResult {
  const { headers, rows, parseErrors } = parseCsvContent(csvContent);

  const validationErrors: RowValidationError[] = [];
  const mappedColumns: Record<string, string> = {};

  // Resolve required columns
  const txnIdCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.transactionId);
  const grossCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.grossAmount);
  const currencyCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.currency);
  const dateCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.date);

  // Optional columns
  const timeCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.time);
  const feeCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.feeAmount);
  const netCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.netAmount);
  const typeCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.type);
  const statusCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.status);
  const orderIdCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.orderId);
  const captureIdCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.captureId);
  const invoiceIdCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.invoiceId);
  const refCol = resolveColumn(headers, TRANSACTION_COLUMN_CANDIDATES.merchantReference);

  if (txnIdCol) mappedColumns.transactionId = txnIdCol.rawHeader;
  if (grossCol) mappedColumns.grossAmount = grossCol.rawHeader;
  if (currencyCol) mappedColumns.currency = currencyCol.rawHeader;
  if (dateCol) mappedColumns.date = dateCol.rawHeader;
  if (timeCol) mappedColumns.time = timeCol.rawHeader;
  if (feeCol) mappedColumns.feeAmount = feeCol.rawHeader;
  if (netCol) mappedColumns.netAmount = netCol.rawHeader;
  if (typeCol) mappedColumns.type = typeCol.rawHeader;
  if (statusCol) mappedColumns.status = statusCol.rawHeader;
  if (orderIdCol) mappedColumns.orderId = orderIdCol.rawHeader;
  if (captureIdCol) mappedColumns.captureId = captureIdCol.rawHeader;
  if (invoiceIdCol) mappedColumns.invoiceId = invoiceIdCol.rawHeader;
  if (refCol) mappedColumns.merchantReference = refCol.rawHeader;

  const missingRequiredColumns: string[] = [];
  if (!txnIdCol) missingRequiredColumns.push('Transaction ID (e.g. Transaction ID, txn_id)');
  if (!grossCol) missingRequiredColumns.push('Gross Amount (e.g. Gross, Amount)');
  if (!currencyCol) missingRequiredColumns.push('Currency (e.g. Currency, Currency Code)');
  if (!dateCol) missingRequiredColumns.push('Date (e.g. Date, Timestamp)');

  if (missingRequiredColumns.length > 0) {
    validationErrors.push({
      rowNumber: 1,
      field: 'headers',
      message: `Missing required columns: ${missingRequiredColumns.join(', ')}`,
    });
    return {
      datasetType: 'PAYPAL_TRANSACTIONS',
      totalRows: rows.length,
      validRows: 0,
      invalidRows: rows.length,
      duplicateRows: 0,
      validationErrors,
      normalizedRecords: [],
      rawHeaders: headers,
      mappedColumns,
    };
  }

  for (const err of parseErrors) {
    validationErrors.push({
      rowNumber: err.row !== undefined ? err.row + 2 : 1,
      field: 'csv_syntax',
      message: err.message,
    });
  }

  const duplicateDetector = new DuplicateDetector();
  const normalizedRecords: PaymentTransaction[] = [];
  let duplicateCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    let rowValid = true;

    const rawTxnId = row[txnIdCol!.rawHeader];
    const rawGross = row[grossCol!.rawHeader];
    const rawCurrency = row[currencyCol!.rawHeader];
    const rawDate = row[dateCol!.rawHeader];
    const rawTime = timeCol ? row[timeCol.rawHeader] : undefined;

    if (!rawTxnId || rawTxnId.trim() === '') {
      validationErrors.push({
        rowNumber,
        field: 'transactionId',
        message: 'PayPal Transaction ID is required and cannot be empty',
      });
      rowValid = false;
    }

    if (rawTxnId && duplicateDetector.isDuplicate(rawTxnId)) {
      validationErrors.push({
        rowNumber,
        field: 'transactionId',
        rawValue: rawTxnId,
        message: `Duplicate PayPal transaction ID detected: "${rawTxnId}"`,
      });
      duplicateCount++;
      rowValid = false;
    }

    let parsedCurrency = '';
    if (!rawCurrency || rawCurrency.trim().length !== 3) {
      validationErrors.push({
        rowNumber,
        field: 'currency',
        rawValue: rawCurrency,
        message: `Invalid 3-letter ISO currency code: "${rawCurrency || ''}"`,
      });
      rowValid = false;
    } else {
      parsedCurrency = rawCurrency.trim().toUpperCase();
    }

    let parsedGross;
    if (parsedCurrency) {
      try {
        parsedGross = parseDecimalToMoney(rawGross, parsedCurrency);
      } catch (err: unknown) {
        validationErrors.push({
          rowNumber,
          field: 'grossAmount',
          rawValue: rawGross,
          message: err instanceof Error ? err.message : 'Invalid monetary gross decimal value',
        });
        rowValid = false;
      }
    }

    let parsedFee;
    if (feeCol && row[feeCol.rawHeader] && parsedCurrency) {
      try {
        parsedFee = parseDecimalToMoney(row[feeCol.rawHeader], parsedCurrency);
      } catch {
        // Fee format issue, record warning but do not invalidate entire record if gross is valid
      }
    }

    let parsedNet;
    if (netCol && row[netCol.rawHeader] && parsedCurrency) {
      try {
        parsedNet = parseDecimalToMoney(row[netCol.rawHeader], parsedCurrency);
      } catch {
        // Net format issue
      }
    }

    const isoDate = parseAndValidateIsoTimestamp(rawDate || '', rawTime);
    if (!isoDate) {
      validationErrors.push({
        rowNumber,
        field: 'date',
        rawValue: rawDate,
        message: `Cannot parse valid timestamp from date: "${rawDate || ''}" (time: "${rawTime || ''}")`,
      });
      rowValid = false;
    }

    let normalizedType: TransactionType = 'CAPTURE';
    if (typeCol) {
      const parsedType = normalizeTransactionType(row[typeCol.rawHeader]);
      if (!parsedType) {
        validationErrors.push({
          rowNumber,
          field: 'type',
          rawValue: row[typeCol.rawHeader],
          message: `Unsupported or empty transaction type: "${row[typeCol.rawHeader] || ''}"`,
        });
        rowValid = false;
      } else {
        normalizedType = parsedType;
      }
    }

    let normalizedStatus: TransactionStatus = 'COMPLETED';
    if (statusCol) {
      const parsedStatus = normalizeTransactionStatus(row[statusCol.rawHeader]);
      if (!parsedStatus) {
        validationErrors.push({
          rowNumber,
          field: 'status',
          rawValue: row[statusCol.rawHeader],
          message: `Unsupported or empty transaction status: "${row[statusCol.rawHeader] || ''}"`,
        });
        rowValid = false;
      } else {
        normalizedStatus = parsedStatus;
      }
    }

    if (rowValid && parsedGross && isoDate) {
      const rawOrderId = orderIdCol ? row[orderIdCol.rawHeader] : undefined;
      const rawCaptureId = captureIdCol ? row[captureIdCol.rawHeader] : undefined;
      const rawInvoiceId = invoiceIdCol ? row[invoiceIdCol.rawHeader] : undefined;
      const rawRef = refCol ? row[refCol.rawHeader] : undefined;

      const normalizedTxn: PaymentTransaction = {
        id: `txn_${rawTxnId.trim()}`,
        paypalTransactionId: rawTxnId.trim(),
        paypalOrderId: rawOrderId ? rawOrderId.trim() : undefined,
        paypalCaptureId: rawCaptureId ? rawCaptureId.trim() : undefined,
        invoiceId: rawInvoiceId ? rawInvoiceId.trim() : undefined,
        merchantReference: rawRef ? rawRef.trim() : undefined,
        grossAmount: parsedGross,
        feeAmount: parsedFee,
        netAmount: parsedNet,
        currency: parsedCurrency,
        transactionType: normalizedType,
        transactionStatus: normalizedStatus,
        transactionTime: isoDate,
        source: 'PAYPAL_EXPORT',
        rawReference: `Row ${rowNumber}: ${rawTxnId.trim()}`,
      };

      normalizedRecords.push(normalizedTxn);
    }
  });

  return {
    datasetType: 'PAYPAL_TRANSACTIONS',
    totalRows: rows.length,
    validRows: normalizedRecords.length,
    invalidRows: rows.length - normalizedRecords.length,
    duplicateRows: duplicateCount,
    validationErrors,
    normalizedRecords,
    rawHeaders: headers,
    mappedColumns,
  };
}

