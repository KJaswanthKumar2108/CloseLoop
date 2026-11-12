/**
 * CloseLoop Phase 3D.2: Deterministic Mock AI Provider
 * Enables zero-cost, hermetic, 100% reproducible testing of the investigation engine
 * without requiring external network access or live API keys.
 *
 * Hardened per F-32 (Adversarial Financial Claim Grounding Tests).
 */

import {
  AIProviderClient,
  AIProviderRequest,
  AIProviderResponse,
  AIProviderError,
  InvestigationResult,
  EstablishedFact,
} from './types';
import { MANDATORY_INVESTIGATION_DISCLAIMER } from './schemas';
import { PROMPT_VERSION } from './promptDefense';

export interface MockProviderBehaviorOptions {
  simulateTimeout?: boolean;
  simulateRateLimitError?: boolean;
  simulateMalformedJson?: boolean;
  simulateHallucinatedCitation?: boolean;
  simulateInvalidSchema?: boolean;
  // F-32 Adversarial Grounding Simulation Options
  simulateInventedTransactionId?: boolean;
  simulateInventedAmount?: boolean;
  simulateInventedCurrency?: boolean;
  simulateInventedStatus?: boolean;
  simulateInventedTimestamp?: boolean;
}

export class MockAIProviderClient implements AIProviderClient {
  readonly providerName = 'mock';
  readonly modelName = 'mock-deterministic-v1';

  private options: MockProviderBehaviorOptions;

  constructor(options: MockProviderBehaviorOptions = {}) {
    this.options = options;
  }

  setOptions(options: MockProviderBehaviorOptions): void {
    this.options = { ...this.options, ...options };
  }

  async investigate(request: AIProviderRequest): Promise<AIProviderResponse> {
    const { context, abortSignal } = request;

    if (abortSignal?.aborted || this.options.simulateTimeout) {
      throw new AIProviderError(
        'Request to AI provider timed out or was aborted.',
        'PROVIDER_TIMEOUT',
        504,
        true,
        this.providerName
      );
    }

    if (this.options.simulateRateLimitError) {
      throw new AIProviderError(
        'AI provider rate limit reached (HTTP 429).',
        'RATE_LIMIT_EXCEEDED',
        429,
        true,
        this.providerName
      );
    }

    if (this.options.simulateMalformedJson) {
      return {
        provider: this.providerName,
        model: this.modelName,
        promptVersion: PROMPT_VERSION,
        schemaVersion: '1.0',
        rawText: 'MALFORMED_NON_JSON_CONTENT{{{',
        structuredResult: null as unknown as InvestigationResult,
      };
    }

    // Determine primary evidence citations from context
    const factEvidenceIds = this.options.simulateHallucinatedCitation
      ? ['hallucinated-fake-evidence-id-999']
      : [...context.evidenceItems.map((e) => e.evidenceId), context.caseId];

    const firstRecordId =
      context.evidenceItems[0]?.sourceRecordId || context.evidenceItems[0]?.evidenceId || context.caseId;

    let factDescription = `Authoritative discrepancy identified for reference ${context.primaryReference} with expected amount ${context.expectedAmountMinor} vs actual ${context.actualAmountMinor}.`;

    if (this.options.simulateInventedAmount) {
      factDescription = `Authoritative discrepancy asserted with invented amount $999.00 and variance of $999.00.`;
    } else if (this.options.simulateInventedTransactionId) {
      factDescription = `Discrepancy links to ungrounded transaction TXN-INVENTED-999.`;
    } else if (this.options.simulateInventedCurrency) {
      factDescription = `Discrepancy asserted in currency EUR instead of USD.`;
    } else if (this.options.simulateInventedStatus) {
      factDescription = `Discrepancy asserted with status CHARGED_BACK.`;
    } else if (this.options.simulateInventedTimestamp) {
      factDescription = `Discrepancy occurred at invented timestamp 1999-01-01T00:00:00Z.`;
    }

    const txnItem = context.evidenceItems.find(
      (e) =>
        e.sourceRecordId === context.paypalTransactionId ||
        (e.sanitizedPayload && e.sanitizedPayload.transactionId === context.paypalTransactionId)
    );

    const txnTimestamp = txnItem
      ? typeof txnItem.capturedAt === 'string'
        ? txnItem.capturedAt
        : undefined
      : undefined;

    const establishedFacts: EstablishedFact[] = [
      {
        factId: 'fact-1',
        description: factDescription,
        sourceEvidenceIds: factEvidenceIds,
        classification: 'OBSERVED_FACT',
        structuredClaim: {
          orderId: context.merchantOrderId || context.primaryReference,
          transactionId: this.options.simulateInventedTransactionId
            ? 'TXN-INVENTED-999'
            : context.paypalTransactionId || undefined,
          amountMinor: this.options.simulateInventedAmount ? 99900 : context.varianceAmountMinor,
          currency: this.options.simulateInventedCurrency ? 'EUR' : context.currency,
          transactionStatus: this.options.simulateInventedStatus
            ? 'CHARGED_BACK'
            : (context.evidenceItems.find((e) => e.sanitizedPayload?.transactionStatus)?.sanitizedPayload?.transactionStatus as string) || undefined,
          timestamp: this.options.simulateInventedTimestamp
            ? '1999-01-01T00:00:00Z'
            : txnTimestamp,
          merchantId: context.merchantId,
        },
      },
    ];

    const structuredResult: InvestigationResult = {
      schemaVersion: '1.0',
      caseId: context.caseId,
      merchantId: context.merchantId,
      caseVersion: context.caseVersion,
      investigatedAt: new Date().toISOString(),
      summary: {
        conciseExplanation: `Deterministic investigation of discrepancy ${context.discrepancyType} with variance of ${context.varianceAmountMinor} minor units.`,
        primaryDiscrepancyCategory: context.discrepancyType,
        investigationOutcome: 'Analysis complete. Key facts established and operator actions formulated.',
        criticalUnresolvedQuestions: [
          'Does merchant contract include a customized PayPal fee tier?',
        ],
      },
      establishedFacts,
      inferences: [
        {
          inferenceId: 'inf-1',
          explanation: `The financial variance of ${context.varianceAmountMinor} minor units aligns with typical rate tier differentials.`,
          supportingEvidenceIds: [firstRecordId],
          contradictingEvidenceIds: [],
          confidenceCategory: 'HIGH',
          confidenceRationale: 'Observed gross and net values match standard rate schedule.',
          explicitUncertainty: 'Merchant rate schedule contract agreement was not directly supplied in context.',
        },
      ],
      missingEvidence: [
        {
          item: 'Merchant Rate Schedule Agreement',
          whyItMatters: 'Confirms whether fee variance is an operational billing error or expected contractual tier.',
          howToObtain: 'Download merchant profile contract from PayPal business portal.',
        },
      ],
      suggestedSteps: [
        {
          stepNumber: 1,
          action: 'Verify PayPal Merchant Rate Schedule',
          rationale: 'Review merchant agreement on PayPal portal to verify effective fee tier.',
          requiredVerification: 'Check rate agreement PDF against transaction date.',
          operationalRiskOrLimitation: 'No financial risk; read-only verification.',
        },
      ],
      limitations: {
        unestablishedItems: [
          'Direct confirmation from merchant account manager regarding promotional rate.',
        ],
        mandatoryHumanVerificationRequired: [
          'Operator must verify fee schedule before approving any write-off.',
        ],
      },
      disclaimer: MANDATORY_INVESTIGATION_DISCLAIMER,
    };

    if (this.options.simulateInvalidSchema) {
      // Remove required field
      delete (structuredResult as unknown as Record<string, unknown>).summary;
    }

    return {
      provider: this.providerName,
      model: this.modelName,
      promptVersion: PROMPT_VERSION,
      schemaVersion: '1.0',
      rawText: JSON.stringify(structuredResult),
      structuredResult,
      usage: {
        promptTokens: 250,
        completionTokens: 180,
        totalTokens: 430,
      },
    };
  }
}
