import { describe, it, expect } from 'vitest';
import {
  RESOLUTION_ACTION_CATALOG,
  getActionCatalogEntry,
  getAllActionCatalogEntries,
} from '../catalog';
import { ActionCatalogId } from '../types';
import { ActionCatalogIdSchema } from '../schemas';

describe('Phase 3D.3: Declarative Resolution Action Catalog', () => {
  it('contains all 8 required declarative actions', () => {
    const entries = getAllActionCatalogEntries();
    expect(entries).toHaveLength(8);

    const expectedActionIds: ActionCatalogId[] = [
      'VERIFY_PAYMENT_REFERENCE',
      'WAIT_FOR_SETTLEMENT',
      'REQUEST_MERCHANT_DOCUMENTATION',
      'REVIEW_REFUND_STATUS',
      'INVESTIGATE_AMOUNT_VARIANCE',
      'REVIEW_DUPLICATE_PAYMENT',
      'ESCALATE_FOR_MANUAL_REVIEW',
      'REVIEW_CASE_EVIDENCE',
    ];

    for (const expectedId of expectedActionIds) {
      expect(RESOLUTION_ACTION_CATALOG[expectedId]).toBeDefined();
      expect(RESOLUTION_ACTION_CATALOG[expectedId].actionId).toBe(expectedId);
    }
  });

  it('validates every catalog action against ActionCatalogIdSchema', () => {
    for (const entry of getAllActionCatalogEntries()) {
      expect(() => ActionCatalogIdSchema.parse(entry.actionId)).not.toThrow();
      expect(entry.title).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(entry.supportedDiscrepancies.length).toBeGreaterThan(0);
      expect(entry.expectedOperatorOutcome).toBeTruthy();
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(entry.riskLevel);
      expect(entry.requiresHumanReview).toBe(true);
    }
  });

  it('rejects unsupported or hallucinated action catalog IDs', () => {
    expect(() => getActionCatalogEntry('EXECUTE_PAYPAL_REFUND')).toThrowError(
      /Unsupported or unknown resolution action catalog ID/
    );
    expect(() => getActionCatalogEntry('AUTO_CLOSE_CASE')).toThrowError(
      /Unsupported or unknown resolution action catalog ID/
    );
    expect(() => getActionCatalogEntry('INVALID_ACTION_123')).toThrowError(
      /Unsupported or unknown resolution action catalog ID/
    );
  });
});
