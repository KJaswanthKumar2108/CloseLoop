import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  validateSearchQueryParams,
  executeTransactionSearchPreview,
  TransactionSearchError,
  PAYPAL_TRANSACTION_SEARCH_URL,
  PAYPAL_REPORTING_LAG_NOTICE,
} from '@/lib/paypal/transactionSearch';
import {
  normalizePayPalTransactionDetail,
  normalizePayPalBatch,
} from '@/lib/paypal/normalizer';
import { paypalTransactionSearchResponseSchema } from '@/lib/paypal/transactionSchemas';
import { clearTokenCache, REQUIRED_TRANSACTION_SEARCH_SCOPE } from '@/lib/paypal/auth';
import { GET as getTransactionsRoute } from '@/app/api/paypal/transactions/route';
import { NextRequest } from 'next/server';
import { resetEnvCacheForTesting } from '@/lib/env';

describe('Phase 3B: PayPal Transaction Search & Normalization Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearTokenCache();
    resetEnvCacheForTesting();
    process.env = { ...originalEnv };
    process.env.PAYPAL_ENV = 'sandbox';
    process.env.PAYPAL_CLIENT_ID = 'test-client-id';
    process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
    vi.restoreAllMocks();
  });

  // =========================================================================
  // SUITE 1: Query Validation
  // =========================================================================
  describe('Suite 1: Query Validation', () => {
    it('1. Valid date range with RFC 3339 timestamps passes validation', () => {
      const valid = validateSearchQueryParams({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-15T23:59:59Z',
      });
      expect(valid.startDate).toBe('2026-11-01T00:00:00Z');
      expect(valid.endDate).toBe('2026-11-15T23:59:59Z');
      expect(valid.page).toBe(1);
      expect(valid.pageSize).toBe(100);
      expect(valid.maxPages).toBe(5);
    });

    it('2. Missing startDate throws 400 INVALID_PARAMETERS', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '',
          endDate: '2026-11-15T23:59:59Z',
        })
      ).toThrowError(TransactionSearchError);
    });

    it('3. Missing endDate throws 400 INVALID_PARAMETERS', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-11-01T00:00:00Z',
          endDate: '',
        })
      ).toThrowError(TransactionSearchError);
    });

    it('4. Invalid RFC 3339 timestamp (missing timezone) is rejected', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-11-01 00:00:00', // missing T and timezone
          endDate: '2026-11-15T23:59:59Z',
        })
      ).toThrowError(/not a valid RFC 3339 timestamp/);
    });

    it('5. endDate before startDate throws 400 INVALID_PARAMETERS', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-11-15T00:00:00Z',
          endDate: '2026-11-01T00:00:00Z',
        })
      ).toThrowError(/cannot be after endDate/);
    });

    it('6. Date range exceeding 31 days is rejected per PayPal reporting rules', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-10-01T00:00:00Z',
          endDate: '2026-11-05T00:00:00Z', // 35 days
        })
      ).toThrowError(/PayPal restricts Transaction Search to a maximum of 31 days/);
    });

    it('7. Page < 1 is rejected', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-11-01T00:00:00Z',
          endDate: '2026-11-15T00:00:00Z',
          page: 0,
        })
      ).toThrowError(/page must be an integer >= 1/);
    });

    it('8. Page size exceeding 500 is rejected', () => {
      expect(() =>
        validateSearchQueryParams({
          startDate: '2026-11-01T00:00:00Z',
          endDate: '2026-11-15T00:00:00Z',
          pageSize: 501,
        })
      ).toThrowError(/pageSize must be an integer between 1 and 500/);
    });

    it('9. Max pages requested is bounded by ABSOLUTE_MAX_PAGES (10)', () => {
      const valid = validateSearchQueryParams({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-15T00:00:00Z',
        maxPages: 100, // exceeds cap
      });
      expect(valid.maxPages).toBe(10);
    });
  });

  // =========================================================================
  // SUITE 2: Schema Validation of PayPal Reporting Responses
  // =========================================================================
  describe('Suite 2: Schema Validation of PayPal Reporting Responses', () => {
    it('10. Valid full response parses correctly', () => {
      const raw = {
        total_items: 2,
        total_pages: 1,
        page: 1,
        transaction_details: [
          {
            transaction_info: {
              transaction_id: 'TXN-001',
              transaction_event_code: 'T0000',
              transaction_amount: { currency_code: 'USD', value: '150.00' },
              fee_amount: { currency_code: 'USD', value: '-4.65' },
              net_amount: { currency_code: 'USD', value: '145.35' },
              transaction_status: 'S',
              transaction_initiation_date: '2026-11-05T12:00:00Z',
            },
          },
        ],
      };

      const result = paypalTransactionSearchResponseSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.total_items).toBe(2);
        expect(result.data.transaction_details).toHaveLength(1);
      }
    });

    it('11. Empty transaction list parses cleanly with default array', () => {
      const raw = { total_items: 0, total_pages: 0, page: 1 };
      const result = paypalTransactionSearchResponseSchema.safeParse(raw);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transaction_details).toHaveLength(0);
      }
    });

    it('12. Missing required transaction_id fails validation', () => {
      const raw = {
        transaction_details: [
          {
            transaction_info: {
              // transaction_id missing
              transaction_amount: { currency_code: 'USD', value: '10.00' },
            },
          },
        ],
      };
      const result = paypalTransactionSearchResponseSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });

    it('13. Malformed decimal amount fails schema parsing', () => {
      const raw = {
        transaction_details: [
          {
            transaction_info: {
              transaction_id: 'TXN-999',
              transaction_amount: { currency_code: 'USD', value: 'ABC_NOT_DECIMAL' },
            },
          },
        ],
      };
      const result = paypalTransactionSearchResponseSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });

    it('14. Invalid currency code (< 3 chars) fails schema parsing', () => {
      const raw = {
        transaction_details: [
          {
            transaction_info: {
              transaction_id: 'TXN-999',
              transaction_amount: { currency_code: 'US', value: '10.00' },
            },
          },
        ],
      };
      const result = paypalTransactionSearchResponseSchema.safeParse(raw);
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 3: Financial Normalization & Event Mapping (Strict Customer Allowlist)
  // =========================================================================
  describe('Suite 3: Financial Normalization & Event Mapping', () => {
    it('15. T0000 (General payment) + S normalizes to CAPTURE and COMPLETED with exact minor units', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-CAPTURE-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '150.00' },
          fee_amount: { currency_code: 'USD', value: '-4.65' },
          net_amount: { currency_code: 'USD', value: '145.35' },
          transaction_initiation_date: '2026-11-05T10:00:00Z',
          custom_field: 'ORD-1001',
          invoice_id: 'INV-1001',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        const tx = outcome.transaction;
        expect(tx.paypalTransactionId).toBe('TXN-CAPTURE-1');
        expect(tx.transactionType).toBe('CAPTURE');
        expect(tx.transactionStatus).toBe('COMPLETED');
        expect(tx.grossAmount.amountMinor).toBe(15000); // $150.00 -> 15000 minor units
        expect(tx.grossAmount.currency).toBe('USD');
        expect(tx.feeAmount?.amountMinor).toBe(-465); // -$4.65 -> -465 minor units
        expect(tx.netAmount?.amountMinor).toBe(14535); // $145.35 -> 14535 minor units
        expect(tx.merchantReference).toBe('ORD-1001');
        expect(tx.invoiceId).toBe('INV-1001');
        expect(tx.source).toBe('PAYPAL_API');
      }
    });

    it('16. T1107 (Refund) normalizes to REFUND type with negative debit amount', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-REFUND-1',
          paypal_reference_id: 'TXN-CAPTURE-1',
          transaction_event_code: 'T1107',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '-25.00' },
          transaction_initiation_date: '2026-11-06T11:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.transaction.transactionType).toBe('REFUND');
        expect(outcome.transaction.transactionStatus).toBe('COMPLETED');
        expect(outcome.transaction.grossAmount.amountMinor).toBe(-2500);
        expect(outcome.transaction.paypalCaptureId).toBe('TXN-CAPTURE-1');
      }
    });

    it('17. T1106 (Payment reversal) normalizes to REVERSAL type with negative debit amount', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-REV-1',
          transaction_event_code: 'T1106',
          transaction_status: 'V',
          transaction_amount: { currency_code: 'USD', value: '-100.00' },
          transaction_initiation_date: '2026-11-06T15:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.transaction.transactionType).toBe('REVERSAL');
        expect(outcome.transaction.transactionStatus).toBe('REVERSED');
        expect(outcome.transaction.grossAmount.amountMinor).toBe(-10000);
      }
    });

    it('18. T1201 (Chargeback / dispute) normalizes to DISPUTE_HOLD with negative debit amount', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-DISP-1',
          transaction_event_code: 'T1201',
          transaction_status: 'P',
          transaction_amount: { currency_code: 'USD', value: '-50.00' },
          transaction_initiation_date: '2026-11-07T09:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.transaction.transactionType).toBe('DISPUTE_HOLD');
        expect(outcome.transaction.transactionStatus).toBe('PENDING');
        expect(outcome.transaction.grossAmount.amountMinor).toBe(-5000);
      }
    });

    it('19. T1300 and T1301 normalize to AUTHORIZATION and NEVER to completed CAPTURE', () => {
      const auth1 = {
        transaction_info: {
          transaction_id: 'TXN-AUTH-1',
          transaction_event_code: 'T1300',
          transaction_status: 'P',
          transaction_amount: { currency_code: 'USD', value: '75.00' },
          transaction_initiation_date: '2026-11-07T10:30:00Z',
        },
      };
      const auth2 = {
        transaction_info: {
          transaction_id: 'TXN-AUTH-2',
          transaction_event_code: 'T1301',
          transaction_status: 'P',
          transaction_amount: { currency_code: 'USD', value: '75.00' },
          transaction_initiation_date: '2026-11-07T10:45:00Z',
        },
      };

      const res1 = normalizePayPalTransactionDetail(auth1);
      const res2 = normalizePayPalTransactionDetail(auth2);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      if (res1.success && res2.success) {
        expect(res1.transaction.transactionType).toBe('AUTHORIZATION');
        expect(res1.transaction.transactionType).not.toBe('CAPTURE');
        expect(res2.transaction.transactionType).toBe('AUTHORIZATION');
        expect(res2.transaction.transactionType).not.toBe('CAPTURE');
      }
    });

    it('20. Fee event codes (T0100, T0106, T0111) are NEVER CAPTURE and are rejected from customer reconciliation', () => {
      const feeCodes = ['T0100', 'T0106', 'T0111'];
      for (const code of feeCodes) {
        const detail = {
          transaction_info: {
            transaction_id: `TXN-FEE-${code}`,
            transaction_event_code: code,
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '-2.50' },
            transaction_initiation_date: '2026-11-07T10:00:00Z',
          },
        };
        const outcome = normalizePayPalTransactionDetail(detail);
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
          expect(outcome.status).toBe('REJECTED');
          expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
          expect(outcome.message).toContain(code);
        }
      }
    });

    it('21. Currency conversions (T0200, T0201) are NEVER FEE or CAPTURE and are rejected', () => {
      for (const code of ['T0200', 'T0201']) {
        const detail = {
          transaction_info: {
            transaction_id: `TXN-FX-${code}`,
            transaction_event_code: code,
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '-100.00' },
            transaction_initiation_date: '2026-11-07T10:00:00Z',
          },
        };
        const outcome = normalizePayPalTransactionDetail(detail);
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
          expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
          expect(outcome.message).toContain('Currency conversion');
        }
      }
    });

    it('22. Account funding / bank deposits (T0300-T0303) never become customer captures or payouts and are rejected', () => {
      const depositCodes = ['T0300', 'T0301', 'T0302', 'T0303'];
      for (const code of depositCodes) {
        const detail = {
          transaction_info: {
            transaction_id: `TXN-DEP-${code}`,
            transaction_event_code: code,
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '500.00' },
            transaction_initiation_date: '2026-11-07T10:00:00Z',
          },
        };
        const outcome = normalizePayPalTransactionDetail(detail);
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
          expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
          expect(outcome.message).toContain('Account funding');
        }
      }
    });

    it('23. Bank withdrawal (T0400) is NEVER AUTHORIZATION and is rejected', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-SWEEP-1',
          transaction_event_code: 'T0400',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '-1000.00' },
          transaction_initiation_date: '2026-11-07T11:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        expect(outcome.message).toContain('Bank withdrawal');
      }
    });

    it('24. Hold reversal (T1105) and Fee reversal (T1108) never become customer payment REVERSAL and are rejected', () => {
      for (const code of ['T1105', 'T1108']) {
        const detail = {
          transaction_info: {
            transaction_id: `TXN-REV-ADJ-${code}`,
            transaction_event_code: code,
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '10.00' },
            transaction_initiation_date: '2026-11-07T11:00:00Z',
          },
        };
        const outcome = normalizePayPalTransactionDetail(detail);
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
          expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        }
      }
    });

    it('25. Chargeback reimbursement (T1202) and Charge-off (T1203) never become active DISPUTE_HOLD and are rejected', () => {
      for (const code of ['T1202', 'T1203']) {
        const detail = {
          transaction_info: {
            transaction_id: `TXN-DISP-ADJ-${code}`,
            transaction_event_code: code,
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '50.00' },
            transaction_initiation_date: '2026-11-07T11:00:00Z',
          },
        };
        const outcome = normalizePayPalTransactionDetail(detail);
        expect(outcome.success).toBe(false);
        if (!outcome.success) {
          expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        }
      }
    });

    it('26. Authorization void (T1302) is NEVER CAPTURE or REFUND and is rejected', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-VOID-1',
          transaction_event_code: 'T1302',
          transaction_status: 'V',
          transaction_amount: { currency_code: 'USD', value: '0.00' },
          transaction_initiation_date: '2026-11-07T11:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        expect(outcome.message).toContain('Authorization void');
      }
    });

    it('27. Mass Pay payout (T0001) is excluded from customer payment reconciliation', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-MASSPAY-1',
          transaction_event_code: 'T0001',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '-200.00' },
          transaction_initiation_date: '2026-11-07T11:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        expect(outcome.message).toContain('Mass Pay payout');
      }
    });

    it('28. Unknown event code (e.g. T9999) produces explicit UNSUPPORTED_EVENT_CODE rejection', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-UNKNOWN-1',
          transaction_event_code: 'T9999',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '50.00' },
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.status).toBe('REJECTED');
        expect(outcome.reason).toBe('UNSUPPORTED_EVENT_CODE');
        expect(outcome.message).toContain('T9999');
      }
    });

    it('29. Status "F" is NOT an official PayPal reporting status and is rejected as UNMAPPED_STATUS', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-FAIL-1',
          transaction_event_code: 'T0000',
          transaction_status: 'F', // invalid status
          transaction_amount: { currency_code: 'USD', value: '50.00' },
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.status).toBe('REJECTED');
        expect(outcome.reason).toBe('UNMAPPED_STATUS');
        expect(outcome.message).toContain('Status "F" is not an official PayPal reporting status');
      }
    });

    it('30. Unknown status string is rejected as UNMAPPED_STATUS', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-UNKNOWN-STATUS',
          transaction_event_code: 'T0000',
          transaction_status: 'UNKNOWN_CUSTOM_STATUS',
          transaction_amount: { currency_code: 'USD', value: '50.00' },
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('UNMAPPED_STATUS');
      }
    });

    it('31. Directional consistency: negative T0000 (CAPTURE) is rejected as INVALID_AMOUNT', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-DIR-CONFLICT-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '-50.00' }, // invalid negative capture
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('INVALID_AMOUNT');
        expect(outcome.message).toContain('Directional conflict: CAPTURE transaction must have a positive gross amount');
      }
    });

    it('32. Directional consistency: positive T1107 (REFUND) is rejected as INVALID_AMOUNT', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-DIR-CONFLICT-2',
          transaction_event_code: 'T1107',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '50.00' }, // invalid positive refund
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('INVALID_AMOUNT');
        expect(outcome.message).toContain('Directional conflict: REFUND transaction must have a negative gross amount');
      }
    });

    it('33. Directional consistency: zero amount (0.00) is rejected as INVALID_AMOUNT', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-ZERO-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '0.00' },
          transaction_initiation_date: '2026-11-07T12:00:00Z',
        },
      };
      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(false);
      if (!outcome.success) {
        expect(outcome.reason).toBe('INVALID_AMOUNT');
      }
    });

    it('34. Stable identity: Composite ID is identical across repeated normalization calls', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-STABLE-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '120.00' },
          transaction_initiation_date: '2026-11-08T10:00:00Z',
        },
      };

      const out1 = normalizePayPalTransactionDetail(detail);
      const out2 = normalizePayPalTransactionDetail(detail);
      expect(out1.success).toBe(true);
      expect(out2.success).toBe(true);
      if (out1.success && out2.success) {
        expect(out1.transaction.id).toBe(out2.transaction.id);
      }
    });

    it('35. Stable identity: Composite ID is completely independent of array index and pagination parameters', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-PAGING-TEST',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '88.00' },
          transaction_initiation_date: '2026-11-08T10:00:00Z',
        },
      };
      const dummy = {
        transaction_info: {
          transaction_id: 'TXN-DUMMY',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '10.00' },
          transaction_initiation_date: '2026-11-08T09:00:00Z',
        },
      };

      // In batch 1, detail is at index 0
      const batchAtZero = normalizePayPalBatch([detail]);
      // In batch 2, detail is at index 1 after dummy record
      const batchAtOne = normalizePayPalBatch([dummy, detail]);

      expect(batchAtZero.normalized[0].id).toBe(batchAtOne.normalized[1].id);
      expect(batchAtZero.normalized[0].id).not.toMatch(/:0$/);
      expect(batchAtOne.normalized[1].id).not.toMatch(/:1$/);
    });

    it('36. Stable identity: Adding unrelated records does not change any existing record composite ID', () => {
      const recordA = {
        transaction_info: {
          transaction_id: 'TXN-A',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '50.00' },
          transaction_initiation_date: '2026-11-08T10:00:00Z',
        },
      };
      const recordB = {
        transaction_info: {
          transaction_id: 'TXN-B',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'USD', value: '75.00' },
          transaction_initiation_date: '2026-11-08T11:00:00Z',
        },
      };

      const batchSolo = normalizePayPalBatch([recordA]);
      const batchWithB = normalizePayPalBatch([recordB, recordA]);

      expect(batchSolo.normalized[0].id).toBe(batchWithB.normalized[1].id);
    });

    it('37. Duplicate transaction IDs with different event codes produce unique composite IDs without collision', () => {
      const details = [
        {
          transaction_info: {
            transaction_id: 'TXN-DUP-SHARED',
            transaction_event_code: 'T0000', // Capture
            transaction_status: 'S',
            transaction_amount: { currency_code: 'USD', value: '100.00' },
            transaction_initiation_date: '2026-11-08T10:00:00Z',
          },
        },
        {
          transaction_info: {
            transaction_id: 'TXN-DUP-SHARED',
            transaction_event_code: 'T1106', // Reversal
            transaction_status: 'V',
            transaction_amount: { currency_code: 'USD', value: '-100.00' },
            transaction_initiation_date: '2026-11-08T10:05:00Z',
          },
        },
      ];

      const batch = normalizePayPalBatch(details);
      expect(batch.normalized).toHaveLength(2);
      expect(batch.rejected).toHaveLength(0);

      // Distinct composite IDs
      expect(batch.normalized[0].id).not.toBe(batch.normalized[1].id);
      // But preserving exact paypalTransactionId
      expect(batch.normalized[0].paypalTransactionId).toBe('TXN-DUP-SHARED');
      expect(batch.normalized[1].paypalTransactionId).toBe('TXN-DUP-SHARED');
      expect(batch.normalized[0].transactionType).toBe('CAPTURE');
      expect(batch.normalized[1].transactionType).toBe('REVERSAL');
    });

    it('38. Zero-decimal currency (JPY) handles exact minor unit precision (¥500 -> 500 minor units)', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-JPY-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'JPY', value: '500' },
          transaction_initiation_date: '2026-11-08T10:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.transaction.grossAmount.amountMinor).toBe(500);
        expect(outcome.transaction.grossAmount.precision).toBe(0);
      }
    });

    it('39. Three-decimal currency (BHD) handles exact minor unit precision (12.500 -> 12500 minor units)', () => {
      const detail = {
        transaction_info: {
          transaction_id: 'TXN-BHD-1',
          transaction_event_code: 'T0000',
          transaction_status: 'S',
          transaction_amount: { currency_code: 'BHD', value: '12.500' },
          transaction_initiation_date: '2026-11-08T10:00:00Z',
        },
      };

      const outcome = normalizePayPalTransactionDetail(detail);
      expect(outcome.success).toBe(true);
      if (outcome.success) {
        expect(outcome.transaction.grossAmount.amountMinor).toBe(12500);
        expect(outcome.transaction.grossAmount.precision).toBe(3);
      }
    });
  });

  // =========================================================================
  // SUITE 4: API Execution, Resilience & Pagination
  // =========================================================================
  describe('Suite 4: API Execution, Resilience & Pagination', () => {
    it('25. executeTransactionSearchPreview targets correct Sandbox endpoint and headers', async () => {
      let capturedUrl = '';
      let capturedHeaders: HeadersInit | undefined;

      const mockFetch = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        // First call: OAuth token
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'OAUTH_TOKEN_XYZ',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }

        // Second call: Transaction Search
        capturedUrl = url;
        capturedHeaders = init.headers;
        return new Response(
          JSON.stringify({
            total_items: 1,
            total_pages: 1,
            page: 1,
            transaction_details: [
              {
                transaction_info: {
                  transaction_id: 'TXN-API-1',
                  transaction_event_code: 'T0000',
                  transaction_status: 'S',
                  transaction_amount: { currency_code: 'USD', value: '250.00' },
                  transaction_initiation_date: '2026-11-05T12:00:00Z',
                },
              },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await executeTransactionSearchPreview({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-08T00:00:00Z',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(capturedUrl).toContain(PAYPAL_TRANSACTION_SEARCH_URL);
      expect(capturedUrl).toContain('start_date=2026-11-01T00%3A00%3A00Z');
      expect((capturedHeaders as Record<string, string>)['Authorization']).toBe(
        'Bearer OAUTH_TOKEN_XYZ'
      );
      expect(result.provider).toBe('PayPal');
      expect(result.environment).toBe('sandbox');
      expect(result.records.normalizedCount).toBe(1);
      expect(result.lagNotice).toBe(PAYPAL_REPORTING_LAG_NOTICE);
    });

    it('26. Multi-page bounded pagination iterates up to total_pages', async () => {
      let pageRequests = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'TOKEN_PAGING',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }

        pageRequests++;
        return new Response(
          JSON.stringify({
            total_items: 4,
            total_pages: 2,
            page: pageRequests,
            transaction_details: [
              {
                transaction_info: {
                  transaction_id: `TXN-PAGE-${pageRequests}`,
                  transaction_event_code: 'T0000',
                  transaction_status: 'S',
                  transaction_amount: { currency_code: 'USD', value: '50.00' },
                  transaction_initiation_date: '2026-11-05T12:00:00Z',
                },
              },
            ],
          }),
          { status: 200 }
        );
      });

      const result = await executeTransactionSearchPreview({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-08T00:00:00Z',
        maxPages: 5,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(pageRequests).toBe(2); // exactly 2 pages fetched
      expect(result.pagination.pagesFetched).toBe(2);
      expect(result.records.normalizedCount).toBe(2);
    });

    it('27. Pagination safely halts when page returns 0 items', async () => {
      let pageRequests = 0;
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'TOKEN',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }

        pageRequests++;
        return new Response(
          JSON.stringify({
            total_items: 10,
            total_pages: 5, // claims 5 pages, but page 1 is empty
            page: 1,
            transaction_details: [],
          }),
          { status: 200 }
        );
      });

      const result = await executeTransactionSearchPreview({
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-08T00:00:00Z',
        maxPages: 5,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(pageRequests).toBe(1); // halts after first empty page
      expect(result.records.totalRetrieved).toBe(0);
    });

    it('28. HTTP 429 returns sanitized RATE_LIMITED error', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'TOKEN',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }
        return new Response('Rate Limit Exceeded', { status: 429 });
      });

      await expect(
        executeTransactionSearchPreview({
          startDate: '2026-11-01T00:00:00Z',
          endDate: '2026-11-08T00:00:00Z',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/rate limit reached/i);
    });

    it('29. HTTP 5xx returns SERVICE_UNAVAILABLE', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'TOKEN',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }
        return new Response('PayPal Reporting Internal Error', { status: 503 });
      });

      await expect(
        executeTransactionSearchPreview({
          startDate: '2026-11-01T00:00:00Z',
          endDate: '2026-11-08T00:00:00Z',
          fetchFn: mockFetch as unknown as typeof fetch,
        })
      ).rejects.toThrowError(/service is temporarily unavailable/i);
    });
  });

  // =========================================================================
  // SUITE 5: Route Endpoint & Zero Secret Leakage
  // =========================================================================
  describe('Suite 5: Route Endpoint & Zero Secret Leakage', () => {
    it('30. GET /api/paypal/transactions returns 200 and never exposes tokens or secrets', async () => {
      const originalGlobalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/v1/oauth2/token')) {
          return new Response(
            JSON.stringify({
              scope: REQUIRED_TRANSACTION_SEARCH_SCOPE,
              access_token: 'SECRET_ACCESS_TOKEN_FORBIDDEN_LEAK',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            total_items: 1,
            total_pages: 1,
            page: 1,
            transaction_details: [
              {
                transaction_info: {
                  transaction_id: 'TXN-SAFE-100',
                  transaction_event_code: 'T0000',
                  transaction_status: 'S',
                  transaction_amount: { currency_code: 'USD', value: '99.99' },
                  transaction_initiation_date: '2026-11-05T12:00:00Z',
                },
              },
            ],
          }),
          { status: 200 }
        );
      });

      try {
        const req = new NextRequest(
          'http://localhost:3000/api/paypal/transactions?startDate=2026-11-01T00:00:00Z&endDate=2026-11-08T00:00:00Z'
        );
        const res = await getTransactionsRoute(req);
        const json = await res.json();
        const serialized = JSON.stringify(json);

        expect(res.status).toBe(200);
        expect(json.provider).toBe('PayPal');
        expect(json.environment).toBe('sandbox');
        expect(json.records.normalizedCount).toBe(1);

        // Security assertions
        expect(serialized).not.toContain('SECRET_ACCESS_TOKEN_FORBIDDEN_LEAK');
        expect(serialized).not.toContain('test-client-secret');
        expect(serialized).not.toContain('Bearer ');
        expect(json.access_token).toBeUndefined();
      } finally {
        global.fetch = originalGlobalFetch;
      }
    });

    it('31. GET /api/paypal/transactions missing parameters returns 400', async () => {
      const req = new NextRequest('http://localhost:3000/api/paypal/transactions');
      const res = await getTransactionsRoute(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('INVALID_PARAMETERS');
    });
  });
});

