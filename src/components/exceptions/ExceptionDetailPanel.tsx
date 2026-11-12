import React from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Sparkles, ArrowRight, ShieldAlert } from 'lucide-react';
import { DiscrepancyType } from '@/types/financial';

interface ExceptionDetailPanelProps {
  id: string;
  transactionRef: string;
  discrepancyType: DiscrepancyType;
  expectedAmount: string;
  settledAmount: string;
  varianceAmount: string;
  currency: string;
  onInvestigate?: () => void;
}

export const ExceptionDetailPanel: React.FC<ExceptionDetailPanelProps> = ({
  transactionRef,
  discrepancyType,
  expectedAmount,
  settledAmount,
  varianceAmount,
  currency,
  onInvestigate,
}) => {
  return (
    <div className="p-5 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <span className="font-mono text-xs font-semibold text-slate-800">
            {transactionRef}
          </span>
        </div>
        <StatusBadge status="discrepancy" label={discrepancyType} size="sm" />
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">
            Expected Ledger
          </span>
          <span className="font-mono font-semibold text-slate-800">
            {currency} {expectedAmount}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-semibold">
            PayPal Settled
          </span>
          <span className="font-mono font-semibold text-slate-800">
            {currency} {settledAmount}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-amber-50/80 border border-amber-200">
          <span className="text-amber-700 block text-[10px] uppercase font-semibold">
            Variance
          </span>
          <span className="font-mono font-bold text-amber-900">
            {currency} {varianceAmount}
          </span>
        </div>
      </div>

      <div className="pt-2 flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={onInvestigate}
          leftIcon={<Sparkles className="w-3.5 h-3.5 text-teal-600" />}
          rightIcon={<ArrowRight className="w-3.5 h-3.5 text-slate-400" />}
        >
          Send to AI Copilot
        </Button>
      </div>
    </div>
  );
};

