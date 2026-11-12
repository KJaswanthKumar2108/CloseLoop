import { describe, it, expect } from 'vitest';
import {
  importMerchantOrdersCsv,
  importPayPalTransactionsCsv,
  stripBom,
} from '../importer';

describe('CSV Importers', () => {
  describe('stripBom', () => {
    it('removes UTF-8 BOM if present', () => {
      const withBom = '\uFEFForder_id,amount,currency,date\n101,10.00,USD,2026-11-01T10:00:00Z';
      expect(stripBom(withBom).startsWith('order_id')).toBe(true);
    });
  });

  describe('importMerchantOrdersCsv', () => {
    it('parses valid merchant order CSV with standard headers', () => {
      const csv = `order_id,amount,currency,date,customer,external_reference
ORD-1001,150.00,USD,2026-11-01T12:00:00Z,alice@example.com,INV-001
ORD-1002,299.99,EUR,2026-11-02T14:30:00Z,bob@example.com,INV-002`;

      const result = importMerchantOrdersCsv(csv);
      expect(result.validRows).toBe(2);
      expect(result.invalidRows).toBe(0);
      expect(result.duplicateRows).toBe(0);
      expect(result.normalizedRecords).toHaveLength(2);

      const ord1 = result.normalizedRecords[0];
      expect(ord1.merchantOrderId).toBe('ORD-1001');
      expect(ord1.expectedAmount.amountMinor).toBe(15000);
      expect(ord1.expectedAmount.currency).toBe('USD');
      expect(ord1.expectedAmount.precision).toBe(2);
      expect(ord1.customerReference).toBe('alice@example.com');
      expect(ord1.externalReference).toBe('INV-001');
    });

    it('handles alternative header casing and aliases', () => {
      const csv = `"Order #","Order Amount","Currency Code","Created At"
"ORD-99","50.25","USD","2026-11-05T08:00:00Z"`;

      const result = importMerchantOrdersCsv(csv);
      expect(result.validRows).toBe(1);
      expect(result.normalizedRecords[0].expectedAmount.amountMinor).toBe(5025);
    });

    it('detects duplicate order IDs and reports row number', () => {
      const csv = `order_id,amount,currency,date
ORD-1001,100.00,USD,2026-11-01T10:00:00Z
ORD-1001,100.00,USD,2026-11-01T11:00:00Z`;

      const result = importMerchantOrdersCsv(csv);
      expect(result.validRows).toBe(1);
      expect(result.invalidRows).toBe(1);
      expect(result.duplicateRows).toBe(1);
      expect(result.validationErrors[0].rowNumber).toBe(3); // Row 3
      expect(result.validationErrors[0].message).toContain('Duplicate order ID detected');
    });

    it('rejects CSV when required columns are missing', () => {
      const csv = `order_id,customer\n101,alice`;
      const result = importMerchantOrdersCsv(csv);
      expect(result.validRows).toBe(0);
      expect(result.validationErrors[0].message).toContain('Missing required columns');
    });

    it('reports row numbers for invalid monetary amounts', () => {
      const csv = `order_id,amount,currency,date
ORD-1,invalid_amt,USD,2026-11-01T10:00:00Z`;

      const result = importMerchantOrdersCsv(csv);
      expect(result.validRows).toBe(0);
      expect(result.invalidRows).toBe(1);
      expect(result.validationErrors[0].rowNumber).toBe(2);
      expect(result.validationErrors[0].field).toBe('amount');
    });
  });

  describe('importPayPalTransactionsCsv', () => {
    it('parses valid PayPal transaction CSV with fee and net amounts', () => {
      const csv = `Transaction ID,Gross,Fee,Net,Currency,Date,Type,Status,Custom Number
TXN-101,120.00,-4.68,115.32,USD,2026-11-01T10:00:00Z,Payment,Completed,ORD-1001
TXN-102,-50.00,0.00,-50.00,USD,2026-11-02T11:00:00Z,Refund,Completed,ORD-1001`;

      const result = importPayPalTransactionsCsv(csv);
      expect(result.validRows).toBe(2);
      expect(result.invalidRows).toBe(0);
      expect(result.normalizedRecords).toHaveLength(2);

      const txn1 = result.normalizedRecords[0];
      expect(txn1.paypalTransactionId).toBe('TXN-101');
      expect(txn1.grossAmount.amountMinor).toBe(12000);
      expect(txn1.feeAmount?.amountMinor).toBe(-468);
      expect(txn1.netAmount?.amountMinor).toBe(11532);
      expect(txn1.transactionType).toBe('CAPTURE');
      expect(txn1.transactionStatus).toBe('COMPLETED');
      expect(txn1.merchantReference).toBe('ORD-1001');

      const txn2 = result.normalizedRecords[1];
      expect(txn2.transactionType).toBe('REFUND');
      expect(txn2.grossAmount.amountMinor).toBe(-5000);
    });

    it('detects duplicate PayPal transaction IDs', () => {
      const csv = `txn_id,amount,currency,timestamp
TXN-999,10.00,USD,2026-11-01T10:00:00Z
TXN-999,10.00,USD,2026-11-01T10:00:00Z`;

      const result = importPayPalTransactionsCsv(csv);
      expect(result.validRows).toBe(1);
      expect(result.duplicateRows).toBe(1);
    });

    it('handles separate Date and Time columns in PayPal exports', () => {
      const csv = `Transaction ID,Gross,Currency,Date,Time
TXN-200,75.00,USD,2026-11-05,14:30:00`;

      const result = importPayPalTransactionsCsv(csv);
      expect(result.validRows).toBe(1);
      expect(result.normalizedRecords[0].transactionTime).toContain('2026-11-05');
    });
  });
});

