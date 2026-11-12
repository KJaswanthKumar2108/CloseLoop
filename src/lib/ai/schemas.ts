/**
 * CloseLoop Phase 3D.2: Structured Investigation Output Validation Schemas
 * Versioned Zod schemas and relational financial evidence grounding verifier (F-32).
 */

import { z } from 'zod';
import {
  BoundedInvestigationContext,
  InvestigationResult,
  InvestigationEvidenceContextItem,
} from './types';

export const MANDATORY_INVESTIGATION_DISCLAIMER =
  'AI-generated investigation. Findings are advisory and require human verification. No payment, refund, settlement, or ledger operation has been executed.';

export const ConfidenceCategorySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export const FactClassificationSchema = z.enum(['OBSERVED_FACT', 'DETERMINISTIC_DERIVATION']);

export const StructuredFinancialClaimSchema = z.object({
  orderId: z.string().optional(),
  transactionId: z.string().optional(),
  captureId: z.string().optional(),
  refundReference: z.string().optional(),
  amountMinor: z.number().int().optional(),
  currency: z.string().optional(),
  transactionStatus: z.string().optional(),
  timestamp: z.union([z.string(), z.date().transform((d) => d.toISOString())]).optional(),
  merchantId: z.string().optional(),
  customerId: z.string().optional(),
});

export const EstablishedFactSchema = z.object({
  factId: z.string().min(1),
  description: z.string().min(5),
  sourceEvidenceIds: z.array(z.string()).min(1),
  classification: FactClassificationSchema,
  structuredClaim: StructuredFinancialClaimSchema.optional(),
});

export const AIInferenceSchema = z.object({
  inferenceId: z.string().min(1),
  explanation: z.string().min(10),
  supportingEvidenceIds: z.array(z.string()).min(1),
  contradictingEvidenceIds: z.array(z.string()).default([]),
  confidenceCategory: ConfidenceCategorySchema,
  confidenceRationale: z.string().min(5),
  explicitUncertainty: z.string().min(5),
});

export const MissingEvidenceSchema = z.object({
  item: z.string().min(3),
  whyItMatters: z.string().min(5),
  howToObtain: z.string().min(5),
});

export const SuggestedInvestigativeStepSchema = z.object({
  stepNumber: z.number().int().min(1),
  action: z.string().min(5),
  rationale: z.string().min(5),
  requiredVerification: z.string().min(5),
  operationalRiskOrLimitation: z.string().min(5),
});

export const InvestigationSummarySchema = z.object({
  conciseExplanation: z.string().min(10),
  primaryDiscrepancyCategory: z.string().min(2),
  investigationOutcome: z.string().min(5),
  criticalUnresolvedQuestions: z.array(z.string()).default([]),
});

export const InvestigationLimitationsSchema = z.object({
  unestablishedItems: z.array(z.string()).default([]),
  mandatoryHumanVerificationRequired: z.array(z.string()).min(1),
});

export const InvestigationResultSchema = z.object({
  schemaVersion: z.literal('1.0'),
  caseId: z.string().uuid(),
  merchantId: z.string().min(1),
  caseVersion: z.number().int().min(1),
  investigatedAt: z.string().datetime(),
  summary: InvestigationSummarySchema,
  establishedFacts: z.array(EstablishedFactSchema).min(1),
  inferences: z.array(AIInferenceSchema).min(1),
  missingEvidence: z.array(MissingEvidenceSchema).default([]),
  suggestedSteps: z.array(SuggestedInvestigativeStepSchema).min(1),
  limitations: InvestigationLimitationsSchema,
  disclaimer: z.string().refine(
    (val) => val.includes('Findings are advisory and require human verification'),
    {
      message: 'Mandatory advisory disclaimer must be preserved.',
    }
  ),
});

export class GroundingValidationError extends Error {
  readonly code = 'GROUNDING_VALIDATION_FAILED';
  readonly invalidEvidenceCitations: string[];
  readonly invalidFinancialClaims: string[];

  constructor(invalidCitations: string[] = [], invalidClaims: string[] = []) {
    const details = [
      invalidCitations.length > 0 ? `Ungrounded evidence IDs: [${invalidCitations.join(', ')}]` : '',
      invalidClaims.length > 0 ? `Ungrounded financial claims: [${invalidClaims.join('; ')}]` : '',
    ]
      .filter(Boolean)
      .join('; ');

    super(`AI investigation failed evidence grounding verification: ${details}`);
    this.name = 'GroundingValidationError';
    this.invalidEvidenceCitations = invalidCitations;
    this.invalidFinancialClaims = invalidClaims;
    Object.setPrototypeOf(this, GroundingValidationError.prototype);
  }
}

/**
 * Internal index record preserving exact relational bindings between attributes of a single evidence source.
 */
interface CanonicalEvidenceRecord {
  id: string;
  sourceRecordId: string;
  sourceSystem: string;
  evidenceType: string;
  merchantId: string;
  orderIds: Set<string>;
  transactionIds: Set<string>;
  captureIds: Set<string>;
  refundReferences: Set<string>;
  amountsMinor: Set<number>;
  currencies: Set<string>;
  statuses: Set<string>;
  timestamps: Set<string>;
}

/**
 * Recursively extracts all primitive numeric amounts from a record's payload.
 */
function extractPayloadNumbers(payload: unknown, amountsMinor: Set<number>): void {
  if (!payload || typeof payload !== 'object') return;

  for (const [, val] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof val === 'number') {
      amountsMinor.add(val);
    } else if (typeof val === 'object' && val !== null) {
      extractPayloadNumbers(val, amountsMinor);
    }
  }
}

/**
 * Builds a relational index item from an evidence context item.
 */
function buildCanonicalEvidenceRecord(
  item: InvestigationEvidenceContextItem,
  merchantId: string
): CanonicalEvidenceRecord {
  const rec: CanonicalEvidenceRecord = {
    id: item.evidenceId,
    sourceRecordId: item.sourceRecordId,
    sourceSystem: item.sourceSystem,
    evidenceType: item.evidenceType,
    merchantId,
    orderIds: new Set<string>(),
    transactionIds: new Set<string>(),
    captureIds: new Set<string>(),
    refundReferences: new Set<string>(),
    amountsMinor: new Set<number>(),
    currencies: new Set<string>(),
    statuses: new Set<string>(),
    timestamps: new Set<string>(),
  };

  if (item.sourceRecordId.startsWith('ORD-') || item.evidenceType === 'MERCHANT_ORDER') {
    rec.orderIds.add(item.sourceRecordId);
  }
  if (item.sourceRecordId.startsWith('TXN-') || item.evidenceType === 'PAYPAL_TRANSACTION') {
    rec.transactionIds.add(item.sourceRecordId);
  }
  if (item.sourceRecordId.startsWith('CAPTURE-')) {
    rec.captureIds.add(item.sourceRecordId);
  }
  if (item.sourceRecordId.startsWith('REFUND-')) {
    rec.refundReferences.add(item.sourceRecordId);
  }
  if (item.capturedAt) {
    rec.timestamps.add(item.capturedAt);
  }

  if (item.sanitizedPayload && typeof item.sanitizedPayload === 'object') {
    const payload = item.sanitizedPayload as Record<string, unknown>;
    if (typeof payload.orderId === 'string') rec.orderIds.add(payload.orderId);
    if (typeof payload.transactionId === 'string') rec.transactionIds.add(payload.transactionId);
    if (typeof payload.captureId === 'string') rec.captureIds.add(payload.captureId);
    if (typeof payload.refundReference === 'string') rec.refundReferences.add(payload.refundReference);
    if (typeof payload.currency === 'string') rec.currencies.add(payload.currency.toUpperCase());
    if (typeof payload.transactionStatus === 'string') rec.statuses.add(payload.transactionStatus.toUpperCase());
    if (typeof payload.status === 'string') rec.statuses.add(payload.status.toUpperCase());
    if (typeof payload.timestamp === 'string') rec.timestamps.add(payload.timestamp);
    if (typeof payload.capturedAt === 'string') rec.timestamps.add(payload.capturedAt);

    extractPayloadNumbers(payload, rec.amountsMinor);
  }

  return rec;
}

/**
 * Builds a relational index item for the parent case itself.
 */
function buildCaseRecordIndex(context: BoundedInvestigationContext): CanonicalEvidenceRecord {
  const rec: CanonicalEvidenceRecord = {
    id: context.caseId,
    sourceRecordId: context.primaryReference || context.caseKey,
    sourceSystem: 'CLOSELOOP_EXCEPTION_ENGINE',
    evidenceType: 'EXCEPTION_CASE',
    merchantId: context.merchantId,
    orderIds: new Set<string>(),
    transactionIds: new Set<string>(),
    captureIds: new Set<string>(),
    refundReferences: new Set<string>(),
    amountsMinor: new Set<number>([
      context.varianceAmountMinor,
      context.expectedAmountMinor,
      context.actualAmountMinor,
    ]),
    currencies: new Set<string>([context.currency.toUpperCase()]),
    statuses: new Set<string>([context.discrepancyType.toUpperCase()]),
    timestamps: new Set<string>(),
  };

  if (context.merchantOrderId) rec.orderIds.add(context.merchantOrderId);
  if (context.primaryReference && context.primaryReference.startsWith('ORD-')) rec.orderIds.add(context.primaryReference);
  if (context.paypalTransactionId) rec.transactionIds.add(context.paypalTransactionId);
  if (context.primaryReference && context.primaryReference.startsWith('TXN-')) rec.transactionIds.add(context.primaryReference);
  if (context.initialVarianceAmountMinor !== undefined) rec.amountsMinor.add(context.initialVarianceAmountMinor);
  if (context.contextCreatedAt) rec.timestamps.add(context.contextCreatedAt);

  return rec;
}

/**
 * Determines whether a claimed amount is deterministically derived from numbers present in the cited records.
 */
function isAmountDerivedFromOperands(claimed: number, operands: Set<number>): boolean {
  const nums = Array.from(operands);
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      const a = nums[i];
      const b = nums[j];
      if (Math.abs(a - b) === claimed) return true;
      if (a + b === claimed) return true;
      if (a - b === claimed) return true;
    }
  }
  return false;
}

/**
 * Validates that every evidence citation and asserted financial fact/claim is relationally grounded (F-32).
 * Replaces global-set allowlisting with source-bound relational tuple verification.
 */
export function validateEvidenceGrounding(
  result: InvestigationResult,
  context: BoundedInvestigationContext
): void {
  // 1. Build canonical relational evidence index
  const evidenceIndex = new Map<string, CanonicalEvidenceRecord>();

  const caseRec = buildCaseRecordIndex(context);
  evidenceIndex.set(context.caseId, caseRec);
  if (context.primaryReference) {
    evidenceIndex.set(context.primaryReference, caseRec);
  }
  if (context.merchantOrderId) {
    evidenceIndex.set(context.merchantOrderId, caseRec);
  }
  if (context.paypalTransactionId) {
    evidenceIndex.set(context.paypalTransactionId, caseRec);
  }

  for (const item of context.evidenceItems) {
    const rec = buildCanonicalEvidenceRecord(item, context.merchantId);
    evidenceIndex.set(item.evidenceId, rec);
    evidenceIndex.set(item.sourceRecordId, rec);
    for (const ord of rec.orderIds) evidenceIndex.set(ord, rec);
    for (const txn of rec.transactionIds) evidenceIndex.set(txn, rec);
  }

  const invalidCitations: string[] = [];
  const invalidFinancialClaims: string[] = [];

  // 2. Validate citations on Inferences
  for (const inf of result.inferences) {
    if (!inf.supportingEvidenceIds || inf.supportingEvidenceIds.length === 0) {
      invalidCitations.push(`Inference '${inf.inferenceId}' missing supporting citations`);
      continue;
    }
    for (const cited of inf.supportingEvidenceIds) {
      if (!evidenceIndex.has(cited)) {
        invalidCitations.push(cited);
      }
    }
    for (const cited of inf.contradictingEvidenceIds) {
      if (!evidenceIndex.has(cited)) {
        invalidCitations.push(cited);
      }
    }
  }

  // 3. Strict Relational Grounding on Established Facts
  for (const fact of result.establishedFacts) {
    // 3A. Require non-empty citations
    if (!fact.sourceEvidenceIds || fact.sourceEvidenceIds.length === 0) {
      invalidCitations.push(`Established fact '${fact.factId}' has no supporting evidence citations`);
      continue;
    }

    // 3B. Verify citations exist
    const citedRecords: CanonicalEvidenceRecord[] = [];
    for (const cited of fact.sourceEvidenceIds) {
      const rec = evidenceIndex.get(cited);
      if (!rec) {
        invalidCitations.push(cited);
      } else {
        citedRecords.push(rec);
      }
    }

    if (citedRecords.length === 0) continue;

    // 3C. Validate Structured Financial Claim against cited records
    if (fact.structuredClaim) {
      const claim = fact.structuredClaim;

      // Tenant ownership check
      if (claim.merchantId && claim.merchantId !== context.merchantId) {
        invalidFinancialClaims.push(
          `Fact '${fact.factId}': Mismatched merchant ID '${claim.merchantId}' (Cross-merchant mixing prohibited)`
        );
      }

      // If transactionId is claimed, it MUST exist in the cited records
      let transactionRecords: CanonicalEvidenceRecord[] = [];
      if (claim.transactionId) {
        transactionRecords = citedRecords.filter((r) => r.transactionIds.has(claim.transactionId!));
        if (transactionRecords.length === 0) {
          invalidFinancialClaims.push(
            `Fact '${fact.factId}': Asserted transaction ID '${claim.transactionId}' not found in cited evidence [${fact.sourceEvidenceIds.join(', ')}]`
          );
        }
      }

      // If orderId is claimed, it MUST exist in the cited records
      let orderRecords: CanonicalEvidenceRecord[] = [];
      if (claim.orderId) {
        orderRecords = citedRecords.filter((r) => r.orderIds.has(claim.orderId!));
        if (orderRecords.length === 0) {
          invalidFinancialClaims.push(
            `Fact '${fact.factId}': Asserted order ID '${claim.orderId}' not found in cited evidence [${fact.sourceEvidenceIds.join(', ')}]`
          );
        }
      }

      // Determine bound records relevant to this claim
      const targetRecords =
        transactionRecords.length > 0
          ? transactionRecords
          : orderRecords.length > 0
            ? orderRecords
            : citedRecords;

      // Relational Amount Verification
      if (claim.amountMinor !== undefined) {
        if (fact.classification === 'DETERMINISTIC_DERIVATION') {
          // Derived: collect all numbers across cited records and verify arithmetic
          const operands = new Set<number>();
          for (const r of citedRecords) {
            for (const n of r.amountsMinor) operands.add(n);
          }
          if (!isAmountDerivedFromOperands(claim.amountMinor, operands)) {
            invalidFinancialClaims.push(
              `Fact '${fact.factId}': Derived amount ${claim.amountMinor} cannot be derived from cited records' operands [${Array.from(operands).join(', ')}]`
            );
          }
        } else {
          // Direct observation: amount MUST exist in the specific target record(s) bound to this entity
          const hasAmount = targetRecords.some((r) => r.amountsMinor.has(claim.amountMinor!));
          if (!hasAmount) {
            const entityLabel = claim.transactionId || claim.orderId || 'cited record';
            invalidFinancialClaims.push(
              `Fact '${fact.factId}': Amount ${claim.amountMinor} is not supported by ${entityLabel} (cross-record attribute mixing detected)`
            );
          }
        }
      }

      // Relational Currency Verification
      if (claim.currency) {
        const curUpper = claim.currency.toUpperCase();
        const hasCurrency = targetRecords.some((r) => r.currencies.has(curUpper));
        if (!hasCurrency) {
          const entityLabel = claim.transactionId || claim.orderId || 'cited record';
          invalidFinancialClaims.push(
            `Fact '${fact.factId}': Currency '${claim.currency}' is not supported by ${entityLabel}`
          );
        }
      }

      // Relational Transaction Status Verification
      if (claim.transactionStatus) {
        const statUpper = claim.transactionStatus.toUpperCase();
        const hasStatus = targetRecords.some((r) => r.statuses.has(statUpper));
        if (!hasStatus) {
          const entityLabel = claim.transactionId || claim.orderId || 'cited record';
          invalidFinancialClaims.push(
            `Fact '${fact.factId}': Status '${claim.transactionStatus}' is not supported by ${entityLabel}`
          );
        }
      }

      // Relational Timestamp Verification
      if (claim.timestamp) {
        const hasTimestamp = targetRecords.some((r) => r.timestamps.has(claim.timestamp!));
        if (!hasTimestamp) {
          const entityLabel = claim.transactionId || claim.orderId || 'cited record';
          invalidFinancialClaims.push(
            `Fact '${fact.factId}': Timestamp '${claim.timestamp}' is not supported by ${entityLabel}`
          );
        }
      }
    }

    // 3D. Free-Form Description Verification against Cited Records
    const desc = fact.description;

    // Check asserted dollar amounts
    const dollarMatches = desc.matchAll(/\$([0-9]+(?:\.[0-9]{2})?)/g);
    for (const match of dollarMatches) {
      const dollars = parseFloat(match[1]);
      const minor = Math.round(dollars * 100);
      const supportedByCited = citedRecords.some(
        (r) =>
          r.amountsMinor.has(minor) ||
          (fact.structuredClaim?.amountMinor === minor) ||
          (fact.classification === 'DETERMINISTIC_DERIVATION')
      );
      if (!supportedByCited) {
        invalidFinancialClaims.push(
          `Fact '${fact.factId}': Description asserts dollar amount '$${match[1]}' (${minor} minor) not supported by cited records`
        );
      }
    }

    // Check asserted transaction IDs
    const txnMatches = desc.matchAll(/\b(TXN-[A-Za-z0-9_-]+)\b/g);
    for (const match of txnMatches) {
      const txnId = match[1];
      const supported = citedRecords.some((r) => r.transactionIds.has(txnId));
      if (!supported) {
        invalidFinancialClaims.push(
          `Fact '${fact.factId}': Description asserts transaction ID '${txnId}' not supported by cited records`
        );
      }
    }

    // Check asserted order IDs
    const ordMatches = desc.matchAll(/\b(ORD-[A-Za-z0-9_-]+)\b/g);
    for (const match of ordMatches) {
      const ordId = match[1];
      const supported = citedRecords.some((r) => r.orderIds.has(ordId));
      if (!supported) {
        invalidFinancialClaims.push(
          `Fact '${fact.factId}': Description asserts order ID '${ordId}' not supported by cited records`
        );
      }
    }
  }

  if (invalidCitations.length > 0 || invalidFinancialClaims.length > 0) {
    throw new GroundingValidationError(
      Array.from(new Set(invalidCitations)),
      Array.from(new Set(invalidFinancialClaims))
    );
  }
}
