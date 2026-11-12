import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeReconciliationRun } from '@/lib/reconciliation/service';
import {
  importMerchantOrdersCsv,
  importPayPalTransactionsCsv,
} from '@/lib/reconciliation/importer';
import {
  MerchantOrderSchema,
  PaymentTransactionSchema,
} from '@/lib/validation/schemas';

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB limit
const MAX_CSV_ROW_LIMIT = 5000;

// Request payload schema with strict validation and size boundaries
const PreviewJsonPayloadSchema = z.object({
  mode: z.literal('JSON'),
  orders: z.array(MerchantOrderSchema).max(5000, 'Maximum 5,000 orders per preview batch'),
  transactions: z.array(PaymentTransactionSchema).max(5000, 'Maximum 5,000 transactions per preview batch'),
  config: z
    .object({
      timestampToleranceSeconds: z.number().int().min(60).max(2592000).optional(),
      allowMultiCapture: z.boolean().optional(),
      strictCurrencyMatching: z.boolean().optional(),
      candidateScoreThreshold: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

const PreviewCsvPayloadSchema = z.object({
  mode: z.literal('CSV'),
  ordersCsv: z.string().max(5 * 1024 * 1024, 'Orders CSV exceeds maximum 5MB limit'),
  transactionsCsv: z.string().max(5 * 1024 * 1024, 'Transactions CSV exceeds maximum 5MB limit'),
  config: z
    .object({
      timestampToleranceSeconds: z.number().int().min(60).max(2592000).optional(),
      allowMultiCapture: z.boolean().optional(),
      strictCurrencyMatching: z.boolean().optional(),
      candidateScoreThreshold: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

const PreviewRequestSchema = z.discriminatedUnion('mode', [
  PreviewJsonPayloadSchema,
  PreviewCsvPayloadSchema,
]);

export async function POST(req: NextRequest) {
  try {
    // 1. Content-Type check
    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          message: 'Request Content-Type must be application/json.',
        },
        { status: 415 }
      );
    }

    // 2. Early Content-Length check for DDoS / Memory exhaustion protection
    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        {
          error: 'Payload Too Large',
          message: 'Request payload exceeds the maximum 10MB limit.',
        },
        { status: 413 }
      );
    }

    // 3. Streaming byte count guard to protect against missing/spoofed Content-Length or chunked transfer
    let body: unknown;
    if (req.body) {
      const reader = req.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_PAYLOAD_BYTES) {
            await reader.cancel();
            return NextResponse.json(
              {
                error: 'Payload Too Large',
                message: 'Request payload exceeds the maximum 10MB limit.',
              },
              { status: 413 }
            );
          }
          chunks.push(value);
        }
      }

      const totalBuffer = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        totalBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      const rawText = new TextDecoder().decode(totalBuffer);
      if (!rawText.trim()) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Request body cannot be empty.',
          },
          { status: 400 }
        );
      }
      try {
        body = JSON.parse(rawText);
      } catch {
        return NextResponse.json(
          {
            error: 'Bad Request',
            message: 'Invalid JSON payload.',
          },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        {
          error: 'Bad Request',
          message: 'Request body cannot be empty.',
        },
        { status: 400 }
      );
    }

    // 4. Schema validation
    const parseResult = PreviewRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          message: 'Invalid reconciliation preview request payload.',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // 5. Execute reconciliation based on input mode
    if (data.mode === 'JSON') {
      const run = executeReconciliationRun({
        orders: data.orders,
        transactions: data.transactions,
        config: data.config,
      });

      return NextResponse.json(
        {
          success: true,
          mode: 'JSON',
          run,
        },
        { status: 200 }
      );
    } else {
      const ordersImportResult = importMerchantOrdersCsv(data.ordersCsv);
      const transactionsImportResult = importPayPalTransactionsCsv(data.transactionsCsv);

      // Validate CSV row limits
      if (
        ordersImportResult.validRows > MAX_CSV_ROW_LIMIT ||
        ordersImportResult.totalRows > MAX_CSV_ROW_LIMIT ||
        transactionsImportResult.validRows > MAX_CSV_ROW_LIMIT ||
        transactionsImportResult.totalRows > MAX_CSV_ROW_LIMIT
      ) {
        return NextResponse.json(
          {
            error: 'Payload Too Large',
            message: 'CSV row limit exceeded. Maximum 5,000 rows permitted per file.',
          },
          { status: 400 }
        );
      }

      const run = executeReconciliationRun({
        orders: ordersImportResult.normalizedRecords,
        transactions: transactionsImportResult.normalizedRecords,
        config: data.config,
      });

      return NextResponse.json(
        {
          success: true,
          mode: 'CSV',
          importSummary: {
            orders: {
              totalRows: ordersImportResult.totalRows,
              validRows: ordersImportResult.validRows,
              invalidRows: ordersImportResult.invalidRows,
              duplicateRows: ordersImportResult.duplicateRows,
              validationErrors: ordersImportResult.validationErrors.slice(0, 50),
            },
            transactions: {
              totalRows: transactionsImportResult.totalRows,
              validRows: transactionsImportResult.validRows,
              invalidRows: transactionsImportResult.invalidRows,
              duplicateRows: transactionsImportResult.duplicateRows,
              validationErrors: transactionsImportResult.validationErrors.slice(0, 50),
            },
          },
          run,
        },
        { status: 200 }
      );
    }
  } catch (error: unknown) {
    // Sanitize 500 internal server error responses; log details server-side only
    console.error('Reconciliation preview error:', error);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: 'An unexpected error occurred during reconciliation.',
      },
      { status: 500 }
    );
  }
}
