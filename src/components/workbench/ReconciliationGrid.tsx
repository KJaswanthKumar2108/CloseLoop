'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { BryntumReconciliationGridProps } from './BryntumReconciliationGrid';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

const DynamicBryntumGrid = dynamic(
  () =>
    import('./BryntumReconciliationGrid').then((mod) => mod.BryntumReconciliationGrid),
  {
    ssr: false,
    loading: () => (
      <div className="h-[580px] w-full rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs flex flex-col justify-center items-center gap-4">
        <div className="w-full p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="h-4 w-48 bg-slate-200 animate-pulse rounded" />
          <div className="h-4 w-24 bg-slate-200 animate-pulse rounded" />
        </div>
        <div className="w-full flex-1 p-4 space-y-3">
          <TableRowSkeleton />
          <TableRowSkeleton />
          <TableRowSkeleton />
          <TableRowSkeleton />
          <TableRowSkeleton />
          <TableRowSkeleton />
        </div>
      </div>
    ),
  }
);

export const ReconciliationGrid: React.FC<BryntumReconciliationGridProps> = (props) => {
  return <DynamicBryntumGrid {...props} />;
};
