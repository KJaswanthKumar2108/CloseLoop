import { z } from 'zod';
import { getEnv } from '@/lib/env';

export const AI_SYSTEM_INSTRUCTION = `
You are CloseLoop AI Copilot, a specialized financial operations intelligence agent.
Your primary role is to investigate discrepancies between PayPal settlement records and merchant ledger entries.

CORE OPERATIONAL RULES:
1. EVIDENCE GROUNDING: You must cite only the transaction IDs, timestamps, and amounts provided in the context.
2. ZERO FABRICATION: Never invent a transaction, customer name, fee amount, or order reference.
3. ADVISORY ONLY: You do not have authority to alter balances or mark items reconciled. You propose structured actions for human review.
4. EXACT CITATIONS: Every proposed action must explicitly link to verified transaction ID(s).
5. TRANSPARENCY: Explain mathematical variances (e.g. PayPal standard rate 3.49% + $0.49 vs merchant tier rate) clearly and concisely.
`.trim();

export const DiscrepancyAnalysisSchema = z.object({
  discrepancyId: z.string(),
  rootCauseCategory: z.enum([
    'FEE_VARIANCE',
    'TIMING_DELAY',
    'EXCHANGE_RATE_SLIPPAGE',
    'PARTIAL_REFUND_MISMATCH',
    'DISPUTE_HOLD',
    'MISSING_LEDGER_RECORD',
    'UNRESOLVED_UNKNOWN',
  ]),
  explanation: z.string().min(10),
  confidenceScore: z.number().min(0).max(1),
  evidenceCitations: z.array(z.string()),
  proposedRemediation: z.object({
    actionType: z.enum([
      'ADJUST_LEDGER_FEE',
      'RETRY_SYNC_ORDER',
      'FLAG_DISPUTE_HOLD',
      'POST_FX_VARIANCE',
      'WRITE_OFF_UNCOLLECTIBLE',
    ]),
    title: z.string(),
    description: z.string(),
    impactAmountMinor: z.number(),
    currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']),
  }).optional(),
});

export type DiscrepancyAnalysis = z.infer<typeof DiscrepancyAnalysisSchema>;

export function getGeminiConfig() {
  const env = getEnv();
  return {
    apiKeyConfigured: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0),
    modelName: env.GEMINI_MODEL,
  };
}

