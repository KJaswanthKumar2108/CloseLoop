import React from 'react';

export type StatusVariant =
  | 'matched'
  | 'discrepancy'
  | 'unmatched'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'neutral'
  | 'info';

interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  size?: 'sm' | 'md';
  showDot?: boolean;
  className?: string;
}

const variantConfig: Record<
  StatusVariant,
  { bg: string; text: string; border: string; dot: string; defaultLabel: string }
> = {
  matched: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    defaultLabel: 'Matched',
  },
  approved: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    dot: 'bg-emerald-500',
    defaultLabel: 'Approved',
  },
  discrepancy: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
    defaultLabel: 'Discrepancy',
  },
  unmatched: {
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    dot: 'bg-rose-500',
    defaultLabel: 'Unmatched',
  },
  rejected: {
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    dot: 'bg-rose-500',
    defaultLabel: 'Rejected',
  },
  pending: {
    bg: 'bg-blue-50',
    text: 'text-blue-800',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
    defaultLabel: 'Pending Review',
  },
  info: {
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    dot: 'bg-teal-500',
    defaultLabel: 'Info',
  },
  neutral: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
    dot: 'bg-slate-400',
    defaultLabel: 'Neutral',
  },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  size = 'md',
  showDot = true,
  className = '',
}) => {
  const normalizedKey = (status.toLowerCase() in variantConfig
    ? status.toLowerCase()
    : 'neutral') as StatusVariant;

  const config = variantConfig[normalizedKey];
  const displayLabel = label || config.defaultLabel;

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5 gap-1.5 font-medium',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-semibold',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border ${config.bg} ${config.text} ${config.border} ${sizeStyles[size]} ${className}`}
    >
      {showDot && (
        <span
          className={`w-1.5 h-1.5 rounded-full ${config.dot} shrink-0`}
          aria-hidden="true"
        />
      )}
      <span>{displayLabel}</span>
    </span>
  );
};

