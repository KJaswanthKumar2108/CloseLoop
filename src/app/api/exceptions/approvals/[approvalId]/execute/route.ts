/**
 * CloseLoop Phase 3D.5: Controlled Execution API Route
 * POST /api/exceptions/approvals/[approvalId]/execute
 *
 * Validates eligibility and executes deterministic simulated action (DRY_RUN).
 * Strict FinTech Safety: LIVE mode is permanently disabled.
 * PayPal Sandbox is restricted to read-only; execution defaults safely to DRY_RUN simulation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { ExecuteActionRequestSchema } from '@/lib/execution/schemas';
import {
  executeControlledAction,
  checkExecutionEligibility,
  ExecutionError,
} from '@/lib/execution/executionEngine';
import { MANDATORY_SIMULATION_DISCLAIMER } from '@/lib/execution/types';

function resolveOperator(req: NextRequest): string {
  const headerOperator = req.headers.get('x-operator-id');
  if (headerOperator && headerOperator.trim().length > 0) {
    return headerOperator.trim();
  }
  return 'operator@closeloop.local';
}

/**
 * POST /api/exceptions/approvals/[approvalId]/execute
 */
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

    // 3. Parse request body
    let bodyRaw: Record<string, unknown> = {};
    try {
      bodyRaw = await req.json();
    } catch {
      // Body may be empty, defaults will apply
    }

    const parseResult = ExecuteActionRequestSchema.safeParse(bodyRaw);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_FAILED',
          message: 'Execution request parameters failed validation.',
          details: parseResult.error.format(),
        },
        { status: 400 }
      );
    }

    const body = parseResult.data;
    const operator = resolveOperator(req);

    // 4. Execute controlled action (defaults to DRY_RUN simulation)
    const executionRecord = await executeControlledAction({
      approvalId,
      merchantId,
      executionMode: body.executionMode,
      idempotencyKey: body.idempotencyKey,
      operatorId: operator,
    });

    return NextResponse.json(
      {
        success: true,
        execution: executionRecord,
        disclaimer: MANDATORY_SIMULATION_DISCLAIMER,
        message: MANDATORY_SIMULATION_DISCLAIMER,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof ExecutionError) {
      return NextResponse.json(
        {
          error: err.code,
          code: err.code,
          message: err.message,
        },
        { status: err.httpStatus }
      );
    }

    console.error('[CloseLoop API Error] POST /api/exceptions/approvals/[approvalId]/execute:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while executing the controlled action.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/exceptions/approvals/[approvalId]/execute
 * Checks execution eligibility without executing.
 */
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

    // 3. Check eligibility
    const eligibility = await checkExecutionEligibility(approvalId, merchantId);

    return NextResponse.json(
      {
        success: true,
        eligibility,
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
    if (err instanceof ExecutionError) {
      return NextResponse.json(
        {
          error: err.code,
          code: err.code,
          message: err.message,
        },
        { status: err.httpStatus }
      );
    }

    console.error('[CloseLoop API Error] GET /api/exceptions/approvals/[approvalId]/execute:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while checking execution eligibility.',
      },
      { status: 500 }
    );
  }
}

