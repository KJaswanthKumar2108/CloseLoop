import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAIProviderClient } from '../mockProvider';
import { GeminiAIProviderClient } from '../geminiProvider';
import { resolveAIProviderClient } from '../provider';
import { AIProviderError, BoundedInvestigationContext } from '../types';

describe('Phase 3D.2: AI Provider Abstraction Suite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const sampleContext: BoundedInvestigationContext = {
    caseId: '00000000-0000-4000-8000-000000000001',
    merchantId: 'merchant_test_1',
    caseKey: 'v1_test_case_key_1',
    discrepancyType: 'FEE_VARIANCE',
    caseVersion: 1,
    varianceAmountMinor: 35,
    expectedAmountMinor: 290,
    actualAmountMinor: 325,
    currency: 'USD',
    currencyPrecision: 2,
    primaryReference: 'ORD-1001',
    merchantOrderId: 'ORD-1001',
    paypalTransactionId: 'TXN-9001',
    evidenceFingerprint: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    evidenceIdentifiers: ['ORD-1001', 'TXN-9001'],
    contextCreatedAt: '2026-11-01T10:00:10Z',
    evidenceItems: [
      {
        evidenceId: '00000000-0000-4000-8000-000000000011',
        evidenceType: 'MERCHANT_ORDER',
        sourceSystem: 'MERCHANT_CSV',
        sourceRecordId: 'ORD-1001',
        contentHash: 'hash1'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: '2026-11-01T10:00:00Z',
        sanitizedPayload: { orderId: 'ORD-1001', amountMinor: 10000 },
      },
      {
        evidenceId: '00000000-0000-4000-8000-000000000012',
        evidenceType: 'PAYPAL_TRANSACTION',
        sourceSystem: 'PAYPAL_DURABLE_LEDGER',
        sourceRecordId: 'TXN-9001',
        contentHash: 'hash2'.padStart(64, '0'),
        isObservedFact: true,
        capturedAt: '2026-11-01T10:00:05Z',
        sanitizedPayload: { transactionId: 'TXN-9001', feeMinor: 325 },
      },
    ],
  };

  describe('MockAIProviderClient Deterministic Behaviors', () => {
    it('produces valid deterministic investigation results', async () => {
      const mock = new MockAIProviderClient();
      const res = await mock.investigate({
        context: sampleContext,
        systemInstruction: 'System instruction',
        userPrompt: 'User prompt',
      });

      expect(res.provider).toBe('mock');
      expect(res.model).toBe('mock-deterministic-v1');
      expect(res.structuredResult.schemaVersion).toBe('1.0');
      expect(res.structuredResult.caseId).toBe(sampleContext.caseId);
      expect(res.structuredResult.summary.primaryDiscrepancyCategory).toBe(sampleContext.discrepancyType);
      expect(res.structuredResult.establishedFacts.length).toBeGreaterThan(0);
      expect(res.structuredResult.inferences.length).toBeGreaterThan(0);
      expect(res.structuredResult.disclaimer).toContain('advisory and require human verification');
    });

    it('simulates timeout failure with PROVIDER_TIMEOUT code', async () => {
      const mock = new MockAIProviderClient({ simulateTimeout: true });
      await expect(
        mock.investigate({
          context: sampleContext,
          systemInstruction: 'sys',
          userPrompt: 'usr',
        })
      ).rejects.toThrow(AIProviderError);

      try {
        await mock.investigate({
          context: sampleContext,
          systemInstruction: 'sys',
          userPrompt: 'usr',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(AIProviderError);
        expect((err as AIProviderError).code).toBe('PROVIDER_TIMEOUT');
        expect((err as AIProviderError).httpStatus).toBe(504);
      }
    });

    it('simulates rate limit failure with RATE_LIMIT_EXCEEDED code', async () => {
      const mock = new MockAIProviderClient({ simulateRateLimitError: true });
      try {
        await mock.investigate({
          context: sampleContext,
          systemInstruction: 'sys',
          userPrompt: 'usr',
        });
        expect.unreachable('Should have thrown RATE_LIMIT_EXCEEDED');
      } catch (err) {
        expect(err).toBeInstanceOf(AIProviderError);
        expect((err as AIProviderError).code).toBe('RATE_LIMIT_EXCEEDED');
        expect((err as AIProviderError).httpStatus).toBe(429);
      }
    });

    it('simulates malformed JSON failure with null structuredResult', async () => {
      const mock = new MockAIProviderClient({ simulateMalformedJson: true });
      const res = await mock.investigate({
        context: sampleContext,
        systemInstruction: 'sys',
        userPrompt: 'usr',
      });
      expect(res.rawText).toContain('MALFORMED_NON_JSON_CONTENT');
      expect(res.structuredResult).toBeNull();
    });

    it('simulates hallucinated citations when configured', async () => {
      const mock = new MockAIProviderClient({ simulateHallucinatedCitation: true });
      const res = await mock.investigate({
        context: sampleContext,
        systemInstruction: 'sys',
        userPrompt: 'usr',
      });
      expect(res.structuredResult.establishedFacts[0].sourceEvidenceIds).toContain(
        'hallucinated-fake-evidence-id-999'
      );
    });
  });

  describe('resolveAIProviderClient Factory', () => {
    it('uses providerOverride when explicitly supplied', () => {
      const customMock = new MockAIProviderClient();
      const resolved = resolveAIProviderClient(customMock);
      expect(resolved).toBe(customMock);
    });

    it('resolves MockAIProviderClient by default when no credentials set', () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.CLOSELOOP_AI_PROVIDER;
      delete process.env.AI_PROVIDER;

      const resolved = resolveAIProviderClient();
      expect(resolved.providerName).toBe('mock');
      expect(resolved).toBeInstanceOf(MockAIProviderClient);
    });

    it('resolves MockAIProviderClient when CLOSELOOP_AI_PROVIDER is mock', () => {
      process.env.CLOSELOOP_AI_PROVIDER = 'mock';
      process.env.GEMINI_API_KEY = 'mock_key_will_be_ignored';

      const resolved = resolveAIProviderClient();
      expect(resolved.providerName).toBe('mock');
    });

    it('throws error when gemini requested but GEMINI_API_KEY is missing', () => {
      process.env.CLOSELOOP_AI_PROVIDER = 'gemini';
      delete process.env.GEMINI_API_KEY;

      expect(() => resolveAIProviderClient()).toThrow(/GEMINI_API_KEY is not configured/);
    });

    it('resolves GeminiAIProviderClient when configured', () => {
      process.env.CLOSELOOP_AI_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY = 'test-gemini-key-12345';
      process.env.GEMINI_MODEL = 'gemini-2.5-flash';

      const resolved = resolveAIProviderClient();
      expect(resolved.providerName).toBe('gemini');
      expect(resolved.modelName).toBe('gemini-2.5-flash');
      expect(resolved).toBeInstanceOf(GeminiAIProviderClient);
    });
  });

  describe('GeminiAIProviderClient Credential Masking', () => {
    it('never exposes API key in thrown error messages', async () => {
      const secretKey = 'super-secret-gemini-key-xyz987';
      const gemini = new GeminiAIProviderClient(secretKey, 'gemini-2.5-flash', 1000);

      // Mock fetch to simulate an upstream error containing the key in url
      vi.stubGlobal('fetch', async (url: string) => {
        throw new Error(`Upstream network failed at ${url} using key ${secretKey}`);
      });

      try {
        await gemini.investigate({
          context: sampleContext,
          systemInstruction: 'sys',
          userPrompt: 'usr',
        });
        expect.unreachable('Should have failed');
      } catch (err) {
        expect(err).toBeInstanceOf(AIProviderError);
        const providerErr = err as AIProviderError;
        expect(providerErr.message).not.toContain(secretKey);
        expect(providerErr.message).toContain('[REDACTED_API_KEY]');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
