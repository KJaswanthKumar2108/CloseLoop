'use client';

import React, { useRef, useMemo, useCallback } from 'react';
import { BryntumGrid } from '@bryntum/grid-react-community';
import type { Model } from '@bryntum/core-community';
import type { Grid, Column } from '@bryntum/grid-community';
import { ReconciliationRecord, MatchStatus, DiscrepancyType } from '@/types/financial';
import { formatMoney } from '@/lib/reconciliation/money';
import { RecordReviewState } from '@/lib/workbench/workbenchStore';

export interface BryntumReconciliationGridProps {
  records: ReconciliationRecord[];
  reviews: Record<string, RecordReviewState>;
  onSelectRecord: (record: ReconciliationRecord) => void;
  selectedRecordId?: string | null;
  quickFilterText?: string;
  selectedStatus?: string;
  selectedDiscrepancy?: string;
}

interface GridRecordRow extends ReconciliationRecord {
  reviewStatus: string;
  hasNotes: boolean;
}

export const BryntumReconciliationGrid: React.FC<BryntumReconciliationGridProps> = ({
  records,
  reviews,
  onSelectRecord,
  selectedRecordId,
  quickFilterText = '',
  selectedStatus = 'ALL',
  selectedDiscrepancy = 'ALL',
}) => {
  const gridRef = useRef<BryntumGrid>(null);

  // Filter records based on selection and text query
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (selectedStatus !== 'ALL' && r.matchStatus !== selectedStatus) {
        return false;
      }
      if (selectedDiscrepancy !== 'ALL' && r.discrepancyType !== selectedDiscrepancy) {
        return false;
      }
      if (quickFilterText.trim().length > 0) {
        const query = quickFilterText.toLowerCase();
        const matchesQuery =
          r.id.toLowerCase().includes(query) ||
          (r.orderId && r.orderId.toLowerCase().includes(query)) ||
          r.transactionIds.some((t) => t.toLowerCase().includes(query)) ||
          r.matchStatus.toLowerCase().includes(query) ||
          r.discrepancyType.toLowerCase().includes(query);
        if (!matchesQuery) return false;
      }
      return true;
    });
  }, [records, selectedStatus, selectedDiscrepancy, quickFilterText]);

  // Transform records into store data
  const storeData: GridRecordRow[] = useMemo(() => {
    return filteredRecords.map((r) => ({
      ...r,
      reviewStatus: reviews[r.id]?.status || 'UNREVIEWED',
      hasNotes: Boolean(reviews[r.id]?.notes?.trim()),
    }));
  }, [filteredRecords, reviews]);

  const columns = useMemo(
    () => [
      {
        text: 'Record ID',
        field: 'id',
        width: 175,
        renderer: ({ value }: { value: string }) => {
          return `<span class="font-mono text-xs font-semibold text-[#003087] tracking-tight">${value}</span>`;
        },
      },
      {
        text: 'Match Status',
        field: 'matchStatus',
        width: 150,
        renderer: ({ value }: { value: MatchStatus }) => {
          let badgeClass = 'bg-[#F1F5F9] text-[#475569] border-[#CBD5E1]';
          if (value === 'MATCHED') {
            badgeClass = 'bg-[#E8F8F0] text-[#00875A] border-[#B2ECC8]';
          } else if (value === 'DISCREPANCY' || value === 'AMBIGUOUS') {
            badgeClass = 'bg-[#FEF6E7] text-[#D97706] border-[#FCE3B4]';
          } else if (value === 'UNMATCHED_ORDER' || value === 'UNMATCHED_TRANSACTION') {
            badgeClass = 'bg-[#FEECEC] text-[#D92D3F] border-[#FAC0C4]';
          }
          return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${badgeClass}">${value}</span>`;
        },
      },
      {
        text: 'Discrepancy Type',
        field: 'discrepancyType',
        width: 180,
        renderer: ({ value }: { value: DiscrepancyType }) => {
          const isNone = value === 'NONE';
          const badgeClass = isNone
            ? 'bg-[#E8F8F0] text-[#00875A] border-[#B2ECC8]'
            : 'bg-[#FEF6E7] text-[#D97706] border-[#FCE3B4]';
          return `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}">${value}</span>`;
        },
      },
      {
        text: 'Confidence',
        field: 'confidence',
        width: 165,
        renderer: ({ value }: { value: string }) => {
          const isHigh = value === 'EXACT_AUTHORITATIVE' || value === 'COMPOSITE_CONFIRMED';
          const isReview = value === 'MANUAL_REVIEW_REQUIRED';
          const colorClass = isHigh
            ? 'text-[#00875A] bg-[#E8F8F0] border-[#B2ECC8]'
            : isReview
            ? 'text-[#D97706] bg-[#FEF6E7] border-[#FCE3B4]'
            : 'text-[#52657D] bg-[#F1F5F9] border-[#CBD5E1]';
          return `<span class="px-2 py-0.5 rounded text-[10px] font-bold border tracking-wider ${colorClass}">${value}</span>`;
        },
      },
      {
        text: 'Expected (Ledger)',
        field: 'expectedAmount',
        width: 135,
        align: 'right',
        renderer: ({ record }: { record: GridRecordRow }) => {
          if (!record.expectedAmount) {
            return `<span class="text-xs text-[#8291A5] font-mono italic">None</span>`;
          }
          const formatted = formatMoney(record.expectedAmount);
          return `<span class="font-mono text-xs font-semibold text-[#10243E] tabular-nums">${formatted}</span>`;
        },
      },
      {
        text: 'Actual (PayPal)',
        field: 'actualAmount',
        width: 135,
        align: 'right',
        renderer: ({ record }: { record: GridRecordRow }) => {
          if (!record.actualAmount) {
            return `<span class="text-xs text-[#8291A5] font-mono italic">None</span>`;
          }
          const formatted = formatMoney(record.actualAmount);
          return `<span class="font-mono text-xs font-semibold text-[#10243E] tabular-nums">${formatted}</span>`;
        },
      },
      {
        text: 'Variance',
        field: 'varianceAmount',
        width: 115,
        align: 'right',
        renderer: ({ record }: { record: GridRecordRow }) => {
          if (!record.varianceAmount) {
            return `<span class="text-xs text-[#8291A5] font-mono italic tabular-nums">0.00</span>`;
          }
          const isZero = record.varianceAmount.amountMinor === 0;
          const formatted = formatMoney(record.varianceAmount);
          const colorClass = isZero
            ? 'text-[#52657D] font-normal'
            : 'text-[#D92D3F] font-bold bg-[#FEECEC] px-1.5 py-0.5 rounded border border-[#FAC0C4]';
          return `<span class="font-mono text-xs tabular-nums ${colorClass}">${formatted}</span>`;
        },
      },
      {
        text: 'Merchant Order ID',
        field: 'orderId',
        width: 165,
        renderer: ({ value }: { value: string | undefined }) => {
          return value
            ? `<span class="font-mono text-xs text-[#10243E] font-medium">${value}</span>`
            : `<span class="text-xs text-[#8291A5] font-mono italic">None</span>`;
        },
      },
      {
        text: 'PayPal Transaction IDs',
        field: 'transactionIds',
        width: 195,
        renderer: ({ value }: { value: string[] }) => {
          if (!value || value.length === 0) {
            return `<span class="text-xs text-[#8291A5] font-mono italic">None</span>`;
          }
          return `<span class="font-mono text-xs text-[#0070E0] font-medium">${value.join(', ')}</span>`;
        },
      },
      {
        text: 'Matching Method',
        field: 'matchingMethod',
        width: 160,
        renderer: ({ value }: { value: string }) => {
          return `<span class="text-[11px] text-[#52657D] font-mono">${value}</span>`;
        },
      },
    ],
    []
  );

  const handleCellClick = useCallback(
    (event: { grid: Grid; record: Model; column: Column; cellElement: HTMLElement; target: HTMLElement; event: MouseEvent }) => {
      const recordId = String(event.record.id);
      const selected = records.find((r) => r.id === recordId);
      if (selected) {
        onSelectRecord(selected);
      }
    },
    [records, onSelectRecord]
  );

  return (
    <div
      data-selected-record={selectedRecordId || undefined}
      className="bryntum-reconciliation-container h-[600px] w-full rounded-xl overflow-hidden"
    >
      <BryntumGrid
        ref={gridRef}
        data={storeData}
        columns={columns}
        stripeFeature
        quickFindFeature
        sortFeature
        columnResizeFeature
        columnReorderFeature
        cellEditFeature={false}
        onCellClick={handleCellClick}
        autoHeight={false}
      />
    </div>
  );
};
