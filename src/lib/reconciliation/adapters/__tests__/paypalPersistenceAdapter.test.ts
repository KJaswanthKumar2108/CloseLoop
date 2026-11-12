import { describe, it, expect } from 'vitest';
import {
  mapRecordToPaymentTransaction,
  mapAndFilterEligibleRecords,
} from '../paypalPersistenceAdapter';

describe('paypalPersistenceAdapter - Tier 2 Defense-in-Depth & Invariant Validation', () => {
  const baseValidCaptureRow: Record<string, unknown> = {
    id: 'f87b3240-5fa1-4dc7-a2f2-b88339f40001',
    paypal_transaction_id: 'CAPT-1001',
    fingerprint: 'fp-capt-1001',
    transaction_event_code: 'T0006',
    transaction_type: 'CAPTURE',
    transaction_status: 'COMPLETED',
    gross_amount_minor: 10500,
    currency: 'USD',
    currency_precision: 2,
    fee_amount_minor: 350,
    net_amount_minor: 10150,
    transaction_time: '2026-11-01T12:00:00Z',
    paypal_reference_id: null,
    paypal_reference_type: null,
    paypal_order_id: 'ORD-999',
    paypal_capture_id: null,
    invoice_id: 'INV-101',
    merchant_reference: 'MREF-1',
    reconciliation_eligible: true,
    reconciliation_eligibility_status: 'ELIGIBLE',
    identity_collision_status: 'NONE',
    raw_reference: 'raw-1001',
  };

  it('correctly maps a valid completed CAPTURE row to PaymentTransaction', () => {
    const { transaction, rejection } = mapRecordToPaymentTransaction(baseValidCaptureRow);

    expect(rejection).toBeNull();
    expect(transaction).not.toBeNull();
    expect(transaction?.paypalTransactionId).toBe('CAPT-1001');
    expect(transaction?.paypalCaptureId).toBeUndefined();
    expect(transaction?.paypalOrderId).toBe('ORD-999');
    expect(transaction?.grossAmount).toEqual({
      amountMinor: 10500,
      currency: 'USD',
      precision: 2,
    });
    expect(transaction?.feeAmount).toEqual({
      amountMinor: 350,
      currency: 'USD',
      precision: 2,
    });
    expect(transaction?.source).toBe('PAYPAL_API');
  });

  describe('F-08 & F-12: Refund Parent-Reference Invariants', () => {
    const baseRefundRow: Record<string, unknown> = {
      ...baseValidCaptureRow,
      id: 'f87b3240-5fa1-4dc7-a2f2-b88339f40002',
      paypal_transaction_id: 'REF-2001',
      transaction_event_code: 'T1107',
      transaction_type: 'REFUND',
      transaction_status: 'COMPLETED',
      gross_amount_minor: -2500,
      fee_amount_minor: -75,
      net_amount_minor: -2425,
      paypal_order_id: null,
      paypal_capture_id: null,
    };

    it('maps TXN parent reference to paypalCaptureId and leaves paypalOrderId undefined', () => {
      const row = {
        ...baseRefundRow,
        paypal_reference_type: 'TXN',
        paypal_reference_id: 'CAPT-1001',
        paypal_capture_id: 'CAPT-1001',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(rejection).toBeNull();
      expect(transaction?.paypalTransactionId).toBe('REF-2001');
      expect(transaction?.paypalCaptureId).toBe('CAPT-1001');
      expect(transaction?.paypalOrderId).toBeUndefined();
      expect(transaction?.grossAmount.amountMinor).toBe(-2500);
    });

    it('maps ODR parent reference to paypalOrderId and cleanses normalizer capture fallback', () => {
      const row = {
        ...baseRefundRow,
        paypal_reference_type: 'ODR',
        paypal_reference_id: 'ORD-5555',
        paypal_order_id: 'ORD-5555',
        paypal_capture_id: 'REF-2001', // Normalizer self-fallback present in captureId
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(rejection).toBeNull();
      expect(transaction?.paypalTransactionId).toBe('REF-2001');
      expect(transaction?.paypalOrderId).toBe('ORD-5555');
      expect(transaction?.paypalCaptureId).toBeUndefined();
    });

    it('fails closed when refund has a self-fallback ID equal to its own transaction ID', () => {
      const row = {
        ...baseRefundRow,
        paypal_reference_type: 'TXN',
        paypal_reference_id: 'REF-2001',
        paypal_capture_id: 'REF-2001',
        paypal_order_id: null,
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection).not.toBeNull();
      expect(rejection?.reason).toBe('REFUND_MISSING_PARENT_REFERENCE');
    });

    it('fails closed when refund references unsupported type: SUB (Subscription)', () => {
      const row = {
        ...baseRefundRow,
        paypal_reference_type: 'SUB',
        paypal_reference_id: 'I-SUB12345',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('REFUND_UNSUPPORTED_REFERENCE_TYPE');
    });

    it('fails closed when refund references unsupported type: CASE or DIS (Dispute)', () => {
      const row = {
        ...baseRefundRow,
        paypal_reference_type: 'DIS',
        paypal_reference_id: 'PP-D-9999',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('REFUND_UNSUPPORTED_REFERENCE_TYPE');
    });

    it('fails closed when refund has non-negative gross amount (>= 0)', () => {
      const row = {
        ...baseRefundRow,
        gross_amount_minor: 2500, // Invalid: refund must be negative
        paypal_reference_type: 'TXN',
        paypal_reference_id: 'CAPT-1001',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('NON_NEGATIVE_REFUND_AMOUNT');
    });

    it('fails closed when refund is in non-completed status (e.g. PENDING)', () => {
      const row = {
        ...baseRefundRow,
        transaction_status: 'PENDING',
        paypal_reference_type: 'TXN',
        paypal_reference_id: 'CAPT-1001',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('INELIGIBLE_NON_SETTLED');
    });
  });

  describe('Tier 2 Safety & Collision Quarantining', () => {
    it('quarantines records with identity_collision_status !== NONE', () => {
      const row = {
        ...baseValidCaptureRow,
        identity_collision_status: 'INTRA_BATCH_COLLISION',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('QUARANTINED_COLLISION');
    });

    it('rejects records where reconciliation_eligible !== true', () => {
      const row = {
        ...baseValidCaptureRow,
        reconciliation_eligible: false,
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('INELIGIBLE_NON_SETTLED');
    });

    it('rejects non-safe integer financial amounts (exceeding MAX_SAFE_INTEGER)', () => {
      const row = {
        ...baseValidCaptureRow,
        gross_amount_minor: Number.MAX_SAFE_INTEGER + 1000,
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('UNSAFE_FINANCIAL_AMOUNT');
    });

    it('rejects invalid currency codes', () => {
      const row = {
        ...baseValidCaptureRow,
        currency: 'INVALID_CCY',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('INVALID_CURRENCY');
    });

    it('rejects non-payment transaction types (e.g. AUTHORIZATION, DISPUTE_HOLD)', () => {
      const row = {
        ...baseValidCaptureRow,
        transaction_type: 'AUTHORIZATION',
      };

      const { transaction, rejection } = mapRecordToPaymentTransaction(row);

      expect(transaction).toBeNull();
      expect(rejection?.reason).toBe('INELIGIBLE_TRANSACTION_TYPE');
    });
  });

  describe('mapAndFilterEligibleRecords batch processing', () => {
    it('aggregates valid records and accurately tracks adapter rejections', () => {
      const rows = [
        baseValidCaptureRow,
        {
          ...baseValidCaptureRow,
          paypal_transaction_id: 'BAD-1',
          identity_collision_status: 'CROSS_BATCH_DISCREPANCY',
        },
        {
          ...baseValidCaptureRow,
          paypal_transaction_id: 'BAD-2',
          gross_amount_minor: -100, // Capture with negative amount
        },
      ];

      const result = mapAndFilterEligibleRecords(rows, 3);

      expect(result.totalEligibleCount).toBe(3);
      expect(result.transactions).toHaveLength(1);
      expect(result.adapterRejectedCount).toBe(2);
      expect(result.adapterRejections).toHaveLength(2);
      expect(result.adapterRejections[0].reason).toBe('QUARANTINED_COLLISION');
      expect(result.adapterRejections[1].reason).toBe('NON_POSITIVE_CAPTURE_AMOUNT');
    });
  });
});
