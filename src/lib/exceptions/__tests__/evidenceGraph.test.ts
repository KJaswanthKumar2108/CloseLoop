import { describe, it, expect } from 'vitest';
import {
  canonicalizeJson,
  computeContentHash,
  sanitizeTextValue,
  recursivelySanitize,
  sanitizeMerchantOrderEvidence,
  sanitizePaymentTransactionEvidence,
  isLuhnValid,
  MAX_RECURSION_DEPTH,
} from '../evidenceGraph';
import { MerchantOrder, PaymentTransaction } from '@/types/financial';

describe('Phase 3D.1: Evidence Graph & Sanitization Suite (Hardened per F-29)', () => {
  describe('Canonical JSON & Content Hashing', () => {
    it('produces identical canonical JSON strings regardless of key insertion order', () => {
      const obj1 = { z: 1, a: 'test', m: { b: 2, a: 1 } };
      const obj2 = { a: 'test', m: { a: 1, b: 2 }, z: 1 };

      const canonical1 = canonicalizeJson(obj1);
      const canonical2 = canonicalizeJson(obj2);

      expect(canonical1).toBe(canonical2);
      expect(canonical1).toBe('{"a":"test","m":{"a":1,"b":2},"z":1}');
    });

    it('computes identical SHA-256 content hashes for semantically equivalent payloads', () => {
      const payloadA = { orderId: 'ORD-123', amount: 1000, currency: 'USD' };
      const payloadB = { currency: 'USD', amount: 1000, orderId: 'ORD-123' };

      const hashA = computeContentHash(payloadA);
      const hashB = computeContentHash(payloadB);

      expect(hashA).toBe(hashB);
      expect(hashA).toHaveLength(64);
    });
  });

  describe('Synthetic PAN & PII/PCI Redaction (F-29)', () => {
    it('correctly verifies Luhn validity on synthetic numbers', () => {
      // Standard synthetic test numbers passing Luhn mod-10
      expect(isLuhnValid('4532015112830366')).toBe(true);
      expect(isLuhnValid('4532-0151-1283-0366')).toBe(true);
      // Non-Luhn number
      expect(isLuhnValid('4532015112830367')).toBe(false);
      // Short number
      expect(isLuhnValid('12345')).toBe(false);
    });

    it('redacts synthetic PANs anywhere in text strings while preserving last 4 digits', () => {
      const rawText = 'Customer paid with card 4532015112830366 at terminal 4';
      const sanitized = sanitizeTextValue(rawText);
      expect(sanitized).toBe('Customer paid with card [REDACTED_CARD_0366] at terminal 4');
    });

    it('redacts synthetic IBANs from text values', () => {
      const rawText = 'Transfer routed to GB29NWBK60161331926819 account';
      const sanitized = sanitizeTextValue(rawText);
      expect(sanitized).toBe('Transfer routed to [REDACTED_IBAN] account');
    });

    it('masks email addresses accurately', () => {
      expect(sanitizeTextValue('Contact alice@merchant.com for invoice')).toBe(
        'Contact a***@merchant.com for invoice'
      );
      expect(sanitizeTextValue('Single char e@test.org')).toBe('Single char *@test.org');
    });

    it('redacts bearer tokens, JWTs, and API credentials', () => {
      const bearerText = 'Authorization: Bearer mySecretToken12345.xyz';
      expect(sanitizeTextValue(bearerText)).toContain('[REDACTED_BEARER_TOKEN]');

      const jwtText = 'Session token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(sanitizeTextValue(jwtText)).toContain('[REDACTED_JWT]');

      const keyText = 'api_key=mock_test_token_scrub_sample_9988';
      expect(sanitizeTextValue(keyText)).toContain('[REDACTED_CREDENTIAL]');
    });
  });

  describe('Recursive Bounds & Metadata Allowlisting (F-29)', () => {
    it('enforces maximum recursion depth limit and truncates deeply nested payloads', () => {
      const deepObj: Record<string, unknown> = { level: 0 };
      let curr = deepObj;
      for (let i = 1; i <= 8; i++) {
        const next: Record<string, unknown> = { level: i };
        curr.child = next;
        curr = next;
      }

      const sanitized = recursivelySanitize(deepObj) as Record<string, unknown>;
      let traversed = sanitized;
      for (let i = 0; i < MAX_RECURSION_DEPTH; i++) {
        traversed = traversed.child as Record<string, unknown>;
      }
      expect(traversed.child).toBe('[TRUNCATED_MAX_DEPTH]');
    });

    it('guarantees sensitive values are redacted BEFORE clipping to prevent partial token leakage', () => {
      // Place a sensitive PAN starting near character 980
      const prefix = 'X'.repeat(980);
      const rawText = `${prefix} 4532015112830366 trailing text`;

      const sanitized = sanitizeTextValue(rawText);

      // The PAN must be fully redacted, never partially clipped into raw digits
      expect(sanitized).toContain('[REDACTED_CARD_0366]');
      expect(sanitized).not.toContain('453201511');
      expect(sanitized).toContain('[TRUNCATED_MAX_LENGTH]');
    });

    it('enforces payload byte limit using actual UTF-8 byte length for multi-byte characters', () => {
      // Create metadata with an array of multi-byte entries exceeding 64KB (65,536 bytes)
      const multiByteChunk = '🔥'.repeat(250); // 1,000 UTF-8 bytes
      const heavyArray = Array.from({ length: 80 }, () => multiByteChunk); // 80 * 1,000 = 80,000 bytes (> 64KB)

      const order: MerchantOrder = {
        id: 'ord-bytes-1',
        merchantOrderId: 'ORD-BYTES-01',
        externalReference: 'EXT-01',
        expectedAmount: { amountMinor: 5000, currency: 'USD', precision: 2 },
        currency: 'USD',
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
        orderStatus: 'CONFIRMED',
        paymentStatus: 'PAID',
        source: 'TEST',
        metadata: {
          notes: heavyArray,
        },
      };

      const sanitized = sanitizeMerchantOrderEvidence(order);
      expect(sanitized['[NOTICE]']).toBe('PAYLOAD_OVERSIZED_NON_ESSENTIALS_TRUNCATED');
      expect(sanitized.merchantOrderId).toBe('ORD-BYTES-01');
    });

    it('safely handles circular object references without throwing stack overflow', () => {
      const circularObj: Record<string, unknown> = { key: 'value' };
      circularObj.self = circularObj;

      const sanitized = recursivelySanitize(circularObj) as Record<string, unknown>;
      expect(sanitized.key).toBe('value');
      expect(sanitized.self).toBe('[CIRCULAR_REFERENCE]');
    });

    it('safely discards unsupported data types such as functions and symbols', () => {
      const unsupported = {
        fn: () => 'malicious',
        sym: Symbol('secret'),
        num: 42,
      };

      const sanitized = recursivelySanitize(unsupported) as Record<string, unknown>;
      expect(sanitized.fn).toBe('[UNSUPPORTED_DATA_TYPE]');
      expect(sanitized.sym).toBe('[UNSUPPORTED_DATA_TYPE]');
      expect(sanitized.num).toBe(42);
    });

    it('bounds individual string lengths to MAX_STRING_LENGTH (1,000 characters)', () => {
      const massiveString = 'A'.repeat(2000);
      const sanitized = sanitizeTextValue(massiveString);
      expect(sanitized.length).toBeLessThan(1100);
      expect(sanitized).toContain('[TRUNCATED_MAX_LENGTH]');
    });

    it('restricts metadata strictly to approved allowlist keys', () => {
      const order: MerchantOrder = {
        id: 'ord-uuid-1',
        merchantOrderId: 'ORD-999',
        externalReference: 'EXT-999',
        expectedAmount: { amountMinor: 10500, currency: 'USD', precision: 2 },
        currency: 'USD',
        createdAt: '2026-11-01T10:00:00Z',
        updatedAt: '2026-11-01T10:00:00Z',
        orderStatus: 'CONFIRMED',
        paymentStatus: 'PAID',
        source: 'SHOPIFY_STORE',
        metadata: {
          notes: 'Customer card 4532015112830366 requested express shipping',
          shipping_method: 'NEXT_DAY_AIR',
          unapproved_secret_token: 'should_be_dropped',
          client_ip_address: '10.0.0.1',
          tax_exempt: false,
        },
      };

      const sanitized = sanitizeMerchantOrderEvidence(order);
      const metadata = sanitized.safeMetadata as Record<string, unknown>;

      // Approved keys retained and sanitized recursively
      expect(metadata.notes).toBe('Customer card [REDACTED_CARD_0366] requested express shipping');
      expect(metadata.shipping_method).toBe('NEXT_DAY_AIR');
      expect(metadata.tax_exempt).toBe(false);

      // Unapproved keys dropped completely
      expect(metadata.unapproved_secret_token).toBeUndefined();
      expect(metadata.client_ip_address).toBeUndefined();
    });

    it('fails closed safely when unexpected errors occur during sanitization', () => {
      const circular: Record<string, unknown> = { orderId: 'ORD-CIRCULAR' };
      // Force non-standard structure
      const sanitized = sanitizeMerchantOrderEvidence(circular as unknown as MerchantOrder);
      expect(sanitized).toBeDefined();
    });
  });

  describe('Evidence Packaging Contracts', () => {
    it('packages payment transaction evidence without leaking internal raw references', () => {
      const txn: PaymentTransaction = {
        id: 'txn-uuid-1',
        paypalTransactionId: '9XY12345678',
        paypalOrderId: 'O-112233',
        paypalCaptureId: 'C-445566',
        invoiceId: 'INV-001',
        merchantReference: 'REF-001',
        grossAmount: { amountMinor: 10500, currency: 'USD', precision: 2 },
        feeAmount: { amountMinor: 325, currency: 'USD', precision: 2 },
        netAmount: { amountMinor: 10175, currency: 'USD', precision: 2 },
        currency: 'USD',
        transactionType: 'CAPTURE',
        transactionStatus: 'COMPLETED',
        transactionTime: '2026-11-01T10:00:05Z',
        source: 'PAYPAL_API',
        rawReference: 'internal_unfiltered_feed',
      };

      const sanitized = sanitizePaymentTransactionEvidence(txn);
      expect(sanitized.paypalTransactionId).toBe('9XY12345678');
      expect((sanitized as Record<string, unknown>).rawReference).toBeUndefined();
    });
  });
});
