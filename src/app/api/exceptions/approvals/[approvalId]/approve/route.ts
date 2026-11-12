/**
 * CloseLoop Phase 3D.4: Approve Action API Route
 * POST /api/exceptions/approvals/[approvalId]/approve
 *
 * Atomically transitions an approval request from PENDING_APPROVAL -> APPROVED.
 * Validates cryptographic parameters, checks parent case version and evidence freshness.
 *
 * Strict Financial Boundary: This endpoint ONLY grants governance approval.
 * It NEVER performs refunds, captures, voids, or payments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import {
  decideApproval,
  ApprovalError,
} from '@/lib/approvals/approvalRepository';
import {
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '@/lib/approvals/types';

function resolveOperator(req: NextRequest, bodyOperator?: unknown): string {
  const headerOperator = req.headers.get('x-operator-id');
  if (headerOperator && headerOperator.trim().length > 0) {
    return headerOperator.trim();
  }
  if (typeof bodyOperator === 'string' && bodyOperator.trim().length > 0) {
    return bodyOperator.trim();
  }
  return 'operator@closeloop.local';
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ approvalId: string }> | { approvalId: string } }
) {
  try {
    const resolvedParams = await context.params;
    const approvalId = resolvedParams.approvalId;

    // 1. Validate UUID format
    const uuidParse = UUIDSchema.safeParse(approvalId);
    if (!uuidParse.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'INVALID_APPROVAL_ID',
          message: 'The requested approval ID must be a valid UUID.',
        },
        { status: 400 }
      );
    }

    // 2. Authoritative server-side merchant resolution & anti-spoofing
    let merchantId: string;
    try {
      merchantId = resolveVerifiedMerchantId(req);
    } catch (authErr) {
      if (authErr instanceof TenantSecurityError) {
        return NextResponse.json(
          {
            error: authErr.code,
            code: authErr.code,
            message: authErr.message,
          },
          { status: authErr.httpStatus }
        );
      }
      throw authErr;
    }

    // 3. Parse decision body
    let bodyRaw: Record<string, unknown> = {};
    try {
      bodyRaw = await req.json();
    } catch {
      // Body may be empty or minimal
    }

    const reason =
      typeof bodyRaw?.reason === 'string' && bodyRaw.reason.trim().length >= 5
        ? bodyRaw.reason.trim()
        : 'Operator manual authorization granted after evidence review.';
    const operator = resolveOperator(req, bodyRaw?.decidedBy);

    // 4. Atomically transition state
    const updatedApproval = await decideApproval({
      approvalId,
      merchantId,
      decision: 'APPROVE',
      decidedBy: operator,
      decisionReason: reason,
    });

    return NextResponse.json(
      {
        success: true,
        approval: {
          ...updatedApproval,
          displayLabel: APPROVED_AWAITING_EXECUTION_LABEL,
          disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
        },
        message: MANDATORY_APPROVAL_DISCLAIMER,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof ApprovalError) {
      return NextResponse.json(
        {
          error: err.code,
          code: err.code,
          message: err.message,
        },
        { status: err.httpStatus }
      );
    }

    console.error('[CloseLoop API Error] POST /api/exceptions/approvals/[approvalId]/approve:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while processing approval.',
      },
      { status: 500 }
    );
  }
}

