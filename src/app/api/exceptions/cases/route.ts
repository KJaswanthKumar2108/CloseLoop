import { NextRequest, NextResponse } from 'next/server';
import {
  CreateCasesRequestSchema,
  ListCasesQuerySchema,
} from '@/lib/exceptions/schemas';
import { extractCasesFromReconciliationRun } from '@/lib/exceptions/caseExtractor';
import { persistExceptionCases, listCases } from '@/lib/exceptions/repository';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { MerchantOrder, PaymentTransaction, ReconciliationRun } from '@/types/financial';

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB limit

/**
 * POST /api/exceptions/cases
 *
 * Deterministically extracts actionable exception cases from a reconciliation run
 * and persists them along with an immutable evidence graph.
 * Hardened per F-23 (Trusted Tenant Identity & Anti-Spoofing).
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Content-Type Check
    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Request Content-Type must be application/json.',
        },
        { status: 415 }
      );
    }

    // 2. Content-Length Guard
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: 'Payload Too Large',
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request payload exceeds maximum 10MB limit.',
        },
        { status: 413 }
      );
    }

    // 3. Body Parsing & Zod Validation
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'INVALID_JSON',
          message: 'Malformed JSON payload.',
        },
        { status: 400 }
      );
    }

    const parseResult = CreateCasesRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid case extraction request payload.',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { reconciliationRun, orders, transactions, merchantId: bodyMerchantId } = parseResult.data;

    // 4. Resolve & Verify Authoritative Merchant Identity (F-23)
    let merchantId: string;
    try {
      merchantId = resolveVerifiedMerchantId(req, bodyMerchantId);
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

    // 5. Deterministic Case Extraction
    const extractionResult = extractCasesFromReconciliationRun({
      run: reconciliationRun as unknown as ReconciliationRun,
      orders: orders as unknown as MerchantOrder[],
      transactions: transactions as unknown as PaymentTransaction[],
      merchantId,
    });

    // 6. Atomic & Idempotent Persistence
    const persistenceResult = await persistExceptionCases(undefined, extractionResult.cases);

    return NextResponse.json(
      {
        success: true,
        reconciliationRunId: reconciliationRun.id,
        merchantId,
        totalRecordsProcessed: extractionResult.totalRecordsProcessed,
        casesExtracted: extractionResult.eligibleCasesExtracted,
        casesCreated: persistenceResult.casesCreated,
        casesUpdated: persistenceResult.casesUpdated,
        caseIds: persistenceResult.caseIds,
        evidenceItemsInserted: persistenceResult.evidenceItemsInserted,
        cleanMatchesSkipped: extractionResult.cleanMatchesSkipped,
        ineligibleQuarantinedSkipped: extractionResult.ineligibleQuarantinedSkipped,
      },
      {
        status: 201,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[CloseLoop API Error] POST /api/exceptions/cases:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to extract and persist exception cases.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/exceptions/cases
 *
 * Lists exception cases filtered by status or discrepancy type with pagination.
 * Strictly scopes results to the authoritative requesting merchant (F-23).
 */
export async function GET(req: NextRequest) {
  try {
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

    const searchParams = req.nextUrl.searchParams;

    const queryInput = {
      status: searchParams.get('status') || undefined,
      discrepancyType: searchParams.get('discrepancyType') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parseResult = ListCasesQuerySchema.safeParse(queryInput);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters.',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { status, discrepancyType, limit, offset } = parseResult.data;

    const result = await listCases(undefined, {
      merchantId,
      status,
      discrepancyType,
      limit,
      offset,
    });

    return NextResponse.json(
      {
        success: true,
        merchantId,
        total: result.total,
        limit,
        offset,
        cases: result.cases,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[CloseLoop API Error] GET /api/exceptions/cases:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'Failed to list exception cases.',
      },
      { status: 500 }
    );
  }
}
