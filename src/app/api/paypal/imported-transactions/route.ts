import { NextRequest, NextResponse } from 'next/server';
import { listImportedTransactions } from '@/lib/db/repositories/paypalTransactionRepository';
import { isDatabaseConfigured, DatabaseConfigurationError } from '@/lib/db/config';
import { TransactionType, TransactionStatus } from '@/types/financial';
import { IdentityCollisionStatus } from '@/lib/db/types';

/**
 * GET /api/paypal/imported-transactions
 *
 * Read-only querying endpoint for durable, persisted PayPal records.
 * Supports multi-parameter filtering, pagination, and eligibility breakdowns.
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

    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const typeParam = searchParams.get('type') as TransactionType | null;
    const statusParam = searchParams.get('status') as TransactionStatus | null;
    const currencyParam = searchParams.get('currency');
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const importRunIdParam = searchParams.get('importRunId');
    const eligibleParam = searchParams.get('reconciliationEligible');
    const collisionParam = searchParams.get('collisionStatus') as IdentityCollisionStatus | null;

    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 50;

    let reconciliationEligible: boolean | undefined = undefined;
    if (eligibleParam === 'true') reconciliationEligible = true;
    if (eligibleParam === 'false') reconciliationEligible = false;

    const result = await listImportedTransactions({
      page: isNaN(page) ? 1 : page,
      pageSize: isNaN(pageSize) ? 50 : pageSize,
      transactionType: typeParam || undefined,
      transactionStatus: statusParam || undefined,
      currency: currencyParam || undefined,
      startDate: startDateParam || undefined,
      endDate: endDateParam || undefined,
      importRunId: importRunIdParam || undefined,
      reconciliationEligible,
      identityCollisionStatus: collisionParam || undefined,
    });

    return NextResponse.json(
      {
        provider: 'PayPal',
        environment: 'sandbox',
        ...result,
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
      err instanceof Error ? err.message : 'Internal error retrieving imported transactions.';

    return NextResponse.json(
      {
        error: 'QUERY_FAILED',
        message: errorMessage,
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

