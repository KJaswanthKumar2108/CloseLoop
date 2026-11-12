import { MerchantOrder, OrderStatus, PaymentStatus } from '@/types/financial';
import { parseDecimalToMoney } from '../money';
import { parseCsvContent } from './csvNormalizer';
import {
  resolveColumn,
  parseAndValidateIsoTimestamp,
  DuplicateDetector,
} from './importValidation';
import { OrderImportResult, RowValidationError } from './importTypes';

const ORDER_COLUMN_CANDIDATES = {
  orderId: ['order_id', 'order id', 'merchant_order_id', 'order number', 'order #', 'orderid', 'id'],
  amount: ['amount', 'order amount', 'total', 'expected_amount', 'grand_total', 'gross amount', 'order_total'],
  currency: ['currency', 'currency_code', 'currency code', 'ccy'],
  date: ['date', 'order_date', 'created_at', 'order date', 'timestamp', 'created at', 'creation_date'],
  externalReference: ['external_reference', 'reference', 'ref', 'invoice_id', 'invoice number', 'payment_reference', 'custom_id'],
  customerReference: ['customer', 'customer_email', 'email', 'customer_name', 'customer_id', 'customer reference'],
  orderStatus: ['order_status', 'status', 'fulfillment_status'],
  paymentStatus: ['payment_status', 'pay_status'],
};

export function importMerchantOrdersCsv(csvContent: string): OrderImportResult {
  const { headers, rows, parseErrors } = parseCsvContent(csvContent);

  const validationErrors: RowValidationError[] = [];
  const mappedColumns: Record<string, string> = {};

  // Resolve required columns
  const orderIdCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.orderId);
  const amountCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.amount);
  const currencyCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.currency);
  const dateCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.date);

  // Optional columns
  const extRefCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.externalReference);
  const customerCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.customerReference);
  const orderStatusCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.orderStatus);
  const paymentStatusCol = resolveColumn(headers, ORDER_COLUMN_CANDIDATES.paymentStatus);

  if (orderIdCol) mappedColumns.orderId = orderIdCol.rawHeader;
  if (amountCol) mappedColumns.amount = amountCol.rawHeader;
  if (currencyCol) mappedColumns.currency = currencyCol.rawHeader;
  if (dateCol) mappedColumns.date = dateCol.rawHeader;
  if (extRefCol) mappedColumns.externalReference = extRefCol.rawHeader;
  if (customerCol) mappedColumns.customerReference = customerCol.rawHeader;
  if (orderStatusCol) mappedColumns.orderStatus = orderStatusCol.rawHeader;
  if (paymentStatusCol) mappedColumns.paymentStatus = paymentStatusCol.rawHeader;

  // Verify all required columns are present
  const missingRequiredColumns: string[] = [];
  if (!orderIdCol) missingRequiredColumns.push('Order ID (e.g. order_id, order number)');
  if (!amountCol) missingRequiredColumns.push('Amount (e.g. amount, total)');
  if (!currencyCol) missingRequiredColumns.push('Currency (e.g. currency, currency_code)');
  if (!dateCol) missingRequiredColumns.push('Date (e.g. date, created_at)');

  if (missingRequiredColumns.length > 0) {
    validationErrors.push({
      rowNumber: 1,
      field: 'headers',
      message: `Missing required columns: ${missingRequiredColumns.join(', ')}`,
    });
    return {
      datasetType: 'MERCHANT_ORDERS',
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

  // Include syntax parse errors from PapaParse
  for (const err of parseErrors) {
    validationErrors.push({
      rowNumber: err.row !== undefined ? err.row + 2 : 1, // 1-indexed plus header
      field: 'csv_syntax',
      message: err.message,
    });
  }

  const duplicateDetector = new DuplicateDetector();
  const normalizedRecords: MerchantOrder[] = [];
  let duplicateCount = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // Row 1 is header
    let rowValid = true;

    const rawOrderId = row[orderIdCol!.rawHeader];
    const rawAmount = row[amountCol!.rawHeader];
    const rawCurrency = row[currencyCol!.rawHeader];
    const rawDate = row[dateCol!.rawHeader];

    if (!rawOrderId || rawOrderId.trim() === '') {
      validationErrors.push({
        rowNumber,
        field: 'orderId',
        message: 'Order ID is required and cannot be empty',
      });
      rowValid = false;
    }

    if (rawOrderId && duplicateDetector.isDuplicate(rawOrderId)) {
      validationErrors.push({
        rowNumber,
        field: 'orderId',
        rawValue: rawOrderId,
        message: `Duplicate order ID detected: "${rawOrderId}"`,
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

    let parsedAmount;
    if (parsedCurrency) {
      try {
        parsedAmount = parseDecimalToMoney(rawAmount, parsedCurrency);
      } catch (err: unknown) {
        validationErrors.push({
          rowNumber,
          field: 'amount',
          rawValue: rawAmount,
          message: err instanceof Error ? err.message : 'Invalid monetary decimal value',
        });
        rowValid = false;
      }
    }

    const isoDate = parseAndValidateIsoTimestamp(rawDate || '');
    if (!isoDate) {
      validationErrors.push({
        rowNumber,
        field: 'date',
        rawValue: rawDate,
        message: `Cannot parse valid timestamp from: "${rawDate || ''}"`,
      });
      rowValid = false;
    }

    if (rowValid && parsedAmount && isoDate) {
      const rawExternalRef = extRefCol ? row[extRefCol.rawHeader] : undefined;
      const rawCustomer = customerCol ? row[customerCol.rawHeader] : undefined;
      const rawOrderStatus = orderStatusCol ? row[orderStatusCol.rawHeader] : undefined;
      const rawPayStatus = paymentStatusCol ? row[paymentStatusCol.rawHeader] : undefined;

      const normalizedOrder: MerchantOrder = {
        id: `ord_${rawOrderId.trim()}`,
        merchantOrderId: rawOrderId.trim(),
        externalReference: (rawExternalRef || rawOrderId).trim(),
        expectedAmount: parsedAmount,
        currency: parsedCurrency,
        createdAt: isoDate,
        updatedAt: isoDate,
        customerReference: rawCustomer ? rawCustomer.trim() : undefined,
        orderStatus: (rawOrderStatus?.toUpperCase() as OrderStatus) || 'CONFIRMED',
        paymentStatus: (rawPayStatus?.toUpperCase() as PaymentStatus) || 'PAID',
        source: 'MERCHANT_CSV',
        metadata: {
          csvRowNumber: rowNumber,
          originalRow: row,
        },
      };

      normalizedRecords.push(normalizedOrder);
    }
  });

  return {
    datasetType: 'MERCHANT_ORDERS',
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

