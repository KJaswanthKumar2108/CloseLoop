/**
 * CloseLoop Phase 3D.2: AI Investigation Types
 * Defines vendor-neutral provider interfaces, request/response models,
 * error normalization, and structured investigation entities.
 */

export type AIProviderType = 'gemini' | 'mock';

export type ConfidenceCategory = 'HIGH' | 'MEDIUM' | 'LOW';

export type FactSourceType = 'OBSERVED_FACT' | 'DETERMINISTIC_DERIVATION';

export interface StructuredFinancialClaim {
  orderId?: string;
  transactionId?: string;
  captureId?: string;
  refundReference?: string;
  amountMinor?: number;
  currency?: string;
  transactionStatus?: string;
  timestamp?: string;
  merchantId?: string;
  customerId?: string;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface EstablishedFact {
  factId: string;
  description: string;
  sourceEvidenceIds: string[];
  classification: FactSourceType;
  structuredClaim?: StructuredFinancialClaim;
}

export interface AIInference {
  inferenceId: string;
  explanation: string;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidenceCategory: ConfidenceCategory;
  confidenceRationale: string;
  explicitUncertainty: string;
}

export interface MissingEvidence {
  item: string;
  whyItMatters: string;
  howToObtain: string;
}

export interface SuggestedInvestigativeStep {
  stepNumber: number;
  action: string;
  rationale: string;
  requiredVerification: string;
  operationalRiskOrLimitation: string;
}

export interface InvestigationSummary {
  conciseExplanation: string;
  primaryDiscrepancyCategory: string;
  investigationOutcome: string;
  criticalUnresolvedQuestions: string[];
}

export interface InvestigationResult {
  schemaVersion: '1.0';
  caseId: string;
  merchantId: string;
  caseVersion: number;
  investigatedAt: string; // ISO 8601
  summary: InvestigationSummary;
  establishedFacts: EstablishedFact[];
  inferences: AIInference[];
  missingEvidence: MissingEvidence[];
  suggestedSteps: SuggestedInvestigativeStep[];
  limitations: {
    unestablishedItems: string[];
    mandatoryHumanVerificationRequired: string[];
  };
  disclaimer: string;
}

export interface InvestigationEvidenceContextItem {
  evidenceId: string;
  evidenceType: string;
  sourceSystem: string;
  sourceRecordId: string;
  contentHash: string;
  isObservedFact: boolean;
  capturedAt: string;
  sanitizedPayload: Record<string, unknown>;
}

export interface BoundedInvestigationContext {
  caseId: string;
  merchantId: string;
  caseVersion: number;
  caseKey: string;
  discrepancyType: string;
  primaryReference: string;
  merchantOrderId: string | null;
  paypalTransactionId: string | null;
  varianceAmountMinor: number;
  expectedAmountMinor: number;
  actualAmountMinor: number;
  currency: string;
  currencyPrecision: number;
  initialVarianceAmountMinor?: number;
  evidenceFingerprint: string;
  evidenceItems: InvestigationEvidenceContextItem[];
  evidenceIdentifiers: string[];
  contextCreatedAt: string;
}

export interface SnapshotConsistencyMetadata {
  analyzedVersion: number;
  currentVersion: number;
  analyzedFingerprint: string;
  currentFingerprint: string;
  contextCreatedAt: string;
  checkedAt: string;
}

export interface AIProviderRequest {
  context: BoundedInvestigationContext;
  systemInstruction: string;
  userPrompt: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface AIProviderResponse {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  rawText: string;
  structuredResult: InvestigationResult;
  usage?: TokenUsage;
}

export class AIProviderError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly isRetryable: boolean;
  readonly provider: string;

  constructor(
    message: string,
    code = 'AI_PROVIDER_ERROR',
    httpStatus = 502,
    isRetryable = false,
    provider = 'unknown'
  ) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.isRetryable = isRetryable;
    this.provider = provider;
    Object.setPrototypeOf(this, AIProviderError.prototype);
  }
}

export interface AIProviderClient {
  readonly providerName: string;
  readonly modelName: string;

  investigate(request: AIProviderRequest): Promise<AIProviderResponse>;
}

