'use client';

import React, { useState } from 'react';
import {
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { fetchPayPalTransactionPreview } from '@/lib/api/paypalClient';
import type { TransactionSearchPreviewResult } from '@/lib/paypal/transactionSearch';
import { formatMoney } from '@/lib/reconciliation/money';

interface PayPalTransactionPreviewCardProps {
  isConfigured: boolean;
}

export const PayPalTransactionPreviewCard: React.FC<PayPalTransactionPreviewCardProps> = ({
  isConfigured,
}) => {
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [pageSize, setPageSize] = useState(50);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<TransactionSearchPreviewResult | null>(null);
  const [activeTab, setActiveTab] = useState<'normalized' | 'rejected'>('normalized');

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
    setStartDate(start.toISOString().slice(0, 16));
    setEndDate(end.toISOString().slice(0, 16));
  };

  const handleFetchPreview = async () => {
    setError(null);
    setIsLoading(true);

    try {
      const now = new Date();
      const endObj = endDate ? new Date(endDate) : now;
      const startObj = startDate
        ? new Date(startDate)
        : new Date(endObj.getTime() - 7 * 24 * 60 * 60 * 1000);

      const startIso = startObj.toISOString();
      const endIso = endObj.toISOString();

      const result = await fetchPayPalTransactionPreview({
        startDate: startIso,
        endDate: endIso,
        pageSize,
        maxPages: 5,
      });

      setPreviewResult(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to query PayPal Transaction Search.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              PayPal Transaction Search Preview (Sandbox)
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Read-only preview querying PayPal Reporting API (`/v1/reporting/transactions`).
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 self-start sm:self-auto">
          <span>Read-Only Preview</span>
        </span>
      </div>

      {/* 3-Hour Lag Warning Banner */}
      <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-900 leading-relaxed flex items-start gap-2.5">
        <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold block">PayPal Reporting Latency Advisory:</span>
          Executed payments and captures may take up to 3 hours to become visible in PayPal Transaction Search. An empty query result does not prove that no transaction took place.
        </div>
      </div>

      {!isConfigured ? (
        <div className="p-6 rounded-lg border border-slate-200 bg-slate-50/60 text-center space-y-2">
          <AlertTriangle className="w-6 h-6 text-amber-600 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-800">
            Awaiting Sandbox Credentials
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Configure your <code className="font-mono bg-slate-200 px-1 py-0.5 rounded text-[11px]">PAYPAL_CLIENT_ID</code> and <code className="font-mono bg-slate-200 px-1 py-0.5 rounded text-[11px]">PAYPAL_CLIENT_SECRET</code> in <code className="font-mono bg-slate-200 px-1 py-0.5 rounded text-[11px]">.env.local</code> to query live Sandbox transactions.
          </p>
        </div>
      ) : (
        <>
          {/* Query Controls */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> Date Range (Max 31 Days)
              </span>
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 text-[11px]">Presets:</span>
                <button
                  type="button"
                  onClick={() => setPreset(7)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  Last 7d
                </button>
                <button
                  type="button"
                  onClick={() => setPreset(14)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  Last 14d
                </button>
                <button
                  type="button"
                  onClick={() => setPreset(30)}
                  className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
                >
                  Last 30d
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] text-slate-500 font-medium mb-1">
                  Start Date & Time (UTC)
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 font-medium mb-1">
                  End Date & Time (UTC)
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-xs font-mono px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 font-medium mb-1">
                  Page Size
                </label>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(parseInt(e.target.value, 10))}
                  className="w-full text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value={20}>20 records / page</option>
                  <option value={50}>50 records / page</option>
                  <option value={100}>100 records / page</option>
                  <option value={200}>200 records / page</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400">
                Queries are strictly read-only and never write or reconcile data.
              </span>
              <button
                type="button"
                onClick={handleFetchPreview}
                disabled={isLoading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs font-medium transition cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? 'Querying PayPal...' : 'Fetch Sandbox Preview'}</span>
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-xs text-rose-900 flex items-start gap-2">
              <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block">Query Error:</span>
                <span>{error}</span>
              </div>
            </div>
          )}

          {/* Preview Results */}
          {previewResult && (
            <div className="space-y-4 pt-2 border-t border-slate-100">
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-[11px] text-slate-500 font-medium block">Total Retrieved</span>
                  <span className="text-base font-bold text-slate-900 font-mono mt-0.5 block">
                    {previewResult.records.totalRetrieved}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-100">
                  <span className="text-[11px] text-emerald-700 font-medium block">Normalized Records</span>
                  <span className="text-base font-bold text-emerald-900 font-mono mt-0.5 block">
                    {previewResult.records.normalizedCount}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-100">
                  <span className="text-[11px] text-amber-700 font-medium block">Rejected / Unsupported</span>
                  <span className="text-base font-bold text-amber-900 font-mono mt-0.5 block">
                    {previewResult.records.rejectedCount}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <span className="text-[11px] text-slate-500 font-medium block">Pages Fetched</span>
                  <span className="text-base font-bold text-slate-800 font-mono mt-0.5 block">
                    {previewResult.pagination.pagesFetched} / {previewResult.pagination.totalPages}
                  </span>
                </div>
              </div>

              {/* Sub-Tabs: Normalized vs Rejected */}
              <div className="flex items-center gap-2 border-b border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('normalized')}
                  className={`pb-2 px-1 font-medium transition border-b-2 ${
                    activeTab === 'normalized'
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Normalized Transactions ({previewResult.records.normalizedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('rejected')}
                  className={`pb-2 px-1 font-medium transition border-b-2 ${
                    activeTab === 'rejected'
                      ? 'border-slate-900 text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Rejected / Unsupported Items ({previewResult.records.rejectedCount})
                </button>
              </div>

              {/* Normalized Table */}
              {activeTab === 'normalized' && (
                <div className="space-y-2">
                  {previewResult.records.normalized.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No matching records were retrieved for the selected date range.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-200">
                          <tr>
                            <th className="py-2.5 px-3">Transaction ID</th>
                            <th className="py-2.5 px-3">Type</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3 text-right">Gross Amount</th>
                            <th className="py-2.5 px-3 text-right">Fee</th>
                            <th className="py-2.5 px-3">Date (UTC)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                          {previewResult.records.normalized.map((tx) => (
                            <tr key={tx.id} className="hover:bg-slate-50/60">
                              <td className="py-2 px-3 font-semibold text-slate-900">
                                {tx.paypalTransactionId}
                              </td>
                              <td className="py-2 px-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-slate-100 text-slate-700">
                                  {tx.transactionType}
                                </span>
                              </td>
                              <td className="py-2 px-3">
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans font-semibold text-emerald-700">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  {tx.transactionStatus}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right font-semibold text-slate-900">
                                {formatMoney(tx.grossAmount)}
                              </td>
                              <td className="py-2 px-3 text-right text-slate-500">
                                {tx.feeAmount ? formatMoney(tx.feeAmount) : '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {new Date(tx.transactionTime).toLocaleString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* Rejected Table */}
              {activeTab === 'rejected' && (
                <div className="space-y-2">
                  {previewResult.records.rejected.length === 0 ? (
                    <div className="py-8 text-center text-xs text-emerald-700 flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      All retrieved PayPal items were successfully mapped to the domain model.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-amber-200 bg-amber-50/20">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-amber-50 text-[11px] text-amber-900 uppercase tracking-wider border-b border-amber-200">
                          <tr>
                            <th className="py-2.5 px-3">Transaction ID</th>
                            <th className="py-2.5 px-3">Event Code</th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-3">Rejection Reason</th>
                            <th className="py-2.5 px-3">Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 text-[11px]">
                          {previewResult.records.rejected.map((rej, idx) => (
                            <tr key={idx} className="hover:bg-amber-50/50">
                              <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                                {rej.rawDetail.transaction_info.transaction_id || '—'}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-600">
                                {rej.rawDetail.transaction_info.transaction_event_code || '—'}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-600">
                                {rej.rawDetail.transaction_info.transaction_status || '—'}
                              </td>
                              <td className="py-2 px-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800">
                                  {rej.reason}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {rej.message}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
