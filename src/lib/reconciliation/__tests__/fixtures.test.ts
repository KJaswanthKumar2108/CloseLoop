import { describe, it, expect } from 'vitest';
import {
  DEMO_ORDERS,
  DEMO_TRANSACTIONS,
  DEMO_SCENARIO_MANIFEST,
  generateDemoOrdersCsv,
  generateDemoTransactionsCsv,
} from '../fixtures/demoFixtures';
import { executeReconciliationRun, executeCsvReconciliationRun } from '../service';

describe('Demonstration Fixtures & Scenario Manifest Verification', () => {
  it('contains at least 50 synthetic orders and corresponding transactions', () => {
    expect(DEMO_ORDERS.length).toBeGreaterThanOrEqual(50);
    expect(DEMO_TRANSACTIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('every fixture record is explicitly labeled as synthetic demo data', () => {
    for (const order of DEMO_ORDERS) {
      expect(order.source).toBe('SYNTHETIC_DEMO');
      expect(order.metadata.isSyntheticDemo).toBe(true);
    }
    for (const txn of DEMO_TRANSACTIONS) {
      expect(txn.source).toBe('SANDBOX_FIXTURE');
      expect(txn.rawReference).toContain('DEMO FIXTURE');
    }
  });

  it('executes deterministic reconciliation across the entire synthetic dataset', () => {
    const run = executeReconciliationRun({
      orders: DEMO_ORDERS,
      transactions: DEMO_TRANSACTIONS,
    });

    expect(run.totalOrders).toBe(DEMO_ORDERS.length);
    expect(run.totalTransactions).toBe(DEMO_TRANSACTIONS.length);
    expect(run.status).toBe('COMPLETED');
    expect(run.matchedCount).toBeGreaterThan(40); // Standard clean orders matched
    expect(run.exceptionCount).toBeGreaterThanOrEqual(4); // Seeded discrepancies detected
  });

  it('verifies that manifest scenarios produce their exact expected match statuses', () => {
    const run = executeReconciliationRun({
      orders: DEMO_ORDERS,
      transactions: DEMO_TRANSACTIONS,
    });

    for (const scenario of DEMO_SCENARIO_MANIFEST) {
      if (scenario.orderIds.length > 0) {
        const orderId = scenario.orderIds[0];
        const record = run.records.find((r) => r.orderId === orderId);

        expect(
          record,
          `Record for scenario "${scenario.name}" (${orderId}) must exist`
        ).toBeDefined();

        expect(
          record?.matchStatus,
          `Scenario "${scenario.name}" matchStatus mismatch`
        ).toBe(scenario.expectedMatchStatus);

        expect(
          record?.discrepancyType,
          `Scenario "${scenario.name}" discrepancyType mismatch`
        ).toBe(scenario.expectedDiscrepancyType);
      }
    }
  });

  it('runs end-to-end reconciliation on generated CSV strings', () => {
    const ordersCsv = generateDemoOrdersCsv();
    const txnsCsv = generateDemoTransactionsCsv();

    expect(ordersCsv).toContain('Order ID');
    expect(txnsCsv).toContain('Transaction ID');

    const result = executeCsvReconciliationRun({
      ordersCsv,
      transactionsCsv: txnsCsv,
    });

    expect(result.ordersImportResult.validRows).toBe(DEMO_ORDERS.length);
    expect(result.transactionsImportResult.validRows).toBe(DEMO_TRANSACTIONS.length);
    expect(result.run.matchedCount).toBeGreaterThan(40);
  });
});

