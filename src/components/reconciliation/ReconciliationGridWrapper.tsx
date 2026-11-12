import React from 'react';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

interface ReconciliationGridWrapperProps {
  isLoading?: boolean;
  children?: React.ReactNode;
}

/**
 * Shell wrapper for the AG Grid Community & AG Studio reconciliation table.
 * Planned for full grid data binding in Phase 3.
 */
export const ReconciliationGridWrapper: React.FC<ReconciliationGridWrapperProps> = ({
  isLoading = false,
  children,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="h-4 w-32 bg-slate-200 animate-pulse rounded" />
          <div className="h-4 w-20 bg-slate-200 animate-pulse rounded" />
        </div>
        <TableRowSkeleton />
        <TableRowSkeleton />
        <TableRowSkeleton />
        <TableRowSkeleton />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
      {children}
    </div>
  );
};

