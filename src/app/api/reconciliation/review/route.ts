import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setRecordReview } from '@/lib/workbench/workbenchStore';

const ReviewRequestSchema = z.object({
  recordId: z.string().min(1, 'Record ID is required'),
  reviewStatus: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']),
  notes: z.string().max(1000, 'Notes cannot exceed 1000 characters').optional(),
  operator: z.string().min(1).max(100).default('Financial Operator'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = ReviewRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid review update payload.',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const { recordId, reviewStatus, notes, operator } = parseResult.data;
    const updatedReview = setRecordReview(recordId, reviewStatus, notes, operator);

    return NextResponse.json(
      {
        success: true,
        review: updatedReview,
        message: `Record ${recordId} review status updated to ${reviewStatus}.`,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating record review status:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'Failed to update record review status.',
      },
      { status: 500 }
    );
  }
}

