import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import { findCaseById } from '@/lib/exceptions/repository';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';

/**
 * GET /api/exceptions/cases/:id
 *
 * Retrieves an exception case by its UUID, including its full evidence graph.
 * Enforces strict tenant isolation: returns 404 if the case does not exist
 * OR belongs to another merchant/tenant (prevents tenant enumeration).
 * Rejects spoofed tenant headers with 403 (F-23).
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await context.params;
    const caseId = resolvedParams.id;

    // 1. Resolve authoritative server-side merchant identity and enforce anti-spoofing (F-23)
    let merchantId: string;
    try {
      merchantId = resolveVerifiedMerchantId(req);
    } catch (authErr) {
      if (authErr instanceof TenantSecurityError) {
        return NextResponse.json(
          {
            error: 'Forbidden',
            code: authErr.code,
            message: authErr.message,
          },
          { status: authErr.httpStatus }
        );
      }
      throw authErr;
    }

    // 2. Validate UUID format
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

    // Fetch case strictly within merchant boundary
    const caseDetail = await findCaseById(undefined, caseId, merchantId);

    if (!caseDetail) {
      return NextResponse.json(
        {
          error: 'Not Found',
          code: 'CASE_NOT_FOUND',
          message: 'Exception case not found.',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        case: caseDetail,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[CloseLoop API Error] GET /api/exceptions/cases/:id:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve exception case.',
      },
      { status: 500 }
    );
  }
}
