/**
 * CloseLoop Phase 3D.5: List Approval Executions API Route
 * GET /api/exceptions/approvals/[approvalId]/executions
 *
 * Lists all execution records for the specified approval under tenant isolation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import {
  listExecutionsForApproval,
} from '@/lib/execution/executionRepository';
import { MANDATORY_SIMULATION_DISCLAIMER } from '@/lib/execution/types';

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

    // 3. List executions
    const executions = await listExecutionsForApproval(approvalId, merchantId);

    return NextResponse.json(
      {
        success: true,
        executions,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    console.error('[CloseLoop API Error] GET /api/exceptions/approvals/[approvalId]/executions:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while listing executions.',
      },
      { status: 500 }
    );
  }
}

