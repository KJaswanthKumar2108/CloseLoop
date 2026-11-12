'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import {
  Download,
  Database,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
  FileText,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { PayPalImportedTransactionRecord, ImportRunRecord } from '@/lib/db/types';

interface PayPalImportCardProps {
  isConfigured: boolean;
}

export function PayPalImportCard({ isConfigured }: PayPalImportCardProps) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pageSize, setPageSize] = useState(100);
  const [maxPages, setMaxPages] = useState(5);

  const setPresetDates = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().split('.')[0] + 'Z');
    setEndDate(end.toISOString().split('.')[0] + 'Z');
  };

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [latestResult, setLatestResult] = useState<any | null>(null);

  const [activeTab, setActiveTab] = useState<'transactions' | 'runs'>('transactions');
  const [transactions, setTransactions] = useState<PayPalImportedTransactionRecord[]>([]);
  const [totalTxns, setTotalTxns] = useState(0);
  const [loadingTxns, setLoadingTxns] = useState(false);

  const [runs, setRuns] = useState<ImportRunRecord[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const [eligibleFilter, setEligibleFilter] = useState<string>('all');
  const [collisionFilter, setCollisionFilter] = useState<string>('all');

  // Load persisted transactions on mount & when filters change
  const loadTransactions = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: '50',
      });
      if (eligibleFilter === 'eligible') params.set('reconciliationEligible', 'true');
      if (eligibleFilter === 'ineligible') params.set('reconciliationEligible', 'false');
      if (collisionFilter !== 'all') params.set('collisionStatus', collisionFilter);

      const res = await fetch(`/api/paypal/imported-transactions?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setTotalTxns(data.totalCount || 0);
      }
    } catch {
      // Ignored in non-DB mode
    } finally {
      setLoadingTxns(false);
    }
  }, [eligibleFilter, collisionFilter]);

  // Load import runs history
  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/paypal/import-runs?limit=10');
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    async function init() {
      try {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 7);
        setStartDate(start.toISOString().split('.')[0] + 'Z');
        setEndDate(end.toISOString().split('.')[0] + 'Z');

        const params = new URLSearchParams({ page: '1', pageSize: '50' });
        if (eligibleFilter === 'eligible') params.set('reconciliationEligible', 'true');
        if (eligibleFilter === 'ineligible') params.set('reconciliationEligible', 'false');
        if (collisionFilter !== 'all') params.set('collisionStatus', collisionFilter);

        const txRes = await fetch(`/api/paypal/imported-transactions?${params.toString()}`);
        if (!ignore && txRes.ok) {
          const data = await txRes.json();
          setTransactions(data.transactions || []);
          setTotalTxns(data.totalCount || 0);
        }
        const runsRes = await fetch('/api/paypal/import-runs?limit=10');
        if (!ignore && runsRes.ok) {
          const data = await runsRes.json();
          setRuns(data.runs || []);
        }
      } catch {
        // Ignored
      }
    }
    init();
    return () => {
      ignore = true;
    };
  }, [eligibleFilter, collisionFilter]);

  // Handle manual import trigger
  const handleTriggerImport = async () => {
    if (!isConfigured) return;

    setImporting(true);
    setImportError(null);
    setLatestResult(null);

    try {
      const res = await fetch('/api/paypal/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          startDate,
          endDate,
          pageSize,
          maxPages,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setImportError(data.message || data.error || 'Failed to complete PayPal transaction import.');
      } else {
        setLatestResult(data);
        // Refresh tables
        loadTransactions();
        loadRuns();
      }
    } catch (err: unknown) {
      setImportError(err instanceof Error ? err.message : 'Network error connecting to import service.');
    } finally {
      setImporting(false);
    }
  };

  const formatMinor = (minor: number, precision = 2) => {
    const isNeg = minor < 0;
    const abs = Math.abs(minor);
    const divisor = Math.pow(10, precision);
    const formatted = (abs / divisor).toFixed(precision);
    return `${isNeg ? '-' : ''}${formatted}`;
  };

  return (
    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-teal-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Durable PayPal Transaction Ingestion & Ledger
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Server-side ingestion pipeline feeding PayPal Sandbox transactions into CloseLoop&apos;s durable PostgreSQL persistence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Sandbox Isolated
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            PostgreSQL Durable
          </span>
        </div>
      </div>

      {/* Advisory Notice */}
      <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/60 flex items-start gap-3">
        <Clock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed space-y-1">
          <div>
            <span className="font-semibold">PayPal Reporting Delay Notice:</span> PayPal reporting records can take up to 3 hours to appear in Transaction Search.
          </div>
          <div className="text-[11px] text-amber-800">
            Durable ingestion safely deduplicates existing transactions, logs cross-batch fee discrepancies, and quarantines ambiguous collisions.
            <span className="font-medium text-amber-950"> Ingestion does not automatically initiate reconciliation runs.</span>
          </div>
        </div>
      </div>

      {/* Operator Trigger Controls */}
      <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Operator Import Controls
          </span>
          <div className="flex gap-1.5">
            {[1, 7, 14, 30].map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setPresetDates(days)}
                className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Last {days}d
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Start Timestamp (RFC 3339)
            </label>
            <input
              type="text"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:outline-hidden"
              placeholder="2026-11-01T00:00:00Z"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              End Timestamp (RFC 3339)
            </label>
            <input
              type="text"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:outline-hidden"
              placeholder="2026-11-09T00:00:00Z"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Page Size (Max 500)
            </label>
            <input
              type="number"
              min="1"
              max="500"
              value={pageSize}
              onChange={(e) => setPageSize(parseInt(e.target.value, 10) || 100)}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">
              Max Pages (Bounded $\le$ 10)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={maxPages}
              onChange={(e) => setMaxPages(parseInt(e.target.value, 10) || 5)}
              className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:outline-hidden"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="text-[11px] text-slate-500">
            Reporting window constrained to 31 days per PayPal specification.
          </div>

          <Button
            onClick={handleTriggerImport}
            disabled={importing || !isConfigured}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {importing ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Ingesting Transactions...</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                <span>Execute Ingestion to Database</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Error Banner */}
      {importError && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block">Ingestion Execution Failed:</span>
            <span>{importError}</span>
          </div>
        </div>
      )}

      {/* Latest Execution Summary Banner */}
      {latestResult && (
        <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/70 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-teal-700" />
              <span className="text-xs font-bold text-teal-900">
                Import Run Completed: {latestResult.importRunId}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-100 text-teal-800 border border-teal-200">
              {latestResult.metrics.importStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-center text-xs">
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-slate-500 uppercase block">Received</span>
              <span className="text-sm font-bold text-slate-900">{latestResult.metrics.recordsReceived}</span>
            </div>
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-emerald-700 uppercase block">New Inserted</span>
              <span className="text-sm font-bold text-emerald-700">{latestResult.metrics.recordsInserted}</span>
            </div>
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-blue-700 uppercase block">Existing (Seen)</span>
              <span className="text-sm font-bold text-blue-700">{latestResult.metrics.recordsAlreadyPresent}</span>
            </div>
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-amber-700 uppercase block">Collisions</span>
              <span className="text-sm font-bold text-amber-700">{latestResult.metrics.identityCollisionsDetected}</span>
            </div>
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-amber-800 uppercase block">Discrepancies</span>
              <span className="text-sm font-bold text-amber-800">{latestResult.metrics.crossBatchDiscrepancies}</span>
            </div>
            <div className="p-2 rounded bg-white border border-teal-100">
              <span className="text-[10px] text-rose-700 uppercase block">Rejected</span>
              <span className="text-sm font-bold text-rose-700">{latestResult.metrics.recordsRejected}</span>
            </div>
          </div>
        </div>
      )}

      {/* Tabs & Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('transactions')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'transactions'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Durable Ledger ({totalTxns})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('runs')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'runs'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Import History ({runs.length})
            </button>
          </div>

          {activeTab === 'transactions' && (
            <div className="flex items-center gap-2 text-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={eligibleFilter}
                onChange={(e) => setEligibleFilter(e.target.value)}
                className="px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="all">All Eligibility</option>
                <option value="eligible">Reconciliation Eligible</option>
                <option value="ineligible">Ineligible (Holds/Auth)</option>
              </select>

              <select
                value={collisionFilter}
                onChange={(e) => setCollisionFilter(e.target.value)}
                className="px-2 py-1 rounded border border-slate-200 bg-white text-xs text-slate-700"
              >
                <option value="all">All Collision States</option>
                <option value="NONE">Non-Colliding (NONE)</option>
                <option value="QUARANTINED">Quarantined Only</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  loadTransactions();
                  loadRuns();
                }}
                className="p-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50"
                title="Refresh"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTxns ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: Persisted Transactions Table */}
        {activeTab === 'transactions' && (
          <div>
            {loadingTxns ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading persisted records...</div>
            ) : transactions.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400 space-y-1">
                <FileText className="w-8 h-8 text-slate-300 mx-auto" />
                <p>No transactions persisted in durable storage yet.</p>
                <p className="text-[11px] text-slate-400">
                  Execute an ingestion run above to import records from the PayPal Sandbox.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px] font-semibold uppercase">
                    <tr>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">PayPal Txn ID</th>
                      <th className="px-3 py-2">Event Code</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Signed Amount</th>
                      <th className="px-3 py-2">Timestamp</th>
                      <th className="px-3 py-2">Eligibility</th>
                      <th className="px-3 py-2">Collision</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 font-sans font-medium text-slate-800">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              tx.transactionType === 'CAPTURE'
                                ? 'bg-emerald-50 text-emerald-700'
                                : tx.transactionType === 'REFUND'
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {tx.transactionType}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-900 font-semibold">{tx.paypalTransactionId}</td>
                        <td className="px-3 py-2 text-slate-600">{tx.transactionEventCode}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              tx.transactionStatus === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {tx.transactionStatus}
                          </span>
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${
                            tx.grossAmountMinor < 0 ? 'text-blue-700' : 'text-slate-900'
                          }`}
                        >
                          {formatMinor(tx.grossAmountMinor, tx.currencyPrecision)} {tx.currency}
                        </td>
                        <td className="px-3 py-2 text-slate-500 font-sans text-[11px]">
                          {new Date(tx.transactionTime).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 font-sans">
                          {tx.reconciliationEligible ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span>Eligible</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                              <span>Ineligible</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-sans">
                          {tx.identityCollisionStatus === 'QUARANTINED' ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1 py-0.5 rounded border border-amber-200">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              <span>Quarantined</span>
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">None</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Import Runs Table */}
        {activeTab === 'runs' && (
          <div>
            {loadingRuns ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading import history...</div>
            ) : runs.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">No import runs recorded yet.</div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px] font-semibold uppercase">
                    <tr>
                      <th className="px-3 py-2">Run ID</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Window</th>
                      <th className="px-3 py-2 text-center">New</th>
                      <th className="px-3 py-2 text-center">Seen</th>
                      <th className="px-3 py-2 text-center">Collisions</th>
                      <th className="px-3 py-2 text-center">Rejected</th>
                      <th className="px-3 py-2">Started</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {runs.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50">
                        <td className="px-3 py-2 font-semibold text-slate-900 truncate max-w-[120px]" title={r.id}>
                          {r.id.slice(0, 8)}...
                        </td>
                        <td className="px-3 py-2 font-sans">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              r.importStatus === 'COMPLETED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : r.importStatus === 'COMPLETED_WITH_WARNINGS'
                                ? 'bg-amber-100 text-amber-800'
                                : r.importStatus === 'PARTIAL'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {r.importStatus}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-600 text-[10px]">
                          {new Date(r.requestedStartDate).toLocaleDateString()} – {new Date(r.requestedEndDate).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-center text-emerald-700 font-semibold">{r.recordsInserted}</td>
                        <td className="px-3 py-2 text-center text-blue-700">{r.recordsAlreadyPresent}</td>
                        <td className="px-3 py-2 text-center text-amber-700">{r.identityCollisionsDetected}</td>
                        <td className="px-3 py-2 text-center text-rose-700">{r.recordsRejected}</td>
                        <td className="px-3 py-2 text-slate-500 font-sans text-[11px]">
                          {new Date(r.startedAt).toLocaleString()}
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
    </div>
  );
}
