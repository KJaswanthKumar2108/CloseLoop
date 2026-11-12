/**
 * CloseLoop Phase 3D.5: Execution Repository
 * Data access layer for retrieving immutable execution records under tenant isolation.
 */

import { Pool, PoolClient } from 'pg';
import { getReaderPool } from '@/lib/db/pool';
import { CaseExecutionRecord } from './types';

function mapExecutionRow(row: Record<string, unknown>): CaseExecutionRecord {
  return {
    id: String(row.id),
    merchantId: String(row.merchantId),
    caseId: String(row.caseId),
    approvalId: String(row.approvalId),
    recommendationId: String(row.recommendationId),
    actionId: String(row.actionId),
    executionMode: row.executionMode as CaseExecutionRecord['executionMode'],
    idempotencyKey: String(row.idempotencyKey),
    parameterHash: String(row.parameterHash),
    status: row.status as CaseExecutionRecord['status'],
    resultSummary:
      typeof row.resultSummary === 'string'
        ? JSON.parse(row.resultSummary)
        : (row.resultSummary as CaseExecutionRecord['resultSummary']),
    errorCode: row.errorCode ? String(row.errorCode) : null,
    errorMessage: row.errorMessage ? String(row.errorMessage) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    completedAt: row.completedAt
      ? row.completedAt instanceof Date
        ? row.completedAt.toISOString()
        : String(row.completedAt)
      : null,
  };
}

export async function getExecutionById(
  executionId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseExecutionRecord | null> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      approval_id AS "approvalId",
      recommendation_id AS "recommendationId",
      action_id AS "actionId",
      execution_mode AS "executionMode",
      idempotency_key AS "idempotencyKey",
      parameter_hash AS "parameterHash",
      status,
      result_summary AS "resultSummary",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      completed_at AS "completedAt"
    FROM case_executions
    WHERE id = $1 AND merchant_id = $2;`,
    [executionId, merchantId]
  );

  if (res.rows.length === 0) return null;
  return mapExecutionRow(res.rows[0]);
}

export async function listExecutionsForApproval(
  approvalId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseExecutionRecord[]> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      approval_id AS "approvalId",
      recommendation_id AS "recommendationId",
      action_id AS "actionId",
      execution_mode AS "executionMode",
      idempotency_key AS "idempotencyKey",
      parameter_hash AS "parameterHash",
      status,
      result_summary AS "resultSummary",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      completed_at AS "completedAt"
    FROM case_executions
    WHERE approval_id = $1 AND merchant_id = $2
    ORDER BY created_at DESC;`,
    [approvalId, merchantId]
  );

  return res.rows.map(mapExecutionRow);
}

export async function listExecutionsForCase(
  caseId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseExecutionRecord[]> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      approval_id AS "approvalId",
      recommendation_id AS "recommendationId",
      action_id AS "actionId",
      execution_mode AS "executionMode",
      idempotency_key AS "idempotencyKey",
      parameter_hash AS "parameterHash",
      status,
      result_summary AS "resultSummary",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      completed_at AS "completedAt"
    FROM case_executions
    WHERE case_id = $1 AND merchant_id = $2
    ORDER BY created_at DESC;`,
    [caseId, merchantId]
  );

  return res.rows.map(mapExecutionRow);
}

export async function getLatestExecutionForApproval(
  approvalId: string,
  merchantId: string,
  customPoolOrClient?: Pool | PoolClient
): Promise<CaseExecutionRecord | null> {
  const pool = customPoolOrClient || getReaderPool();

  const res = await pool.query(
    `SELECT
      id,
      merchant_id AS "merchantId",
      case_id AS "caseId",
      approval_id AS "approvalId",
      recommendation_id AS "recommendationId",
      action_id AS "actionId",
      execution_mode AS "executionMode",
      idempotency_key AS "idempotencyKey",
      parameter_hash AS "parameterHash",
      status,
      result_summary AS "resultSummary",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      created_at AS "createdAt",
      completed_at AS "completedAt"
    FROM case_executions
    WHERE approval_id = $1 AND merchant_id = $2
    ORDER BY created_at DESC
    LIMIT 1;`,
    [approvalId, merchantId]
  );

  if (res.rows.length === 0) return null;
  return mapExecutionRow(res.rows[0]);
}

