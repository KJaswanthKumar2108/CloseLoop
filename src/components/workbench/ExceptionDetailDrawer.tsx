'use client';

import React, { useState } from 'react';
import {
  X,
  Coins,
  CheckCircle2,
  Save,
  Info,
} from 'lucide-react';
import { ReconciliationRecord } from '@/types/financial';
import { formatMoney } from '@/lib/reconciliation/money';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWorkbench } from '@/context/WorkbenchContext';
import { Button } from '@/components/ui/Button';
import { ReviewStatus } from '@/lib/workbench/workbenchStore';

interface ExceptionDetailDrawerProps {
  record: ReconciliationRecord | null;
  onClose: () => void;
}

const ExceptionDetailContent: React.FC<{
  record: ReconciliationRecord;
  onClose: () => void;
}> = ({ record, onClose }) => {
  const { reviews, updateReview, activeRun } = useWorkbench();

  const currentReview = reviews[record.id];
  const [selectedStatus, setSelectedStatus] = useState<ReviewStatus>(
    currentReview?.status || 'OPEN'
  );
  const [notes, setNotes] = useState<string>(currentReview?.notes || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [savedFeedback, setSavedFeedback] = useState<boolean>(false);

  const handleSaveReview = async () => {
    setIsSaving(true);
    try {
      await updateReview(record.id, selectedStatus, notes);
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2500);
    } catch (e) {
      console.error('Failed to update review:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const isZeroVariance = record.varianceAmount.amountMinor === 0;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[540px] bg-white border-l border-slate-200 shadow-2xl z-50 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-slate-800">
              Record: {record.id}
            </span>
            <StatusBadge
              status={
                record.matchStatus === 'MATCHED'
                  ? 'matched'
                  : record.matchStatus === 'DISCREPANCY'
                  ? 'discrepancy'
                  : 'unmatched'
              }
              label={record.matchStatus}
              size="sm"
            />
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Run: {activeRun?.id || 'Active Session'} • Evaluated via {record.matchingMethod}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 text-slate-400 hover:text-slate-800 rounded-md hover:bg-slate-200/50 transition-colors"
          title="Close drawer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Drawer Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Identifier Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
              Merchant Order ID
            </span>
            <span className="font-mono text-xs font-bold text-slate-900 block mt-0.5">
              {record.orderId || 'Unmatched (No Order Reference)'}
            </span>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
              PayPal Txn ID(s)
            </span>
            <span
              className="font-mono text-xs font-bold text-slate-900 block mt-0.5 truncate"
              title={record.transactionIds.join(', ')}
            >
              {record.transactionIds.length > 0
                ? record.transactionIds.join(', ')
                : 'Unmatched (No Payment Found)'}
            </span>
          </div>
        </div>

        {/* Minor-Unit Financial Comparison */}
        <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-slate-600" />
            <span>Exact Minor-Unit Settlement Math</span>
          </h3>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-medium">Expected</span>
              <span className="font-mono text-xs font-bold text-slate-800 block mt-0.5">
                {formatMoney(record.expectedAmount)}
              </span>
              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                {record.expectedAmount.amountMinor} minor
              </span>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
              <span className="text-[10px] text-slate-400 block font-medium">Actual Gross</span>
              <span className="font-mono text-xs font-bold text-slate-800 block mt-0.5">
                {formatMoney(record.actualAmount)}
              </span>
              <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                {record.actualAmount.amountMinor} minor
              </span>
            </div>

            <div
              className={`p-2.5 rounded-lg border ${
                isZeroVariance
                  ? 'bg-emerald-50/50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <span className="text-[10px] block font-medium">Variance</span>
              <span className="font-mono text-xs font-bold block mt-0.5">
                {formatMoney(record.varianceAmount)}
              </span>
              <span className="text-[10px] font-mono block mt-0.5">
                {record.varianceAmount.amountMinor} minor
              </span>
            </div>
          </div>
        </div>

        {/* Classification and Confidence */}
        <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-2">
          <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
            Classification & Confidence
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              {record.discrepancyType}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
              Confidence: {record.confidence}
            </span>
            <span className="px-2.5 py-1 rounded-md text-xs font-mono text-slate-600 bg-slate-50 border border-slate-200">
              Rule: {record.evidence?.matchingRule || 'RULE_DEFAULT'}
            </span>
          </div>
        </div>

        {/* Reasons and Evidence Citations */}
        <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
          <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
            Deterministic Engine Evidence
          </span>

          {record.evidence?.reasonsForAccepting && record.evidence.reasonsForAccepting.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-700 block">Accepted Reasons:</span>
              <ul className="space-y-1">
                {record.evidence.reasonsForAccepting.map((reason, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-slate-600 leading-relaxed pl-3 border-l-2 border-teal-500 bg-slate-50/50 p-1.5 rounded-r"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {record.evidence?.reasonsForRejectingCandidates &&
            record.evidence.reasonsForRejectingCandidates.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-slate-100">
                <span className="text-[11px] font-semibold text-slate-700 block">
                  Rejected Candidate Evidence:
                </span>
                <ul className="space-y-1">
                  {record.evidence.reasonsForRejectingCandidates.map((reason, idx) => (
                    <li
                      key={idx}
                      className="text-xs text-slate-600 leading-relaxed pl-3 border-l-2 border-amber-500 bg-slate-50/50 p-1.5 rounded-r"
                    >
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {/* Compared Fields Table */}
          {record.evidence?.comparedFields && record.evidence.comparedFields.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <span className="text-[11px] font-semibold text-slate-700 block">Field Comparisons:</span>
              <div className="rounded-lg border border-slate-200 overflow-hidden text-xs">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Field</th>
                      <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Order</th>
                      <th className="px-2.5 py-1.5 text-left text-[10px] font-semibold text-slate-500 uppercase">Transaction</th>
                      <th className="px-2.5 py-1.5 text-center text-[10px] font-semibold text-slate-500 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {record.evidence.comparedFields.map((field, idx) => (
                      <tr key={idx}>
                        <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-700">{field.field}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-600">{field.orderValue}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[11px] text-slate-600">{field.transactionValue}</td>
                        <td className="px-2.5 py-1.5 text-center">
                          {field.matched ? (
                            <span className="text-emerald-600 font-bold">✓</span>
                          ) : (
                            <span className="text-rose-600 font-bold">✗</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Human Operator Review Workflow (Module C.3) */}
        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
              Operator Review & Annotation
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              Last update: {currentReview?.updatedAt ? new Date(currentReview.updatedAt).toLocaleTimeString() : 'None'}
            </span>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-200 text-amber-900 text-[11px]">
            <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Operator review state provides a workflow annotation layer. It does not alter the underlying deterministic engine matching classification or mutate financial records.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-700 block">Review State:</label>
            <div className="grid grid-cols-4 gap-2">
              {(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as ReviewStatus[]).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSelectedStatus(st)}
                  className={`py-1.5 px-2 text-xs font-semibold rounded-md border text-center transition-all ${
                    selectedStatus === st
                      ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-700 block">Operator Notes:</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add reconciliation notes, resolution rationale, or audit references..."
              className="w-full p-2.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            {savedFeedback && (
              <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Review saved in session
              </span>
            )}
            <div className="ml-auto">
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveReview}
                isLoading={isSaving}
                leftIcon={<Save className="w-3.5 h-3.5" />}
              >
                Save Review
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ExceptionDetailDrawer: React.FC<ExceptionDetailDrawerProps> = ({
  record,
  onClose,
}) => {
  if (!record) return null;
  return <ExceptionDetailContent key={record.id} record={record} onClose={onClose} />;
};
