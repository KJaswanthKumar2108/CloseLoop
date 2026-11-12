import { NextRequest, NextResponse } from 'next/server';
import {
  importPayPalTransactions,
} from '@/lib/paypal/importService';
import { TransactionSearchError } from '@/lib/paypal/transactionSearch';
import { DatabaseConfigurationError } from '@/lib/db/config';

/**
 * POST /api/paypal/import
 *
 * Operator-triggered durable ingestion endpoint.
 * Fetches PayPal Sandbox Reporting records, normalizes them, and persists them into PostgreSQL.
 *
 * Requirements:
 * - Validates requested date window (max 31 days).
 * - Enforces server-side credentials and sandbox isolation.
 * - Idempotently handles duplicates without row duplication.
 * - Quarantines intra-batch and cross-batch collisions.
 * - NEVER automatically executes reconciliation.
 */
export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          error: 'INVALID_PARAMETERS',
          message: 'Request body must be a valid JSON object containing "startDate" and "endDate".',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const { startDate, endDate, page, pageSize, maxPages } = body;

    if (!startDate || typeof startDate !== 'string' || !endDate || typeof endDate !== 'string') {
      return NextResponse.json(
        {
          error: 'INVALID_PARAMETERS',
          message: 'Both "startDate" and "endDate" are required in RFC 3339 format (e.g. "2026-11-01T00:00:00Z").',
        },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const result = await importPayPalTransactions({
      startDate,
      endDate,
      page: typeof page === 'number' ? page : undefined,
      pageSize: typeof pageSize === 'number' ? pageSize : undefined,
      maxPages: typeof maxPages === 'number' ? maxPages : undefined,
    });

    return NextResponse.json(result, {
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
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    if (err instanceof DatabaseConfigurationError) {
      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
        },
        {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }

    const errorMessage =
      err instanceof Error ? err.message : 'Internal error executing PayPal transaction import.';

    return NextResponse.json(
      {
        error: 'IMPORT_FAILED',
        message: errorMessage,
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}

