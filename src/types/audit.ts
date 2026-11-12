export type AuditEventType =
  | 'BATCH_INGESTED'
  | 'RECONCILIATION_COMPLETED'
  | 'DISCREPANCY_FLAGGED'
  | 'AI_ANALYSIS_GENERATED'
  | 'APPROVAL_REQUESTED'
  | 'APPROVAL_GRANTED'
  | 'APPROVAL_REJECTED'
  | 'ACTION_EXECUTED'
  | 'CONFIGURATION_UPDATED';

export interface AuditActor {
  type: 'SYSTEM' | 'AI_AGENT' | 'HUMAN_USER';
  id: string;
  name?: string;
  role?: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  eventType: AuditEventType;
  actor: AuditActor;
  summary: string;
  details: Record<string, unknown>;
  targetEntityId?: string;
  hashSignature?: string;
}

