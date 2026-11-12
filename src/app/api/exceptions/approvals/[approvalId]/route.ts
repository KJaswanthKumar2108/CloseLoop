/**
 * CloseLoop Phase 3D.4: Single Approval Retrieval API Route
 * GET /api/exceptions/approvals/[approvalId]
 *
 * Fetches an approval request under verified tenant context.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import {
  getApprovalById,
  ApprovalError,
} from '@/lib/approvals/approvalRepository';
import {
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '@/lib/approvals/types';

export async function GET(
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

    // 3. Fetch approval record
    const approval = await getApprovalById(approvalId, merchantId);
    if (!approval) {
      return NextResponse.json(
        {
          error: 'Not Found',
          code: 'APPROVAL_NOT_FOUND',
          message: `Approval request '${approvalId}' was not found under merchant '${merchantId}'.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        approval: {
          ...approval,
          displayLabel:
            approval.status === 'APPROVED'
              ? APPROVED_AWAITING_EXECUTION_LABEL
              : undefined,
          disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
        },
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

    console.error('[CloseLoop API Error] GET /api/exceptions/approvals/[approvalId]:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while fetching the approval.',
      },
      { status: 500 }
    );
  }
}

