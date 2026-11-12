import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveRun,
  getRunHistory,
  getDatasetOrigin,
  getRecordReviews,
  setActiveRun,
  DatasetOrigin,
} from '@/lib/workbench/workbenchStore';
import { ReconciliationRun } from '@/types/financial';

export async function GET() {
  try {
    const activeRun = getActiveRun();
    const runHistory = getRunHistory();
    const datasetOrigin = getDatasetOrigin();
    const reviews = getRecordReviews();

    return NextResponse.json(
      {
        success: true,
        activeRun,
        runHistory,
        datasetOrigin,
        reviews,
        persistenceType: 'IN_MEMORY',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error fetching reconciliation workbench state:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to retrieve reconciliation workbench state.',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { run, origin } = body as { run: ReconciliationRun; origin: DatasetOrigin };

    if (!run || !run.id || !Array.isArray(run.records)) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Invalid reconciliation run object provided.',
        },
        { status: 400 }
      );
    }

    setActiveRun(run, origin || 'IMPORTED');

    return NextResponse.json(
      {
        success: true,
        message: 'Reconciliation run active state updated.',
        activeRun: run,
        datasetOrigin: origin || 'IMPORTED',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating reconciliation workbench state:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to update reconciliation workbench state.',
      },
      { status: 500 }
    );
  }
}
