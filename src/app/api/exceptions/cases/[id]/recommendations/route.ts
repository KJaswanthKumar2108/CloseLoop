/**
 * CloseLoop Phase 3D.3: Case Resolution Recommendations API Route
 * POST /api/exceptions/cases/[id]/recommendations: Evaluates and generates deterministic operator recommendations
 * GET  /api/exceptions/cases/[id]/recommendations: Retrieves deterministic operator recommendations for the case
 *
 * Strictly Read-Only / Advisory. Never executes payments, refunds, or financial mutations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { UUIDSchema } from '@/lib/exceptions/schemas';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { findCaseById } from '@/lib/exceptions/repository';
import { findLatestInvestigationByCaseId } from '@/lib/ai/investigationRepository';
import { getReaderPool } from '@/lib/db/pool';
import { generateCaseRecommendations } from '@/lib/resolution/recommendationEngine';

/**
 * Common handler for retrieving case context and computing deterministic recommendations.
 */
async function handleRecommendations(
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

    // 3. Retrieve case details using restricted Reader Pool
    const pool = getReaderPool();
    const caseDetail = await findCaseById(pool, caseId, merchantId);

    if (!caseDetail) {
      return NextResponse.json(
        {
          error: 'Not Found',
          code: 'CASE_NOT_FOUND',
          message: `Exception case ${caseId} was not found under merchant ${merchantId}.`,
        },
        { status: 404 }
      );
    }

    // 4. Retrieve latest investigation if available
    const latestInvestigation = await findLatestInvestigationByCaseId(pool, caseId, merchantId);

    // 5. Generate deterministic recommendations
    const recommendationsResult = generateCaseRecommendations(caseDetail, latestInvestigation);

    return NextResponse.json(
      {
        success: true,
        ...recommendationsResult,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    console.error('[CloseLoop API Error] /api/exceptions/cases/[id]/recommendations:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while generating resolution recommendations.',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/exceptions/cases/[id]/recommendations
 * Generates and returns deterministic resolution recommendations.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  return handleRecommendations(req, context);
}

/**
 * GET /api/exceptions/cases/[id]/recommendations
 * Retrieves deterministic resolution recommendations for the requested case.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  return handleRecommendations(req, context);
}

