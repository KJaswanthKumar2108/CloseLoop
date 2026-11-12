import { describe, it, expect } from 'vitest';
import { DEMO_SCENARIOS } from '../demoScenarios';
import { getActionCatalogEntry } from '@/lib/resolution/catalog';

describe('Phase 4: Hackathon Demonstration Scenarios Suite', () => {
  it('defines exactly three distinct, deterministic demonstration scenarios', () => {
    expect(DEMO_SCENARIOS).toHaveLength(3);
    expect(DEMO_SCENARIOS.map((s) => s.scenarioNumber)).toEqual([1, 2, 3]);
  });

  describe('Scenario 1: Amount Variance', () => {
    const s1 = DEMO_SCENARIOS.find((s) => s.scenarioNumber === 1)!;

    it('models genuine amount variance between merchant order and PayPal capture', () => {
      expect(s1.discrepancyType).toBe('AMOUNT_MISMATCH');
      expect(s1.orderReference).toBe('DEMO-ORD-101');
      expect(s1.expectedAmount).toContain('100.00');
      expect(s1.actualAmount).toContain('85.00');
      expect(s1.variance).toContain('15.00');
    });

    it('proposes valid catalog action INVESTIGATE_AMOUNT_VARIANCE with low uncertainty', () => {
      expect(s1.recommendedActionId).toBe('INVESTIGATE_AMOUNT_VARIANCE');
      const catalogEntry = getActionCatalogEntry(s1.recommendedActionId);
      expect(catalogEntry.actionId).toBe('INVESTIGATE_AMOUNT_VARIANCE');
      expect(s1.uncertaintyScore).toBeLessThanOrEqual(25);
      expect(s1.uncertaintyLevel).toBe('LOW');
    });

    it('contains all 6 end-to-end CloseLoop pipeline stages', () => {
      expect(s1.steps).toHaveLength(6);
      expect(s1.steps[0].title).toContain('Ingest & Detect');
      expect(s1.steps[5].title).toContain('Controlled Dry-Run Simulation');
    });
  });

  describe('Scenario 2: Potential Duplicate Payment', () => {
    const s2 = DEMO_SCENARIOS.find((s) => s.scenarioNumber === 2)!;

    it('models duplicate PayPal transaction captures for a single order', () => {
      expect(s2.discrepancyType).toBe('DUPLICATE_PAYMENT');
      expect(s2.demoPaypalTransactions).toHaveLength(2);
      expect(s2.demoPaypalTransactions[0].amount).toBe(75.0);
      expect(s2.demoPaypalTransactions[1].amount).toBe(75.0);
    });

    it('directs operator to review duplicate rather than performing automatic refund', () => {
      expect(s2.recommendedActionId).toBe('REVIEW_DUPLICATE_PAYMENT');
      const catalogEntry = getActionCatalogEntry(s2.recommendedActionId);
      expect(catalogEntry.requiresHumanReview).toBe(true);
      expect(s2.narrative).toContain('directs the operator to review the duplicate rather than performing an unverified automatic refund');
    });
  });

  describe('Scenario 3: Ambiguous or Incomplete Evidence', () => {
    const s3 = DEMO_SCENARIOS.find((s) => s.scenarioNumber === 3)!;

    it('models an orphan PayPal transaction with high uncertainty', () => {
      expect(s3.discrepancyType).toBe('MISSING_ORDER_IN_MERCHANT');
      expect(s3.uncertaintyScore).toBeGreaterThanOrEqual(50);
      expect(s3.uncertaintyLevel).toBe('VERY_HIGH');
    });

    it('actively suppresses automated resolution and escalates to senior supervisor', () => {
      expect(s3.recommendedActionId).toBe('ESCALATE_FOR_MANUAL_REVIEW');
      const catalogEntry = getActionCatalogEntry(s3.recommendedActionId);
      expect(catalogEntry.riskLevel).toBe('HIGH');
    });
  });

  describe('Demo Data Strict Isolation Boundary', () => {
    it('enforces that every scenario is strictly labeled with DEMO identifiers', () => {
      for (const s of DEMO_SCENARIOS) {
        expect(s.orderReference).toMatch(/^DEMO-/);
        expect(s.demoOrderRecord.orderId).toMatch(/^DEMO-/);
        for (const txn of s.demoPaypalTransactions) {
          expect(txn.transactionId).toMatch(/^DEMO-/);
        }
      }
    });
  });
});

