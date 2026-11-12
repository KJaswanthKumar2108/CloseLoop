import { NextResponse } from 'next/server';
import { verifyPayPalConnection } from '@/lib/paypal/auth';

/**
 * GET /api/paypal/status
 *
 * Verifies PayPal Sandbox OAuth connectivity and Transaction Search read authorization.
 *
 * Security:
 * - Server-side only
 * - Strictly read-only
 * - Never returns access tokens, client secrets, or authorization headers
 * - Returns sanitized status and actionable messages
 */
export async function GET() {
  try {
    const result = await verifyPayPalConnection();

    let httpStatus = 200;
    if (result.status === 'AUTHENTICATION_FAILED') {
      httpStatus = 401;
    } else if (result.status === 'INSUFFICIENT_SCOPE') {
      httpStatus = 403;
    } else if (result.status === 'SERVICE_UNAVAILABLE') {
      httpStatus = 503;
    }

    return NextResponse.json(result, {
      status: httpStatus,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch {
    return NextResponse.json(
      {
        provider: 'PayPal',
        environment: 'sandbox',
        configured: true,
        authenticated: false,
        transactionSearchAuthorized: false,
        status: 'SERVICE_UNAVAILABLE',
        message: 'Internal error verifying PayPal Sandbox connectivity.',
        checkedAt: new Date().toISOString(),
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

