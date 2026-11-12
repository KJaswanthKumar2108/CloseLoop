import React from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { ProposedAction } from '@/types/approvals';
import { formatMoney } from '@/lib/reconciliation/money';
import { Check, X } from 'lucide-react';

interface ApprovalActionCardProps {
  action: ProposedAction;
  onApprove?: (actionId: string) => void;
  onReject?: (actionId: string) => void;
  isProcessing?: boolean;
}

export const ApprovalActionCard: React.FC<ApprovalActionCardProps> = ({
  action,
  onApprove,
  onReject,
  isProcessing = false,
}) => {
  return (
    <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">
              {action.type}
            </span>
            <StatusBadge status={action.status.toLowerCase()} size="sm" />
          </div>
          <h3 className="text-sm font-semibold text-slate-900 mt-1.5">
            {action.title}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            {action.description}
          </p>
        </div>

        <div className="text-right shrink-0">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">
            Financial Impact
          </span>
          <span className="font-mono text-sm font-bold text-slate-900">
            {formatMoney(action.financialImpact)}
          </span>
        </div>
      </div>

      {action.evidenceCitations.length > 0 && (
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100 text-xs">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-1">
            Grounded Evidence Citations
          </span>
          <div className="flex flex-wrap gap-1.5">
            {action.evidenceCitations.map((citation) => (
              <span
                key={citation}
                className="font-mono text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded text-slate-700"
              >
                {citation}
              </span>
            ))}
          </div>
        </div>
      )}

      {action.status === 'PENDING_APPROVAL' && (
        <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onReject?.(action.id)}
            disabled={isProcessing}
            leftIcon={<X className="w-3.5 h-3.5 text-rose-600" />}
          >
            Reject
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onApprove?.(action.id)}
            disabled={isProcessing}
            isLoading={isProcessing}
            leftIcon={<Check className="w-3.5 h-3.5 text-emerald-400" />}
          >
            Authorize Action
          </Button>
        </div>
      )}
    </div>
  );
};
