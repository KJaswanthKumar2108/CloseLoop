import { NextResponse } from 'next/server';
import { getEnvironmentStatus } from '@/lib/env';

export async function GET() {
  const envStatus = getEnvironmentStatus();

  // The application is operational; report configuration readiness without revealing secrets
  const isHealthy = true;

  return NextResponse.json(
    {
      status: isHealthy ? 'healthy' : 'degraded',
      service: 'closeloop-api',
      timestamp: new Date().toISOString(),
      environment: envStatus.nodeEnv,
      configuration: {
        paypalEnvironment: envStatus.paypalEnvironment,
        paypalClientIdConfigured: envStatus.hasPaypalClientId,
        paypalSecretConfigured: envStatus.hasPaypalSecret,
        geminiApiKeyConfigured: envStatus.hasGeminiApiKey,
        geminiModel: envStatus.geminiModel,
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
