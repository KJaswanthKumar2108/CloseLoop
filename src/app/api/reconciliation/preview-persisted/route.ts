import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeReconciliationRun } from '@/lib/reconciliation/service';
import { importMerchantOrdersCsv } from '@/lib/reconciliation/importer';
import { MerchantOrderSchema } from '@/lib/validation/schemas';
import {
  fetchEligibleTransactionsForReconciliation,
  PersistedLedgerError,
} from '@/lib/reconciliation/adapters/paypalPersistenceAdapter';
import { MerchantOrder } from '@/types/financial';

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB limit
const MAX_DATASET_LIMIT = 5000;
const MAX_DATE_RANGE_DAYS = 31;
const MAX_DATE_RANGE_MS = MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;

// Schema for persisted reconciliation preview payload
const PreviewPersistedPayloadSchema = z.object({
  startDate: z.string().min(1, 'startDate is required'),
  endDate: z.string().min(1, 'endDate is required'),
  acknowledgedPartial: z.boolean().optional(),
  ordersCsv: z.string().max(5 * 1024 * 1024, 'Orders CSV exceeds maximum 5MB limit').optional(),
  orders: z.array(MerchantOrderSchema).optional(),
  config: z
    .object({
      timestampToleranceSeconds: z.number().int().min(60).max(2592000).optional(),
      allowMultiCapture: z.boolean().optional(),
      strictCurrencyMatching: z.boolean().optional(),
      candidateScoreThreshold: z.number().min(0).max(100).optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 1. Content-Type check
    const contentType = req.headers.get('content-type');
    if (!contentType || !contentType.toLowerCase().includes('application/json')) {
      return NextResponse.json(
        {
          error: 'Unsupported Media Type',
          code: 'UNSUPPORTED_MEDIA_TYPE',
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
          code: 'PAYLOAD_TOO_LARGE',
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
                code: 'PAYLOAD_TOO_LARGE',
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
            code: 'EMPTY_BODY',
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
            code: 'INVALID_JSON',
            message: 'Invalid JSON payload.',
          },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'EMPTY_BODY',
          message: 'Request body cannot be empty.',
        },
        { status: 400 }
      );
    }

    // 4. Schema validation
    const parseResult = PreviewPersistedPayloadSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: 'Invalid reconciliation preview request payload.',
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // 5. Merchant Orders Mutual Exclusivity (XOR) Validation (F-14)
    if (data.ordersCsv && data.orders) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'MUTUALLY_EXCLUSIVE_INPUTS',
          message: "Provide either 'ordersCsv' or 'orders', not both.",
        },
        { status: 400 }
      );
    }

    if (!data.ordersCsv && !data.orders) {
      return NextResponse.json(
        {
          error: 'Bad Request',
          code: 'MISSING_MERCHANT_ORDERS',
          message: "Merchant orders dataset is required. Provide either 'ordersCsv' or 'orders'.",
        },
        { status: 400 }
      );
    }

    // 6. Date Range Validation (F-07)
    const startMillis = new Date(data.startDate).getTime();
    const endMillis = new Date(data.endDate).getTime();

    if (isNaN(startMillis) || isNaN(endMillis)) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: 'startDate and endDate must be valid RFC 3339 timestamps.',
        },
        { status: 400 }
      );
    }

    if (startMillis >= endMillis) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: 'startDate must be strictly earlier than endDate.',
        },
        { status: 400 }
      );
    }

    if (endMillis - startMillis > MAX_DATE_RANGE_MS) {
      return NextResponse.json(
        {
          error: 'Validation Error',
          code: 'VALIDATION_ERROR',
          message: `Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`,
        },
        { status: 400 }
      );
    }

    // 7. Parse / Validate Merchant Orders
    let normalizedOrders: MerchantOrder[];
    let ordersSource: 'CSV' | 'JSON';

    if (data.orders) {
      ordersSource = 'JSON';
      if (data.orders.length > MAX_DATASET_LIMIT) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            code: 'ORDER_ROW_LIMIT_EXCEEDED',
            message: `Merchant orders array contains ${data.orders.length.toLocaleString()} items, exceeding maximum limit of 5,000.`,
          },
          { status: 400 }
        );
      }
      normalizedOrders = data.orders;
    } else {
      ordersSource = 'CSV';
      const ordersImportResult = importMerchantOrdersCsv(data.ordersCsv!);

      if (ordersImportResult.validationErrors.length > 0 && ordersImportResult.validRows === 0) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            code: 'INVALID_CSV_FORMAT',
            message:
              ordersImportResult.validationErrors.map((e) => `Row ${e.rowNumber}: ${e.message}`).join('; ') ||
              'Invalid CSV format.',
          },
          { status: 400 }
        );
      }

      if (
        ordersImportResult.validRows > MAX_DATASET_LIMIT ||
        ordersImportResult.totalRows > MAX_DATASET_LIMIT
      ) {
        return NextResponse.json(
          {
            error: 'Bad Request',
            code: 'ORDER_ROW_LIMIT_EXCEEDED',
            message: `Merchant orders CSV contains ${ordersImportResult.totalRows} data rows, exceeding maximum limit of 5,000.`,
          },
          { status: 400 }
        );
      }

      normalizedOrders = ordersImportResult.normalizedRecords;
    }

    // 8. Fetch Persisted PayPal Transactions with Advisory Lock & Snapshot Isolation (F-15, F-16, F-17, F-18)
    const sourcingResult = await fetchEligibleTransactionsForReconciliation({
      startDate: new Date(startMillis).toISOString(),
      endDate: new Date(endMillis).toISOString(),
      acknowledgedPartial: data.acknowledgedPartial,
    });

    // 9. Execute In-Memory Deterministic Reconciliation Run
    // NOTE: transactionsFileId is strictly left undefined for persisted database sourcing (F-11)
    const run = executeReconciliationRun({
      orders: normalizedOrders,
      transactions: sourcingResult.transactions,
      config: data.config,
    });

    // 10. Return Response Envelope with Extended Sourcing Metadata (F-09, F-11)
    return NextResponse.json(
      {
        success: true,
        run,
        metadata: {
          datasetOrigin: 'PAYPAL_DURABLE_LEDGER',
          startDate: new Date(startMillis).toISOString(),
          endDate: new Date(endMillis).toISOString(),
          totalEligibleCount: sourcingResult.totalEligibleCount,
          reconciledTransactionCount: sourcingResult.transactions.length,
          adapterRejectedCount: sourcingResult.adapterRejectedCount,
          adapterRejections: sourcingResult.adapterRejections,
          isPartial: sourcingResult.isPartial,
          partialNotice: sourcingResult.partialNotice,
          intersectingIncompleteRuns: sourcingResult.intersectingIncompleteRuns,
          ordersSource,
          ordersCount: normalizedOrders.length,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof PersistedLedgerError) {
      return NextResponse.json(
        {
          error: err.name,
          code: err.code,
          message: err.message,
          details: err.details,
        },
        { status: err.httpStatus }
      );
    }

    console.error('[CloseLoop Persisted Reconciliation Error]:', err);
    return NextResponse.json(
      {
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
