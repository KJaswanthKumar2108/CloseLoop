import { Money } from './financial';

export type ActionType =
  | 'ADJUST_LEDGER_FEE'
  | 'RETRY_SYNC_ORDER'
  | 'FLAG_DISPUTE_HOLD'
  | 'POST_FX_VARIANCE'
  | 'WRITE_OFF_UNCOLLECTIBLE';

export type ApprovalStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'EXECUTION_FAILED';

export interface ProposedAction {
  id: string;
  type: ActionType;
  title: string;
  description: string;
  proposedBy: 'AI_COPILOT' | 'SYSTEM_RULE' | 'HUMAN_OPERATOR';
  relatedTransactionId: string;
  financialImpact: Money;
  evidenceCitations: string[];
  status: ApprovalStatus;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  executionResult?: {
    success: boolean;
    referenceId?: string;
    executedAt: string;
    errorMessage?: string;
  };
}

