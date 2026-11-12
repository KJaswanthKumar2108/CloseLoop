/**
 * CloseLoop Approvals API Route
 * GET /api/approvals - Lists all pending and decided approval requests for the merchant.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveVerifiedMerchantId,
  TenantSecurityError,
} from '@/lib/security/tenantContext';
import { getReaderPool } from '@/lib/db/pool';
import {
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
  CaseApprovalRecord,
} from '@/lib/approvals/types';

export async function GET(req: NextRequest) {
  try {
    let merchantId: string;
    try {
      merchantId = resolveVerifiedMerchantId(req);
    } catch (authErr) {
      if (authErr instanceof TenantSecurityError) {
        return NextResponse.json(
          {
            error: authErr.code,
            code: authErr.code,
            message: authErr.message,
          },
          { status: authErr.httpStatus }
        );
      }
      throw authErr;
    }

    const pool = getReaderPool();
    const res = await pool.query(
      `SELECT
        id,
        merchant_id AS "merchantId",
        case_id AS "caseId",
        recommendation_id AS "recommendationId",
        action_id AS "actionId",
        action_parameters AS "actionParameters",
        case_version AS "caseVersion",
        evidence_fingerprint AS "evidenceFingerprint",
        canonical_binding_hash AS "canonicalBindingHash",
        status,
        requested_by AS "requestedBy",
        decided_by AS "decidedBy",
        decision_reason AS "decisionReason",
        decision_timestamp AS "decisionTimestamp",
        created_at AS "createdAt",
        expires_at AS "expiresAt"
      FROM case_approvals
      WHERE merchant_id = $1
      ORDER BY created_at DESC
      LIMIT 100;`,
      [merchantId]
    );

    const now = new Date();
    const approvals: CaseApprovalRecord[] = res.rows.map((row) => {
      let effectiveStatus = row.status;
      const expiresAt = new Date(row.expiresAt);
      if (row.status === 'PENDING_APPROVAL' && now > expiresAt) {
        effectiveStatus = 'EXPIRED';
      }

      return {
        ...row,
        status: effectiveStatus,
        actionParameters:
          typeof row.actionParameters === 'string'
            ? JSON.parse(row.actionParameters)
            : row.actionParameters,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
        expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : String(row.expiresAt),
        decisionTimestamp: row.decisionTimestamp
          ? row.decisionTimestamp instanceof Date
            ? row.decisionTimestamp.toISOString()
            : String(row.decisionTimestamp)
          : null,
        displayLabel:
          effectiveStatus === 'APPROVED' ? APPROVED_AWAITING_EXECUTION_LABEL : undefined,
        disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
      };
    });

    return NextResponse.json(
      {
        success: true,
        approvals,
        disclaimer: MANDATORY_APPROVAL_DISCLAIMER,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: unknown) {
    console.error('[CloseLoop API Error] GET /api/approvals:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred while retrieving approvals queue.',
      },
      { status: 500 }
    );
  }
}
