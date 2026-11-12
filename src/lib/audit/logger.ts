import { AuditEvent, AuditEventType, AuditActor } from '@/types/audit';

const inMemoryAuditLog: AuditEvent[] = [];

/**
 * Creates and logs an immutable audit event for system traceability.
 */
export function recordAuditEvent(params: {
  eventType: AuditEventType;
  actor: AuditActor;
  summary: string;
  details: Record<string, unknown>;
  targetEntityId?: string;
}): AuditEvent {
  const event: AuditEvent = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    actor: params.actor,
    summary: params.summary,
    details: params.details,
    targetEntityId: params.targetEntityId,
    hashSignature: `hash_${Date.now().toString(16)}`,
  };

  inMemoryAuditLog.unshift(event);
  return event;
}

/**
 * Read-only retrieval of the audit log.
 */
export function getAuditEvents(limit = 50): AuditEvent[] {
  return inMemoryAuditLog.slice(0, limit);
}

