import { NextRequest, NextResponse } from 'next/server';
import {
  executeTransactionSearchPreview,
  TransactionSearchError,
} from '@/lib/paypal/transactionSearch';

/**
 * GET /api/paypal/transactions
 *
 * Read-only preview endpoint for querying PayPal Sandbox Transaction Search.
 * Returns normalized transactions and explicit rejected/unsupported items.
 * Does NOT persist transactions or execute reconciliation.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const maxPagesParam = searchParams.get('maxPages');

    const page = pageParam ? parseInt(pageParam, 10) : undefined;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : undefined;
    const maxPages = maxPagesParam ? parseInt(maxPagesParam, 10) : undefined;

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          error: 'INVALID_PARAMETERS',
          message:
            'Both "startDate" and "endDate" query parameters are required in RFC 3339 format (e.g. ?startDate=2026-10-15T00:00:00Z&endDate=2026-11-09T00:00:00Z).',
        },
        {
          status: 400,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          },
        }
      );
    }

    const previewResult = await executeTransactionSearchPreview({
      startDate,
      endDate,
      page,
      pageSize,
      maxPages,
    });

    return NextResponse.json(previewResult, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (err: unknown) {
    if (err instanceof TransactionSearchError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
        },
        {
          status: err.httpStatus,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          },
        }
      );
    }

    const errorMessage =
      err instanceof Error ? err.message : 'Internal error processing transaction search.';

    return NextResponse.json(
      {
        error: 'INTERNAL_ERROR',
        message: errorMessage,
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  }
}

