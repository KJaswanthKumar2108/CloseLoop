/**
 * CloseLoop Phase 3D.2: Investigation API Route
 * POST /api/exceptions/cases/[id]/investigate: Executes a read-only AI investigation
 * GET  /api/exceptions/cases/[id]/investigate: Retrieves historical investigations for a case
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { investigateCase } from '@/lib/ai/investigationService';
import { listInvestigationsByCaseId } from '@/lib/ai/investigationRepository';
import { CaseContextNotFoundError } from '@/lib/ai/contextBuilder';
import { GroundingValidationError } from '@/lib/ai/schemas';
import { AIProviderError } from '@/lib/ai/types';

/**
 * POST /api/exceptions/cases/[id]/investigate
 * Triggers a read-only, evidence-grounded AI investigation of the specified case.
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

    // 3. Execute Investigation
    const result = await investigateCase(caseId, merchantId);

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof CaseContextNotFoundError) {
      return NextResponse.json(
        {
          error: 'Not Found',
          code: 'CASE_NOT_FOUND',
          message: err.message,
        },
        { status: 404 }
      );
    }

    if (err instanceof GroundingValidationError) {
      return NextResponse.json(
        {
          error: 'Unprocessable Entity',
          code: 'UNGROUNDED_INVESTIGATION_RESULT',
          message: err.message,
          invalidCitations: err.invalidEvidenceCitations,
          invalidClaims: err.invalidFinancialClaims,
        },
        { status: 422 }
      );
    }

    if (err instanceof AIProviderError) {
      return NextResponse.json(
        {
          error: err.code,
          code: err.code,
          message: err.message,
          provider: err.provider,
        },
        { status: err.httpStatus }
      );
    }

    console.error('[CloseLoop API Error] POST /api/exceptions/cases/[id]/investigate:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred during case investigation.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/exceptions/cases/[id]/investigate
 * Retrieves historical investigation records for this case.
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

    const investigations = await listInvestigationsByCaseId(undefined, caseId, merchantId, 20);

    return NextResponse.json(
      {
        success: true,
        caseId,
        merchantId,
        count: investigations.length,
        investigations,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    console.error('[CloseLoop API Error] GET /api/exceptions/cases/[id]/investigate:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve investigation history.',
      },
      { status: 500 }
    );
  }
}

