import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '', ...props }) => {
  return (
    <div
      className={`animate-pulse bg-slate-200/80 rounded ${className}`}
      {...props}
    />
  );
};

export const TableRowSkeleton: React.FC<{ cols?: number }> = ({ cols = 4 }) => {
  return (
    <div className="flex items-center gap-4 py-3.5 px-4 border-b border-slate-100">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${
            i === 0
              ? 'w-28 shrink-0'
              : i === 1
              ? 'w-36 shrink-0'
              : i === 2
              ? 'w-24 shrink-0'
              : 'w-20 shrink-0'
          }`}
        />
      ))}
      <div className="flex-1 flex justify-end">
        <Skeleton className="h-7 w-20 rounded-md" />
      </div>
    </div>
  );
};

export const CardSkeleton: React.FC = () => {
  return (
    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-xs space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-3 w-48" />
    </div>
  );
};
