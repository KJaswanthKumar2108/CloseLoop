import { z } from "zod";

/**
 * Fixed PayPal Sandbox Base URL.
 * CloseLoop operates exclusively in PayPal Sandbox mode.
 */
export const PAYPAL_SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com" as const;

/**
 * Schema for environment variables.
 * During development / foundation phase, credentials may be blank,
 * so we validate structure without crashing the app at build time.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  PAYPAL_CLIENT_ID: z.string().optional().default(""),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(""),
  // Backward-compatibility aliases:
  PAYPAL_SECRET: z.string().optional().default(""),
  PAYPAL_ENVIRONMENT: z.string().optional().default("sandbox"),
  PAYPAL_BASE_URL: z.string().url().default(PAYPAL_SANDBOX_BASE_URL),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  // Enforce PAYPAL_ENV must be sandbox if set
  const rawEnv = process.env.PAYPAL_ENV || process.env.PAYPAL_ENVIRONMENT || "sandbox";
  if (rawEnv !== "sandbox") {
    throw new Error(
      `Invalid PAYPAL_ENV="${rawEnv}". CloseLoop strictly enforces PayPal Sandbox mode ("sandbox").`
    );
  }

  const result = envSchema.safeParse({
    NODE_ENV: process.env.NODE_ENV,
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET,
    PAYPAL_SECRET: process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET,
    PAYPAL_ENVIRONMENT: "sandbox",
    PAYPAL_BASE_URL: PAYPAL_SANDBOX_BASE_URL,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
  });

  if (!result.success) {
    console.error("Environment validation issues:", result.error.flatten().fieldErrors);
    cachedEnv = envSchema.parse({
      NODE_ENV: process.env.NODE_ENV || "development",
      PAYPAL_ENV: "sandbox",
      PAYPAL_ENVIRONMENT: "sandbox",
      PAYPAL_BASE_URL: PAYPAL_SANDBOX_BASE_URL,
    });
    return cachedEnv;
  }

  cachedEnv = result.data;
  return cachedEnv;
}

/**
 * Resets cached environment for testing purposes.
 */
export function resetEnvCacheForTesting(): void {
  cachedEnv = null;
}

/**
 * Safe inspection helpers that reveal presence (boolean) without exposing secrets.
 */
export function getEnvironmentStatus() {
  const env = getEnv();
  const effectiveSecret = env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET;
  return {
    nodeEnv: env.NODE_ENV,
    paypalEnvironment: "sandbox" as const,
    paypalBaseUrl: PAYPAL_SANDBOX_BASE_URL,
    geminiModel: env.GEMINI_MODEL,
    hasPaypalClientId: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_ID.trim().length > 0),
    hasPaypalSecret: Boolean(effectiveSecret && effectiveSecret.trim().length > 0),
    hasGeminiApiKey: Boolean(env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0),
  };
}

/**
 * Validates and retrieves server-only PayPal Sandbox credentials.
 * Throws a clean error if credentials are missing or environment is invalid.
 * Never prints secret values in error messages.
 */
export function getPayPalCredentials(): {
  clientId: string;
  clientSecret: string;
  env: "sandbox";
  baseUrl: string;
} {
  const env = getEnv();
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = (env.PAYPAL_CLIENT_SECRET || env.PAYPAL_SECRET)?.trim();

  if (!clientId || clientId.length === 0) {
    throw new Error(
      "Missing PAYPAL_CLIENT_ID. Please configure your PayPal Sandbox client ID in .env.local."
    );
  }

  if (!clientSecret || clientSecret.length === 0) {
    throw new Error(
      "Missing PAYPAL_CLIENT_SECRET. Please configure your PayPal Sandbox client secret in .env.local."
    );
  }

  return {
    clientId,
    clientSecret,
    env: "sandbox",
    baseUrl: PAYPAL_SANDBOX_BASE_URL,
  };
}


