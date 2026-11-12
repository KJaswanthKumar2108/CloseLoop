'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  AlertTriangle,
  Receipt,
  Clock,
  Coins,
  ShieldAlert,
  Search,
  CheckCircle2,
  Save,
  Info,
} from 'lucide-react';
import { useWorkbench } from '@/context/WorkbenchContext';
import { ReconciliationRecord } from '@/types/financial';
import { formatMoney } from '@/lib/reconciliation/money';
import { ReviewStatus } from '@/lib/workbench/workbenchStore';
import { CaseInvestigationPanel } from '@/components/exceptions/CaseInvestigationPanel';
import { CaseResolutionPanel } from '@/components/exceptions/CaseResolutionPanel';

const ExceptionInvestigationDetail: React.FC<{
  record: ReconciliationRecord;
}> = ({ record }) => {
  const { reviews, updateReview } = useWorkbench();

  const activeReview = reviews[record.id];
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>(
    activeReview?.status || 'OPEN'
  );
  const [reviewNotes, setReviewNotes] = useState<string>(activeReview?.notes || '');
  const [isSavingReview, setIsSavingReview] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  const handleSaveReview = async () => {
    setIsSavingReview(true);
    try {
      await updateReview(record.id, reviewStatus, reviewNotes);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (e) {
      console.error('Failed to update review:', e);
    } finally {
      setIsSavingReview(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 font-mono">
              {record.id}
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
              {record.discrepancyType}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Evaluated via {record.matchingMethod} ({record.confidence})
          </p>
        </div>

        <span className="text-xs font-mono text-slate-500">
          Currency: {record.currency}
        </span>
      </div>

      {/* Identifiers */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
            Merchant Order ID
          </span>
          <span className="font-mono text-xs font-bold text-slate-900 block mt-0.5">
            {record.orderId || 'None (Missing in Ledger)'}
          </span>
        </div>

        <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
            PayPal Transaction ID(s)
          </span>
          <span
            className="font-mono text-xs font-bold text-slate-900 block mt-0.5 truncate"
            title={record.transactionIds.join(', ')}
          >
            {record.transactionIds.length > 0
              ? record.transactionIds.join(', ')
              : 'None (Missing in PayPal)'}
          </span>
        </div>
      </div>

      {/* Financial Comparison */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
        <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
          Exact Minor-Unit Settlement Math
        </span>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-[10px] text-slate-400 block font-medium">Expected</span>
            <span className="font-mono text-xs font-bold text-slate-800 block mt-0.5">
              {formatMoney(record.expectedAmount)}
            </span>
            <span className="text-[10px] font-mono text-slate-400 block">
              {record.expectedAmount.amountMinor} minor
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <span className="text-[10px] text-slate-400 block font-medium">Actual Gross</span>
            <span className="font-mono text-xs font-bold text-slate-800 block mt-0.5">
              {formatMoney(record.actualAmount)}
            </span>
            <span className="text-[10px] font-mono text-slate-400 block">
              {record.actualAmount.amountMinor} minor
            </span>
          </div>

          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
            <span className="text-[10px] block font-medium">Variance</span>
            <span className="font-mono text-xs font-bold block mt-0.5">
              {formatMoney(record.varianceAmount)}
            </span>
            <span className="text-[10px] font-mono block">
              {record.varianceAmount.amountMinor} minor
            </span>
          </div>
        </div>
      </div>

      {/* Evidence and Explanation */}
      <div className="rounded-xl border border-slate-200 p-4 bg-white space-y-3">
        <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
          Matching Rule & Evidence Citations
        </span>
        <div className="text-xs font-mono text-slate-700 bg-slate-50 p-2 rounded border border-slate-200">
          Rule: {record.evidence?.matchingRule || 'RULE_DEFAULT'}
        </div>

        {record.evidence?.reasonsForAccepting && (
          <div className="space-y-1">
            <span className="text-[11px] font-semibold text-slate-700 block">Accepted Reasons:</span>
            <ul className="space-y-1">
              {record.evidence.reasonsForAccepting.map((r, i) => (
                <li
                  key={i}
                  className="text-xs text-slate-600 pl-2.5 border-l-2 border-teal-500 bg-slate-50/50 p-1 rounded-r leading-relaxed"
                >
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {record.evidence?.reasonsForRejectingCandidates && (
          <div className="space-y-1 pt-2 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-700 block">Rejected Evidence:</span>
            <ul className="space-y-1">
              {record.evidence.reasonsForRejectingCandidates.map((r, i) => (
                <li
                  key={i}
                  className="text-xs text-slate-600 pl-2.5 border-l-2 border-amber-500 bg-slate-50/50 p-1 rounded-r leading-relaxed"
                >
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Operator Review & Annotation */}
      <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/70 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-900 uppercase tracking-wider block">
            Human Review Workflow
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            State: {reviewStatus}
          </span>
        </div>

        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50/60 border border-amber-200 text-amber-900 text-[11px]">
          <Info className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Operator review status does not alter the underlying deterministic engine matching classification or mutate financial records.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-slate-700 block">Set Review Status:</label>
          <div className="grid grid-cols-4 gap-2">
            {(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as ReviewStatus[]).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setReviewStatus(st)}
                className={`py-1.5 px-2 text-xs font-semibold rounded-md border text-center transition-all ${
                  reviewStatus === st
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
          <label className="text-[11px] font-semibold text-slate-700 block">Resolution Notes:</label>
          <textarea
            rows={3}
            value={reviewNotes}
            onChange={(e) => setReviewNotes(e.target.value)}
            placeholder="Add investigation notes, policy citations, or resolution justification..."
            className="w-full p-2.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          {saveSuccess && (
            <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Review state saved
            </span>
          )}
          <div className="ml-auto">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveReview}
              isLoading={isSavingReview}
              leftIcon={<Save className="w-3.5 h-3.5" />}
            >
              Save Review
            </Button>
          </div>
        </div>
      </div>

      {/* Evidence-Grounded AI Copilot Investigation (Phase 3D.2) */}
      <CaseInvestigationPanel caseId={record.id} discrepancyType={record.discrepancyType} />

      {/* Deterministic Resolution Action Recommendations (Phase 3D.3) */}
      <CaseResolutionPanel caseId={record.id} />
    </div>
  );
};

export default function ExceptionsPage() {
  const { activeRun, reviews } = useWorkbench();

  const [selectedFilter, setSelectedFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Filter for records that represent exceptions / discrepancies
  const allExceptions = useMemo(() => {
    if (!activeRun) return [];
    return activeRun.records.filter(
      (r) =>
        r.matchStatus === 'DISCREPANCY' ||
        r.matchStatus === 'AMBIGUOUS' ||
        r.matchStatus === 'UNMATCHED_ORDER' ||
        r.matchStatus === 'UNMATCHED_TRANSACTION' ||
        r.confidence === 'MANUAL_REVIEW_REQUIRED'
    );
  }, [activeRun]);

  // Derived counts for category cards
  const categoryCounts = useMemo(() => {
    return {
      feeVariances: allExceptions.filter((r) => r.discrepancyType === 'FEE_VARIANCE').length,
      timingDelays: allExceptions.filter((r) => r.discrepancyType === 'TIMING_DELAY').length,
      disputeHolds: allExceptions.filter((r) => r.discrepancyType === 'DISPUTE_HOLD').length,
      refunds: allExceptions.filter(
        (r) =>
          r.discrepancyType === 'PARTIAL_REFUND_MISMATCH' ||
          r.discrepancyType === 'FULL_REFUND_SETTLEMENT'
      ).length,
      ambiguous: allExceptions.filter((r) => r.matchStatus === 'AMBIGUOUS').length,
      unmatched: allExceptions.filter(
        (r) => r.matchStatus === 'UNMATCHED_ORDER' || r.matchStatus === 'UNMATCHED_TRANSACTION'
      ).length,
    };
  }, [allExceptions]);

  // Filtered exception list based on active filter and search
  const filteredExceptions = useMemo(() => {
    return allExceptions.filter((r) => {
      // Category filter
      if (selectedFilter === 'DISCREPANCY' && r.matchStatus !== 'DISCREPANCY') return false;
      if (selectedFilter === 'AMBIGUOUS' && r.matchStatus !== 'AMBIGUOUS') return false;
      if (
        selectedFilter === 'UNMATCHED' &&
        r.matchStatus !== 'UNMATCHED_ORDER' &&
        r.matchStatus !== 'UNMATCHED_TRANSACTION'
      )
        return false;
      if (selectedFilter === 'TIMING_DELAY' && r.discrepancyType !== 'TIMING_DELAY') return false;
      if (selectedFilter === 'DISPUTE_HOLD' && r.discrepancyType !== 'DISPUTE_HOLD') return false;
      if (selectedFilter === 'FEE_VARIANCE' && r.discrepancyType !== 'FEE_VARIANCE') return false;
      if (
        selectedFilter === 'REFUND' &&
        r.discrepancyType !== 'PARTIAL_REFUND_MISMATCH' &&
        r.discrepancyType !== 'FULL_REFUND_SETTLEMENT'
      )
        return false;

      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesOrder = r.orderId?.toLowerCase().includes(q);
        const matchesTxn = r.transactionIds.some((t) => t.toLowerCase().includes(q));
        const matchesRule = r.evidence?.matchingRule?.toLowerCase().includes(q);
        const matchesDiscrepancy = r.discrepancyType.toLowerCase().includes(q);
        return matchesOrder || matchesTxn || matchesRule || matchesDiscrepancy;
      }

      return true;
    });
  }, [allExceptions, selectedFilter, searchQuery]);

  // Automatically select first record if none selected
  const activeRecord = useMemo(() => {
    if (!filteredExceptions.length) return null;
    if (selectedRecordId) {
      const found = filteredExceptions.find((r) => r.id === selectedRecordId);
      if (found) return found;
    }
    return filteredExceptions[0];
  }, [filteredExceptions, selectedRecordId]);

  const categories = [
    {
      title: 'Fee Variances',
      count: categoryCounts.feeVariances,
      icon: Receipt,
      color: 'text-amber-600 bg-amber-50 border-amber-200',
      description: 'PayPal fee schedules differing from expected merchant rate contracts.',
      filter: 'FEE_VARIANCE',
    },
    {
      title: 'Timing & Settlement Lags',
      count: categoryCounts.timingDelays,
      icon: Clock,
      color: 'text-blue-600 bg-blue-50 border-blue-200',
      description: 'Pending authorizations or in-flight settlement clearing delays.',
      filter: 'TIMING_DELAY',
    },
    {
      title: 'Dispute & Holds',
      count: categoryCounts.disputeHolds,
      icon: ShieldAlert,
      color: 'text-rose-600 bg-rose-50 border-rose-200',
      description: 'Customer dispute holds or reversed transaction debits.',
      filter: 'DISPUTE_HOLD',
    },
    {
      title: 'Refund Adjustments',
      count: categoryCounts.refunds,
      icon: Coins,
      color: 'text-purple-600 bg-purple-50 border-purple-200',
      description: 'Partial or full settled refunds offsetting original order gross.',
      filter: 'REFUND',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceptions & Discrepancy Queue"
        description="Identified payment variances awaiting root-cause analysis, policy evaluation, and suggested remediation."
        badge={
          <StatusBadge
            status={allExceptions.length > 0 ? 'discrepancy' : 'matched'}
            label={`${allExceptions.length} Active Exceptions`}
            showDot
          />
        }
        actions={
          <Link href="/reconciliation">
            <Button variant="outline" size="sm">
              Back to Workbench
            </Button>
          </Link>
        }
      />

      {/* Exception Categories Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isSelected = selectedFilter === cat.filter;
          return (
            <button
              type="button"
              key={cat.title}
              onClick={() => setSelectedFilter(isSelected ? 'ALL' : cat.filter)}
              className={`p-4 rounded-xl border text-left transition-all ${
                isSelected
                  ? 'border-slate-900 bg-white ring-1 ring-slate-900 shadow-xs'
                  : 'border-slate-200 bg-white hover:border-slate-300 shadow-2xs'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-7 h-7 rounded-md border flex items-center justify-center ${cat.color}`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-semibold text-slate-800">{cat.title}</h3>
                </div>
                <span className="font-mono text-xs font-bold text-slate-900 px-2 py-0.5 rounded bg-slate-100">
                  {cat.count}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">{cat.description}</p>
            </button>
          );
        })}
      </div>

      {/* Main Exception Workspace */}
      {allExceptions.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No Exceptions in Active Run"
          description={
            activeRun
              ? 'All orders in the active run were reconciled cleanly without discrepancies.'
              : 'No active reconciliation run detected. Execute a run on the Reconciliation Workbench first.'
          }
          action={{
            label: 'Open Reconciliation Workbench',
            href: '/reconciliation',
          }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Exception Queue List (5 cols) */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs flex flex-col h-[750px]">
            {/* Filter and Search Bar */}
            <div className="p-3 border-b border-slate-200 bg-slate-50 space-y-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by Order, Txn, or Discrepancy..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-900"
                />
              </div>

              {/* Quick Filter Pills */}
              <div className="flex flex-wrap gap-1 text-[11px]">
                {[
                  { label: 'All', value: 'ALL' },
                  { label: 'Discrepancy', value: 'DISCREPANCY' },
                  { label: 'Ambiguous', value: 'AMBIGUOUS' },
                  { label: 'Unmatched', value: 'UNMATCHED' },
                ].map((pill) => (
                  <button
                    key={pill.value}
                    type="button"
                    onClick={() => setSelectedFilter(pill.value)}
                    className={`px-2 py-0.5 rounded font-medium transition-colors ${
                      selectedFilter === pill.value
                        ? 'bg-slate-900 text-white'
                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {pill.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable Items */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
              {filteredExceptions.map((record) => {
                const isSelected = activeRecord?.id === record.id;
                const review = reviews[record.id];
                const isZeroVariance = record.varianceAmount.amountMinor === 0;

                return (
                  <div
                    key={record.id}
                    onClick={() => setSelectedRecordId(record.id)}
                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-slate-100 border border-slate-300 shadow-2xs'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-slate-900 truncate">
                        {record.orderId || record.transactionIds[0] || record.id}
                      </span>
                      <StatusBadge
                        status={
                          record.matchStatus === 'DISCREPANCY'
                            ? 'discrepancy'
                            : record.matchStatus === 'AMBIGUOUS'
                            ? 'pending'
                            : 'unmatched'
                        }
                        label={record.matchStatus}
                        size="sm"
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 mt-1">
                      <span className="font-medium text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200/60 truncate max-w-[180px]">
                        {record.discrepancyType}
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          isZeroVariance ? 'text-slate-500' : 'text-rose-600'
                        }`}
                      >
                        Var: {formatMoney(record.varianceAmount)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-2 pt-1.5 border-t border-slate-200/50">
                      <span>Txns: {record.transactionIds.length}</span>
                      <span className="font-semibold text-slate-600 uppercase">
                        Review: {review?.status || 'OPEN'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Investigation View (7 cols) */}
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
            {activeRecord ? (
              <ExceptionInvestigationDetail key={activeRecord.id} record={activeRecord} />
            ) : (
              <div className="text-center py-20 text-slate-400 text-xs">
                Select an exception from the queue to investigate details.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
