/**
 * CloseLoop Phase 3D.1 Security Remediation: Trusted Tenant Identity
 * Resolves F-23 (Trusted Tenant Identity & Anti-Spoofing Gate).
 *
 * Enforces server-side authoritative merchant identity resolution.
 * Strictly prevents client-supplied tenant spoofing via headers or body parameters.
 */

import { NextRequest } from 'next/server';

export class TenantSecurityError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus = 403) {
    super(message);
    this.name = 'TenantSecurityError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.setPrototypeOf(this, TenantSecurityError.prototype);
  }
}

/**
 * Returns the authoritative, verified server-side merchant identity.
 * Fails closed if CLOSELOOP_MERCHANT_ID is missing or empty.
 * Single-tenant development deployment boundary is explicitly enforced.
 * (Note: Production multi-tenant authentication will require verified OAuth session tokens).
 */
export function getAuthoritativeServerMerchantId(): string {
  const configuredMerchantId = process.env.CLOSELOOP_MERCHANT_ID;
  if (!configuredMerchantId || configuredMerchantId.trim() === '') {
    throw new TenantSecurityError(
      'MISSING_MERCHANT_CONFIGURATION',
      'Authoritative server merchant identifier (CLOSELOOP_MERCHANT_ID) is not configured. Server must fail closed.',
      500
    );
  }
  return configuredMerchantId.trim();
}

/**
 * Resolves and verifies the merchant identity for an incoming HTTP request.
 * - If client provides x-merchant-id or body merchantId: validates that it matches the server authority.
 * - Any mismatch throws TenantSecurityError('SPOOFED_TENANT_IDENTITY', 403).
 */
export function resolveVerifiedMerchantId(
  req: NextRequest,
  clientSuppliedMerchantId?: string
): string {
  const authoritativeMerchantId = getAuthoritativeServerMerchantId();
  const headerMerchantId = req.headers.get('x-merchant-id');

  // Independently validate client-supplied header identity
  if (headerMerchantId && headerMerchantId.trim() !== '') {
    const trimmed = headerMerchantId.trim();
    if (trimmed !== authoritativeMerchantId) {
      throw new TenantSecurityError(
        'SPOOFED_TENANT_IDENTITY',
        `Client-supplied header merchant identifier '${trimmed}' does not match authoritative server merchant identity. Cross-tenant access forbidden.`,
        403
      );
    }
  }

  // Independently validate client-supplied body parameter identity
  if (clientSuppliedMerchantId && clientSuppliedMerchantId.trim() !== '') {
    const trimmed = clientSuppliedMerchantId.trim();
    if (trimmed !== authoritativeMerchantId) {
      throw new TenantSecurityError(
        'SPOOFED_TENANT_IDENTITY',
        `Client-supplied body merchant identifier '${trimmed}' does not match authoritative server merchant identity. Cross-tenant access forbidden.`,
        403
      );
    }
  }

  return authoritativeMerchantId;
}
