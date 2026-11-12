/**
 * CloseLoop Phase 3D.2: Investigation Orchestration Service
 * Pure read-only orchestration: retrieves context, defends against prompt injection,
 * calls provider, enforces schema and grounding validation, and persists audit logs.
 *
 * Hardened per F-35 (Snapshot Consistency & Stale Investigations).
 */

import { Pool, PoolClient } from 'pg';
import {
  buildInvestigationContext,
  computeEvidenceFingerprint,
  MAX_CONTEXT_EVIDENCE_ITEMS,
} from './contextBuilder';
import { findCaseById } from '@/lib/exceptions/repository';
import { buildInvestigationPrompt, PROMPT_VERSION } from './promptDefense';
import { resolveAIProviderClient } from './provider';
import { validateEvidenceGrounding, InvestigationResultSchema } from './schemas';
import { persistInvestigation } from './investigationRepository';
import {
  AIProviderClient,
  AIProviderError,
  InvestigationResult,
  SnapshotConsistencyMetadata,
} from './types';

export interface InvestigationExecutionOptions {
  providerOverride?: AIProviderClient;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
}

export interface InvestigationExecutionResult {
  investigationId: string;
  provider: string;
  model: string;
  caseId: string;
  merchantId: string;
  caseVersion: number;
  evidenceFingerprint: string;
  investigation: InvestigationResult;
  isStale: boolean;
  snapshotMetadata?: SnapshotConsistencyMetadata | null;
  createdAt: string;
}

/**
 * Investigates an existing exception case in read-only mode.
 * Invariant: Does NOT modify case status, financial amounts, or evidence items.
 * Enforces F-35 snapshot consistency without holding open database transactions.
 */
export async function investigateCase(
  caseId: string,
  merchantId: string,
  options: InvestigationExecutionOptions = {},
  poolOrClient?: Pool | PoolClient
): Promise<InvestigationExecutionResult> {
  // 1. Build bounded, sanitized evidence context (Read-Only)
  const context = await buildInvestigationContext(caseId, merchantId, poolOrClient);

  // 2. Resolve provider client (Gemini 2.5 Flash or Mock)
  const providerClient = resolveAIProviderClient(options.providerOverride);

  // 3. Construct prompt with prompt-injection defense fencing
  const { systemInstruction, userPrompt } = buildInvestigationPrompt(context);

  try {
    // 4. Call provider (No database transaction held open during model execution)
    const providerResponse = await providerClient.investigate({
      context,
      systemInstruction,
      userPrompt,
      timeoutMs: options.timeoutMs,
      abortSignal: options.abortSignal,
    });

    // 5. Schema validation
    const parsed = InvestigationResultSchema.parse(providerResponse.structuredResult);

    // 6. Evidence grounding verification (Rejects hallucinated transaction IDs & evidence refs)
    validateEvidenceGrounding(parsed, context);

    // 7. Post-Execution Snapshot Consistency Check (F-35)
    // Query latest case without locking to verify whether evidence evolved during model call
    const latestCase = await findCaseById(poolOrClient, context.caseId, context.merchantId);
    let isStale = false;
    let snapshotMetadata: SnapshotConsistencyMetadata | null = null;

    if (latestCase) {
      const currentBounded = latestCase.evidence.slice(0, MAX_CONTEXT_EVIDENCE_ITEMS);
      const currentFingerprint = computeEvidenceFingerprint(
        latestCase.id,
        latestCase.version,
        currentBounded
      );

      if (
        latestCase.version !== context.caseVersion ||
        currentFingerprint !== context.evidenceFingerprint
      ) {
        isStale = true;
        snapshotMetadata = {
          analyzedVersion: context.caseVersion,
          currentVersion: latestCase.version,
          analyzedFingerprint: context.evidenceFingerprint,
          currentFingerprint,
          contextCreatedAt: context.contextCreatedAt,
          checkedAt: new Date().toISOString(),
        };
      }
    }

    // 8. Persist append-only immutable investigation record with snapshot metadata
    const auditRecord = await persistInvestigation(poolOrClient, {
      caseId: context.caseId,
      merchantId: context.merchantId,
      caseVersion: context.caseVersion,
      evidenceFingerprint: context.evidenceFingerprint,
      provider: providerResponse.provider,
      model: providerResponse.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: '1.0',
      status: isStale ? 'STALE_SNAPSHOT' : 'COMPLETED',
      investigationResult: parsed,
      tokensUsed: providerResponse.usage,
      isStale,
      snapshotMetadata,
    });

    return {
      investigationId: auditRecord.id,
      provider: providerResponse.provider,
      model: providerResponse.model,
      caseId: context.caseId,
      merchantId: context.merchantId,
      caseVersion: context.caseVersion,
      evidenceFingerprint: context.evidenceFingerprint,
      investigation: parsed,
      isStale,
      snapshotMetadata,
      createdAt: auditRecord.createdAt,
    };
  } catch (err: unknown) {
    // 9. On failure, persist failed audit record for traceability
    const errorCode =
      err instanceof AIProviderError
        ? err.code
        : (err as { code?: string }).code || 'INVESTIGATION_FAILED';
    const errorMessage = err instanceof Error ? err.message : String(err);

    try {
      await persistInvestigation(poolOrClient, {
        caseId: context.caseId,
        merchantId: context.merchantId,
        caseVersion: context.caseVersion,
        evidenceFingerprint: context.evidenceFingerprint,
        provider: providerClient.providerName,
        model: providerClient.modelName,
        promptVersion: PROMPT_VERSION,
        schemaVersion: '1.0',
        status: 'FAILED',
        safeErrorCode: errorCode,
        safeErrorMessage: errorMessage.slice(0, 500),
      });
    } catch {
      // Non-blocking if failed audit persistence fails
    }

    throw err;
  }
}
