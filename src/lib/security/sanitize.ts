/**
 * Security and Data Sanitization Utilities
 */

/**
 * Masks an email address to protect customer PII while retaining identification value.
 * e.g., "customer.name@example.com" -> "c***e@example.com"
 */
export function maskEmail(email?: string): string {
  if (!email || !email.includes('@')) return '***@***.***';
  const [local, domain] = email.split('@');
  if (local.length <= 2) {
    return `${local[0] || '*'}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

/**
 * Masks a PayPal Account ID or Card Reference.
 * e.g., "PAYPAL-ACC-987654321" -> "PAYPAL-ACC-***4321"
 */
export function maskIdentifier(id?: string): string {
  if (!id) return '***';
  if (id.length <= 4) return '****';
  return `***${id.slice(-4)}`;
}

/**
 * Strips HTML and unsafe script tags from user inputs.
 */
export function sanitizeInput(input: string): string {
  return input.replace(/<[^>]*>?/gm, '').trim();
}

