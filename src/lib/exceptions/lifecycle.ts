/**
 * CloseLoop Phase 3D.1: Exception Lifecycle & State Transition Engine
 * Resolves F-30 (Lifecycle Integrity & Financial Truth).
 *
 * Enforces valid case status transitions, optimistic concurrency version checks,
 * and prevents arbitrary client-supplied status mutations.
 *
 * FINANCIAL TRUTH INVARIANT:
 * In Phase 3D.1, transition to 'RESOLVED' denotes operational and investigative case closure.
 * It does NOT execute, confirm, or imply automated financial ledger transfer, refund settlement,
 * or PayPal API disbursement (which are strictly deferred to Phase 3D.4 human authorization
 * and Phase 3D.5 execution adapters).
 */

import { ExceptionCaseStatus } from './types';

export class InvalidStatusTransitionError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly fromStatus: ExceptionCaseStatus;
  readonly toStatus: ExceptionCaseStatus;

  constructor(fromStatus: ExceptionCaseStatus, toStatus: ExceptionCaseStatus) {
    super(
      `Invalid case status transition from '${fromStatus}' to '${toStatus}'. Terminal and unauthorized transitions are prohibited.`
    );
    this.name = 'InvalidStatusTransitionError';
    this.code = 'INVALID_STATUS_TRANSITION';
    this.httpStatus = 400;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    Object.setPrototypeOf(this, InvalidStatusTransitionError.prototype);
  }
}

export class VersionConflictError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(expectedVersion: number, actualVersion: number) {
    super(
      `Optimistic lock version conflict: expected version ${expectedVersion}, but case is at version ${actualVersion}. Concurrent modification detected.`
    );
    this.name = 'VersionConflictError';
    this.code = 'VERSION_CONFLICT';
    this.httpStatus = 409;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

/**
 * Valid state transition graph for exception cases.
 * Operational dismissal and investigation are separated from financial resolution.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<ExceptionCaseStatus, readonly ExceptionCaseStatus[]> = {
  OPEN: ['INVESTIGATING', 'CLOSED_DISMISSED'],
  INVESTIGATING: ['PENDING_APPROVAL', 'ESCALATED', 'OPEN', 'CLOSED_DISMISSED'],
  PENDING_APPROVAL: ['RESOLVED', 'OPEN', 'ESCALATED', 'CLOSED_DISMISSED'],
  ESCALATED: ['INVESTIGATING', 'OPEN', 'CLOSED_DISMISSED'],
  CLOSED_DISMISSED: [], // Terminal operational dismissal
  RESOLVED: [], // Terminal investigative resolution (administrative only in Phase 3D.1)
};

/**
 * Validates whether a state transition from `fromStatus` to `toStatus` is permitted.
 */
export function isAllowedTransition(
  fromStatus: ExceptionCaseStatus,
  toStatus: ExceptionCaseStatus
): boolean {
  if (fromStatus === toStatus) {
    return true; // No-op transition
  }
  const allowedTargets = ALLOWED_STATUS_TRANSITIONS[fromStatus];
  return allowedTargets ? allowedTargets.includes(toStatus) : false;
}

/**
 * Validates transition and throws InvalidStatusTransitionError if prohibited.
 */
export function assertValidTransition(
  fromStatus: ExceptionCaseStatus,
  toStatus: ExceptionCaseStatus
): void {
  if (!isAllowedTransition(fromStatus, toStatus)) {
    throw new InvalidStatusTransitionError(fromStatus, toStatus);
  }
}

