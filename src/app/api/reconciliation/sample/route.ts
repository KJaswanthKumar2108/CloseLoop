import { NextResponse } from 'next/server';
import {
  generateDemoOrdersCsv,
  generateDemoTransactionsCsv,
  DEMO_ORDERS,
  DEMO_TRANSACTIONS,
  DEMO_SCENARIO_MANIFEST,
} from '@/lib/reconciliation/fixtures';

export async function GET() {
  try {
    const ordersCsv = generateDemoOrdersCsv();
    const transactionsCsv = generateDemoTransactionsCsv();

    return NextResponse.json(
      {
        success: true,
        datasetOrigin: 'SYNTHETIC_DEMO',
        label: 'SYNTHETIC DEMONSTRATION DATA',
        disclaimer:
          'SYNTHETIC DEMONSTRATION DATA: All records are deterministically generated for demonstration and testing. Not actual PayPal account transactions.',
        metadata: {
          totalOrders: DEMO_ORDERS.length,
          totalTransactions: DEMO_TRANSACTIONS.length,
          scenariosCount: DEMO_SCENARIO_MANIFEST.length,
        },
        ordersCsv,
        transactionsCsv,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error generating sample dataset:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to generate sample demonstration dataset.',
      },
      { status: 500 }
    );
  }
}

