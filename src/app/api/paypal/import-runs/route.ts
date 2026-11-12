import { NextRequest, NextResponse } from 'next/server';
import { listImportRuns } from '@/lib/db/repositories/importRunRepository';
import { isDatabaseConfigured, DatabaseConfigurationError } from '@/lib/db/config';

/**
 * GET /api/paypal/import-runs
 *
 * Read-only endpoint for operator visibility into past ingestion executions and run metrics.
 */
export async function GET(request: NextRequest) {
  try {
    if (!isDatabaseConfigured()) {
      return NextResponse.json(
        {
          error: 'DATABASE_NOT_CONFIGURED',
          message: 'Database persistence is not configured. Set "DATABASE_URL" in .env.local.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const runs = await listImportRuns(
      isNaN(limit) ? 20 : Math.min(100, Math.max(1, limit)),
      isNaN(offset) ? 0 : Math.max(0, offset)
    );

    return NextResponse.json(
      {
        provider: 'PayPal',
        environment: 'sandbox',
        runs,
        totalReturned: runs.length,
        fetchedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      }
    );
  } catch (err: unknown) {
    if (err instanceof DatabaseConfigurationError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const errorMessage =
      err instanceof Error ? err.message : 'Internal error retrieving import runs.';

    return NextResponse.json(
      {
        error: 'QUERY_FAILED',
        message: errorMessage,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

