/**
 * CloseLoop Phase 3D.4: Case Approvals API Route
 * POST /api/exceptions/cases/[id]/approvals - Submits an approval request for a resolution recommendation
 * GET  /api/exceptions/cases/[id]/approvals - Lists all approval requests and statuses for a case
 *
 * Strict Financial Boundary: This endpoint records human governance requests only.
 * It NEVER performs refunds, captures, voids, or payments.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { CreateApprovalRequestSchema } from '@/lib/approvals/schemas';
import {
  createApprovalRequest,
  listApprovalsForCase,
  ApprovalError,
} from '@/lib/approvals/approvalRepository';
import {
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '@/lib/approvals/types';

/**
 * Helper to resolve operator identity from headers or body
 */
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

/**
 * POST /api/exceptions/cases/[id]/approvals
 * Submits an immutable approval request for an actionable recommendation.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await context.params;
    const caseId = resolvedParams.id;

    // 1. Validate UUID format
    const uuidParse = UUIDSchema.safeParse(caseId);
    if (!uuidParse.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'INVALID_CASE_ID',
          message: 'The requested case ID must be a valid UUID.',
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

    // 3. Parse & validate request body
    let bodyRaw: unknown;
    try {
      bodyRaw = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'INVALID_JSON_BODY',
          message: 'Request body must be a valid JSON object.',
        },
        { status: 400 }
      );
    }

    const parseResult = CreateApprovalRequestSchema.safeParse(bodyRaw);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_FAILED',
          message: 'Approval request parameters failed validation.',
          details: parseResult.error.format(),
        },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const operator = resolveOperator(req, (bodyRaw as Record<string, unknown>)?.requestedBy);

    // 4. Create approval record with cryptographic binding
    const approvalRecord = await createApprovalRequest({
      merchantId,
      caseId,
      recommendationId: body.recommendationId,
      actionId: body.actionId,
      actionParameters: body.actionParameters,
      caseVersion: body.caseVersion,
      evidenceFingerprint: body.evidenceFingerprint,
      requestedBy: operator,
      expiresInHours: body.expiresInHours,
    });

    return NextResponse.json(
      {
        success: true,
        approval: {
          ...approvalRecord,
          displayLabel:
            approvalRecord.status === 'APPROVED'
              ? APPROVED_AWAITING_EXECUTION_LABEL
              : undefined,
          disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
        },
      },
      {
        status: 201,
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

    console.error('[CloseLoop API Error] POST /api/exceptions/cases/[id]/approvals:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while creating the approval request.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/exceptions/cases/[id]/approvals
 * Lists all approval requests and their current statuses for the specified case.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await context.params;
    const caseId = resolvedParams.id;

    // 1. Validate UUID format
    const uuidParse = UUIDSchema.safeParse(caseId);
    if (!uuidParse.success) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'INVALID_CASE_ID',
          message: 'The requested case ID must be a valid UUID.',
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

    // 3. List approvals
    const approvals = await listApprovalsForCase(caseId, merchantId);

    return NextResponse.json(
      {
        success: true,
        approvals: approvals.map((app) => ({
          ...app,
          displayLabel:
            app.status === 'APPROVED'
              ? APPROVED_AWAITING_EXECUTION_LABEL
              : undefined,
          disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
        })),
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

    console.error('[CloseLoop API Error] GET /api/exceptions/cases/[id]/approvals:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while listing approvals.',
      },
      { status: 500 }
    );
  }
}

