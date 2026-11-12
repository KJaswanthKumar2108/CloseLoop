import { Client, Environment } from '@paypal/paypal-server-sdk';
import { getEnv } from '@/lib/env';

let paypalClientInstance: Client | null = null;

/**
 * Returns the PayPal Server SDK client singleton for server-side operations.
 * Enforces Sandbox environment and checks that credentials are present.
 */
export function getPayPalClient(): Client {
  if (paypalClientInstance) {
    return paypalClientInstance;
  }

  const env = getEnv();
  const secret = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET;

  if (!env.PAYPAL_CLIENT_ID || !secret) {
    throw new Error(
      'PayPal API credentials are not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.local.'
    );
  }

  paypalClientInstance = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: env.PAYPAL_CLIENT_ID,
      oAuthClientSecret: secret,
    },
    environment: Environment.Sandbox,
  });

  return paypalClientInstance;
}

/**
 * Safe helper to check whether PayPal credentials are configured without throwing.
 */
export function isPayPalConfigured(): boolean {
  const env = getEnv();
  const secret = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET;
  return Boolean(env.PAYPAL_CLIENT_ID && secret);
}

