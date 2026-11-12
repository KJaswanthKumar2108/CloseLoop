'use client';

import React from 'react';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  FileQuestion,
  CreditCard,
  ClipboardList,
  Clock,
} from 'lucide-react';
import { ReconciliationRun } from '@/types/financial';

interface ReconciliationSummaryCardsProps {
  run: ReconciliationRun | null;
}

export const ReconciliationSummaryCards: React.FC<ReconciliationSummaryCardsProps> = ({ run }) => {
  if (!run) {
    return null;
  }

  // Derive counts directly from the actual backend response and records
  const totalOrders = run.totalOrders;
  const totalTransactions = run.totalTransactions;
  const matchedRecords = run.records.filter((r) => r.matchStatus === 'MATCHED').length;
  const ambiguousRecords = run.records.filter((r) => r.matchStatus === 'AMBIGUOUS').length;
  const discrepancyRecords = run.records.filter((r) => r.matchStatus === 'DISCREPANCY').length;
  const unmatchedOrders = run.unmatchedOrderCount;
  const unmatchedTransactions = run.unmatchedTransactionCount;
  const manualReviewRequired = run.records.filter(
    (r) => r.confidence === 'MANUAL_REVIEW_REQUIRED'
  ).length;

  const metrics = [
    {
      title: 'Total Orders',
      value: totalOrders.toLocaleString(),
      description: 'Imported merchant orders',
      icon: Layers,
      color: 'text-slate-800 bg-slate-100 border-slate-200',
    },
    {
      title: 'Total Transactions',
      value: totalTransactions.toLocaleString(),
      description: 'Imported PayPal settlements',
      icon: CreditCard,
      color: 'text-slate-800 bg-slate-100 border-slate-200',
    },
    {
      title: 'Matched Records',
      value: matchedRecords.toLocaleString(),
      description: 'Exact & corroborated matches',
      icon: CheckCircle2,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    },
    {
      title: 'Discrepancies',
      value: discrepancyRecords.toLocaleString(),
      description: 'Fees, refunds, holds, timing',
      icon: AlertTriangle,
      color: 'text-amber-700 bg-amber-50 border-amber-200',
    },
    {
      title: 'Ambiguous Records',
      value: ambiguousRecords.toLocaleString(),
      description: 'Competing / uncorroborated',
      icon: HelpCircle,
      color: 'text-purple-700 bg-purple-50 border-purple-200',
    },
    {
      title: 'Unmatched Orders',
      value: unmatchedOrders.toLocaleString(),
      description: 'Missing payment from PayPal',
      icon: FileQuestion,
      color: 'text-rose-700 bg-rose-50 border-rose-200',
    },
    {
      title: 'Unmatched Txns',
      value: unmatchedTransactions.toLocaleString(),
      description: 'Missing ledger metadata',
      icon: FileQuestion,
      color: 'text-orange-700 bg-orange-50 border-orange-200',
    },
    {
      title: 'Manual Review Queue',
      value: manualReviewRequired.toLocaleString(),
      description: 'Actionable exception items',
      icon: ClipboardList,
      color: 'text-blue-700 bg-blue-50 border-blue-200',
    },
  ];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span className="font-semibold uppercase tracking-wider text-[11px] text-slate-400">
          Operational Summary (Run: {run.id})
        </span>
        <span className="flex items-center gap-1 font-mono text-[11px]">
          <Clock className="w-3 h-3 text-slate-400" />
          Completed at {new Date(run.completedAt).toLocaleTimeString()}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div
              key={m.title}
              className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between"
            >
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[11px] font-medium text-slate-500 truncate" title={m.title}>
                  {m.title}
                </span>
                <div
                  className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${m.color}`}
                >
                  <Icon className="w-3 h-3" />
                </div>
              </div>

              <div>
                <span className="text-lg font-bold font-mono text-slate-900 block tracking-tight">
                  {m.value}
                </span>
                <span className="text-[10px] text-slate-400 block truncate" title={m.description}>
                  {m.description}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

