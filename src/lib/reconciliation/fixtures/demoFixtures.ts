import { MerchantOrder, PaymentTransaction } from '@/types/financial';
import { createMoney } from '../money';

/**
 * GROUND-TRUTH SCENARIO MANIFEST
 * Every scenario is deterministically defined for reproducible verification.
 * ALL RECORDS ARE SYNTHETIC DEMONSTRATION DATA.
 */
export interface DemoScenarioManifestItem {
  scenarioId: string;
  name: string;
  description: string;
  orderIds: string[];
  transactionIds: string[];
  expectedMatchStatus: string;
  expectedDiscrepancyType: string;
}

export const DEMO_SCENARIO_MANIFEST: DemoScenarioManifestItem[] = [
  {
    scenarioId: 'SCENARIO-01-CLEAN-MATCH',
    name: 'Standard Clean Capture (USD)',
    description: 'Clean capture matching order ID and exact minor-unit amount ($120.00).',
    orderIds: ['ORD-DEMO-001'],
    transactionIds: ['TXN-DEMO-001'],
    expectedMatchStatus: 'MATCHED',
    expectedDiscrepancyType: 'NONE',
  },
  {
    scenarioId: 'SCENARIO-02-CLEAN-EUR',
    name: 'Standard Clean Capture (EUR)',
    description: 'Clean European transaction (€85.50) matching invoice reference.',
    orderIds: ['ORD-DEMO-002'],
    transactionIds: ['TXN-DEMO-002'],
    expectedMatchStatus: 'MATCHED',
    expectedDiscrepancyType: 'NONE',
  },
  {
    scenarioId: 'SCENARIO-03-CLEAN-JPY',
    name: 'Zero-Decimal Currency Clean Capture (JPY)',
    description: 'Japanese Yen transaction (¥15,000) with 0 decimal precision.',
    orderIds: ['ORD-DEMO-003'],
    transactionIds: ['TXN-DEMO-003'],
    expectedMatchStatus: 'MATCHED',
    expectedDiscrepancyType: 'NONE',
  },
  {
    scenarioId: 'SCENARIO-04-MISSING-PAYMENT',
    name: 'Unpaid / Missing Transaction',
    description: 'Merchant order confirmed in ledger, but no settlement received from PayPal.',
    orderIds: ['ORD-DEMO-004'],
    transactionIds: [],
    expectedMatchStatus: 'UNMATCHED_ORDER',
    expectedDiscrepancyType: 'MISSING_PAYMENT',
  },
  {
    scenarioId: 'SCENARIO-05-UNMATCHED-TRANSACTION',
    name: 'Orphaned PayPal Payment',
    description: 'Customer sent $200.00 via PayPal, but no order reference exists in merchant ledger.',
    orderIds: [],
    transactionIds: ['TXN-DEMO-005'],
    expectedMatchStatus: 'UNMATCHED_TRANSACTION',
    expectedDiscrepancyType: 'MISSING_METADATA',
  },
  {
    scenarioId: 'SCENARIO-06-AMOUNT-MISMATCH',
    name: 'Gross Amount Variance',
    description: 'Order expected $300.00, but customer was charged $275.00 due to unrecorded discount coupon.',
    orderIds: ['ORD-DEMO-006'],
    transactionIds: ['TXN-DEMO-006'],
    expectedMatchStatus: 'DISCREPANCY',
    expectedDiscrepancyType: 'AMOUNT_MISMATCH',
  },
  {
    scenarioId: 'SCENARIO-07-CURRENCY-MISMATCH',
    name: 'Cross-Currency Billing Error',
    description: 'Order issued in USD, but payment settled in EUR without automated conversion.',
    orderIds: ['ORD-DEMO-007'],
    transactionIds: ['TXN-DEMO-007'],
    expectedMatchStatus: 'DISCREPANCY',
    expectedDiscrepancyType: 'CURRENCY_MISMATCH',
  },
  {
    scenarioId: 'SCENARIO-08-PENDING-SETTLEMENT',
    name: 'Settlement Timing Delay',
    description: 'Transaction in PENDING state awaiting bank clearing cutoff.',
    orderIds: ['ORD-DEMO-008'],
    transactionIds: ['TXN-DEMO-008'],
    expectedMatchStatus: 'DISCREPANCY',
    expectedDiscrepancyType: 'TIMING_DELAY',
  },
  {
    scenarioId: 'SCENARIO-09-DISPUTE-HOLD',
    name: 'Customer Dispute / Chargeback Hold',
    description: 'PayPal placed $450.00 on hold due to an open merchandise dispute.',
    orderIds: ['ORD-DEMO-009'],
    transactionIds: ['TXN-DEMO-009'],
    expectedMatchStatus: 'DISCREPANCY',
    expectedDiscrepancyType: 'DISPUTE_HOLD',
  },
  {
    scenarioId: 'SCENARIO-10-MULTI-CAPTURE',
    name: 'Multiple Partial Captures',
    description: 'Order for $200.00 settled via two split captures ($120.00 + $80.00).',
    orderIds: ['ORD-DEMO-010'],
    transactionIds: ['TXN-DEMO-010A', 'TXN-DEMO-010B'],
    expectedMatchStatus: 'MATCHED',
    expectedDiscrepancyType: 'NONE',
  },
  {
    scenarioId: 'SCENARIO-11-AMBIGUOUS-CANDIDATES',
    name: 'Ambiguous Competing Candidates',
    description: 'Two separate orders with identical amount and timestamps competing for transactions without reference.',
    orderIds: ['ORD-DEMO-011A', 'ORD-DEMO-011B'],
    transactionIds: ['TXN-DEMO-011A', 'TXN-DEMO-011B'],
    expectedMatchStatus: 'AMBIGUOUS',
    expectedDiscrepancyType: 'CONFLICTING_REFERENCES',
  },
];

/**
 * Builds at least 50 synthetic merchant orders deterministically.
 */
export function generateSyntheticOrders(): MerchantOrder[] {
  const orders: MerchantOrder[] = [
    // Seeded Scenario Orders
    {
      id: 'ord_demo_001',
      merchantOrderId: 'ORD-DEMO-001',
      externalReference: 'INV-2026-001',
      expectedAmount: createMoney(12000, 'USD'), // $120.00
      currency: 'USD',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
      customerReference: 'cust_001@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-01' },
    },
    {
      id: 'ord_demo_002',
      merchantOrderId: 'ORD-DEMO-002',
      externalReference: 'INV-2026-002',
      expectedAmount: createMoney(8550, 'EUR'), // €85.50
      currency: 'EUR',
      createdAt: '2026-11-01T11:00:00.000Z',
      updatedAt: '2026-11-01T11:00:00.000Z',
      customerReference: 'cust_002@example.de',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-02' },
    },
    {
      id: 'ord_demo_003',
      merchantOrderId: 'ORD-DEMO-003',
      externalReference: 'INV-2026-003',
      expectedAmount: createMoney(15000, 'JPY'), // ¥15,000
      currency: 'JPY',
      createdAt: '2026-11-01T12:00:00.000Z',
      updatedAt: '2026-11-01T12:00:00.000Z',
      customerReference: 'cust_003@example.jp',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-03' },
    },
    {
      id: 'ord_demo_004',
      merchantOrderId: 'ORD-DEMO-004',
      externalReference: 'INV-2026-004',
      expectedAmount: createMoney(4999, 'USD'), // $49.99
      currency: 'USD',
      createdAt: '2026-11-01T13:00:00.000Z',
      updatedAt: '2026-11-01T13:00:00.000Z',
      customerReference: 'cust_004@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-04' },
    },
    {
      id: 'ord_demo_006',
      merchantOrderId: 'ORD-DEMO-006',
      externalReference: 'INV-2026-006',
      expectedAmount: createMoney(30000, 'USD'), // $300.00
      currency: 'USD',
      createdAt: '2026-11-01T14:00:00.000Z',
      updatedAt: '2026-11-01T14:00:00.000Z',
      customerReference: 'cust_006@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PARTIALLY_PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-06' },
    },
    {
      id: 'ord_demo_007',
      merchantOrderId: 'ORD-DEMO-007',
      externalReference: 'INV-2026-007',
      expectedAmount: createMoney(25000, 'USD'), // $250.00
      currency: 'USD',
      createdAt: '2026-11-01T15:00:00.000Z',
      updatedAt: '2026-11-01T15:00:00.000Z',
      customerReference: 'cust_007@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-07' },
    },
    {
      id: 'ord_demo_008',
      merchantOrderId: 'ORD-DEMO-008',
      externalReference: 'INV-2026-008',
      expectedAmount: createMoney(18000, 'USD'), // $180.00
      currency: 'USD',
      createdAt: '2026-11-01T16:00:00.000Z',
      updatedAt: '2026-11-01T16:00:00.000Z',
      customerReference: 'cust_008@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'AUTHORIZED',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-08' },
    },
    {
      id: 'ord_demo_009',
      merchantOrderId: 'ORD-DEMO-009',
      externalReference: 'INV-2026-009',
      expectedAmount: createMoney(45000, 'USD'), // $450.00
      currency: 'USD',
      createdAt: '2026-11-01T17:00:00.000Z',
      updatedAt: '2026-11-01T17:00:00.000Z',
      customerReference: 'cust_009@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-09' },
    },
    {
      id: 'ord_demo_010',
      merchantOrderId: 'ORD-DEMO-010',
      externalReference: 'INV-2026-010',
      expectedAmount: createMoney(20000, 'USD'), // $200.00
      currency: 'USD',
      createdAt: '2026-11-01T18:00:00.000Z',
      updatedAt: '2026-11-01T18:00:00.000Z',
      customerReference: 'cust_010@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-10' },
    },
    {
      id: 'ord_demo_011a',
      merchantOrderId: 'ORD-DEMO-011A',
      externalReference: 'INV-2026-011A',
      expectedAmount: createMoney(9900, 'USD'), // $99.00
      currency: 'USD',
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      customerReference: 'cust_011a@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-11' },
    },
    {
      id: 'ord_demo_011b',
      merchantOrderId: 'ORD-DEMO-011B',
      externalReference: 'INV-2026-011B',
      expectedAmount: createMoney(9900, 'USD'), // $99.00
      currency: 'USD',
      createdAt: '2026-11-02T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      customerReference: 'cust_011b@example.com',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, scenario: 'SCENARIO-11' },
    },
  ];

  // Generate 42 more regular cleanly matching orders to reach > 50 total orders
  for (let i = 12; i <= 53; i++) {
    const padded = i.toString().padStart(3, '0');
    const amountMinor = 5000 + i * 250; // varies deterministically
    orders.push({
      id: `ord_demo_${padded}`,
      merchantOrderId: `ORD-DEMO-${padded}`,
      externalReference: `INV-2026-${padded}`,
      expectedAmount: createMoney(amountMinor, 'USD'),
      currency: 'USD',
      createdAt: `2026-11-03T${(i % 12 + 8).toString().padStart(2, '0')}:15:00.000Z`,
      updatedAt: `2026-11-03T${(i % 12 + 8).toString().padStart(2, '0')}:15:00.000Z`,
      customerReference: `customer_${padded}@enterprise.com`,
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PAID',
      source: 'SYNTHETIC_DEMO',
      metadata: { isSyntheticDemo: true, index: i },
    });
  }

  return orders;
}

/**
 * Builds corresponding synthetic PayPal transactions deterministically.
 */
export function generateSyntheticTransactions(): PaymentTransaction[] {
  const txns: PaymentTransaction[] = [
    // TXN for Scenario 01
    {
      id: 'txn_demo_001',
      paypalTransactionId: 'TXN-DEMO-001',
      paypalOrderId: 'ORD-DEMO-001',
      merchantReference: 'INV-2026-001',
      grossAmount: createMoney(12000, 'USD'),
      feeAmount: createMoney(468, 'USD'),
      netAmount: createMoney(11532, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T10:02:15.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 01',
    },
    // TXN for Scenario 02
    {
      id: 'txn_demo_002',
      paypalTransactionId: 'TXN-DEMO-002',
      paypalOrderId: 'ORD-DEMO-002',
      merchantReference: 'INV-2026-002',
      grossAmount: createMoney(8550, 'EUR'),
      feeAmount: createMoney(337, 'EUR'),
      netAmount: createMoney(8213, 'EUR'),
      currency: 'EUR',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T11:05:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 02',
    },
    // TXN for Scenario 03
    {
      id: 'txn_demo_003',
      paypalTransactionId: 'TXN-DEMO-003',
      paypalOrderId: 'ORD-DEMO-003',
      merchantReference: 'INV-2026-003',
      grossAmount: createMoney(15000, 'JPY'),
      feeAmount: createMoney(550, 'JPY'),
      netAmount: createMoney(14450, 'JPY'),
      currency: 'JPY',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T12:10:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 03',
    },
    // TXN for Scenario 05 (Orphaned / Unmatched)
    {
      id: 'txn_demo_005',
      paypalTransactionId: 'TXN-DEMO-005',
      grossAmount: createMoney(20000, 'USD'),
      feeAmount: createMoney(747, 'USD'),
      netAmount: createMoney(19253, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T13:45:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 05',
    },
    // TXN for Scenario 06 (Amount Mismatch: $275 instead of $300)
    {
      id: 'txn_demo_006',
      paypalTransactionId: 'TXN-DEMO-006',
      paypalOrderId: 'ORD-DEMO-006',
      merchantReference: 'INV-2026-006',
      grossAmount: createMoney(27500, 'USD'),
      feeAmount: createMoney(1009, 'USD'),
      netAmount: createMoney(26491, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T14:05:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 06',
    },
    // TXN for Scenario 07 (Currency Mismatch: settled in EUR instead of USD)
    {
      id: 'txn_demo_007',
      paypalTransactionId: 'TXN-DEMO-007',
      paypalOrderId: 'ORD-DEMO-007',
      merchantReference: 'INV-2026-007',
      grossAmount: createMoney(25000, 'EUR'),
      feeAmount: createMoney(922, 'EUR'),
      netAmount: createMoney(24078, 'EUR'),
      currency: 'EUR',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T15:02:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 07',
    },
    // TXN for Scenario 08 (Pending Settlement)
    {
      id: 'txn_demo_008',
      paypalTransactionId: 'TXN-DEMO-008',
      paypalOrderId: 'ORD-DEMO-008',
      merchantReference: 'INV-2026-008',
      grossAmount: createMoney(18000, 'USD'),
      feeAmount: createMoney(677, 'USD'),
      netAmount: createMoney(17323, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'PENDING',
      transactionTime: '2026-11-01T16:03:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 08',
    },
    // TXN for Scenario 09 (Dispute Hold)
    {
      id: 'txn_demo_009',
      paypalTransactionId: 'TXN-DEMO-009',
      paypalOrderId: 'ORD-DEMO-009',
      merchantReference: 'INV-2026-009',
      grossAmount: createMoney(45000, 'USD'),
      feeAmount: createMoney(1620, 'USD'),
      netAmount: createMoney(43380, 'USD'),
      currency: 'USD',
      transactionType: 'DISPUTE_HOLD',
      transactionStatus: 'REVERSED',
      transactionTime: '2026-11-01T17:15:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 09',
    },
    // TXNs for Scenario 10 (Multi-Capture: $120 + $80 = $200)
    {
      id: 'txn_demo_010a',
      paypalTransactionId: 'TXN-DEMO-010A',
      paypalOrderId: 'ORD-DEMO-010',
      merchantReference: 'INV-2026-010',
      grossAmount: createMoney(12000, 'USD'),
      feeAmount: createMoney(468, 'USD'),
      netAmount: createMoney(11532, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-01T18:05:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 10A',
    },
    {
      id: 'txn_demo_010b',
      paypalTransactionId: 'TXN-DEMO-010B',
      paypalOrderId: 'ORD-DEMO-010',
      merchantReference: 'INV-2026-010',
      grossAmount: createMoney(8000, 'USD'),
      feeAmount: createMoney(328, 'USD'),
      netAmount: createMoney(7672, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-02T09:15:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 10B',
    },
    // TXNs for Scenario 11 (Ambiguous Candidates without reference)
    {
      id: 'txn_demo_011a',
      paypalTransactionId: 'TXN-DEMO-011A',
      grossAmount: createMoney(9900, 'USD'),
      feeAmount: createMoney(395, 'USD'),
      netAmount: createMoney(9505, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-02T10:01:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 11A',
    },
    {
      id: 'txn_demo_011b',
      paypalTransactionId: 'TXN-DEMO-011B',
      grossAmount: createMoney(9900, 'USD'),
      feeAmount: createMoney(395, 'USD'),
      netAmount: createMoney(9505, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: '2026-11-02T10:01:00.000Z',
      source: 'SANDBOX_FIXTURE',
      rawReference: 'DEMO FIXTURE ROW 11B',
    },
  ];

  // Generate corresponding transactions for regular orders 12-53
  for (let i = 12; i <= 53; i++) {
    const padded = i.toString().padStart(3, '0');
    const amountMinor = 5000 + i * 250;
    const feeMinor = Math.round(amountMinor * 0.0349 + 49);
    txns.push({
      id: `txn_demo_${padded}`,
      paypalTransactionId: `TXN-DEMO-${padded}`,
      paypalOrderId: `ORD-DEMO-${padded}`,
      merchantReference: `INV-2026-${padded}`,
      grossAmount: createMoney(amountMinor, 'USD'),
      feeAmount: createMoney(feeMinor, 'USD'),
      netAmount: createMoney(amountMinor - feeMinor, 'USD'),
      currency: 'USD',
      transactionType: 'CAPTURE',
      transactionStatus: 'COMPLETED',
      transactionTime: `2026-11-03T${(i % 12 + 8).toString().padStart(2, '0')}:16:30.000Z`,
      source: 'SANDBOX_FIXTURE',
      rawReference: `DEMO FIXTURE ROW ${padded}`,
    });
  }

  return txns;
}

export const DEMO_ORDERS = generateSyntheticOrders();
export const DEMO_TRANSACTIONS = generateSyntheticTransactions();

/**
 * Generate CSV text representation of demo orders.
 */
export function generateDemoOrdersCsv(): string {
  const headers = ['Order ID', 'Expected Amount', 'Currency', 'Order Date', 'Customer', 'Invoice Reference'];
  const rows = DEMO_ORDERS.map((o) => {
    const dec = (o.expectedAmount.amountMinor / Math.pow(10, o.expectedAmount.precision)).toFixed(o.expectedAmount.precision);
    return `"${o.merchantOrderId}","${dec}","${o.currency}","${o.createdAt}","${o.customerReference || ''}","${o.externalReference}"`;
  });
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Generate CSV text representation of demo PayPal transactions.
 */
export function generateDemoTransactionsCsv(): string {
  const headers = ['Transaction ID', 'Gross Amount', 'Fee', 'Net', 'Currency', 'Date', 'Type', 'Status', 'Order ID', 'Custom Reference'];
  const rows = DEMO_TRANSACTIONS.map((t) => {
    const grossDec = (t.grossAmount.amountMinor / Math.pow(10, t.grossAmount.precision)).toFixed(t.grossAmount.precision);
    const feeDec = t.feeAmount ? (t.feeAmount.amountMinor / Math.pow(10, t.feeAmount.precision)).toFixed(t.feeAmount.precision) : '0.00';
    const netDec = t.netAmount ? (t.netAmount.amountMinor / Math.pow(10, t.netAmount.precision)).toFixed(t.netAmount.precision) : grossDec;

    return `"${t.paypalTransactionId}","${grossDec}","${feeDec}","${netDec}","${t.currency}","${t.transactionTime}","${t.transactionType}","${t.transactionStatus}","${t.paypalOrderId || ''}","${t.merchantReference || ''}"`;
  });
  return [headers.join(','), ...rows].join('\n');
}

