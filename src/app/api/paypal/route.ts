import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'planned',
      phase: 'Phase 2: PayPal Server SDK Ingestion',
      service: 'paypal-sync',
      message:
        'PayPal Sandbox transaction history and settlement ingestion pipeline is scheduled for Phase 2.',
      documentation: '/docs/BUILD_PLAN.md#phase-2-paypal-server-sdk-client--data-ingestion-planned',
    },
    { status: 200 }
  );
}
