import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json(
    {
      status: 'planned',
      phase: 'Phase 4: Evidence-Grounded AI Copilot',
      service: 'gemini-copilot',
      message:
        'Evidence-grounded exception investigation and remediation proposal engine is scheduled for Phase 4.',
      documentation: '/docs/BUILD_PLAN.md#phase-4-evidence-grounded-ai-copilot-planned',
    },
    { status: 200 }
  );
}
