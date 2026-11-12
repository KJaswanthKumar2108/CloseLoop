'use client';

import React, { useState, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCheck,
  RefreshCw,
  Sparkles,
  Info,
  Database,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useWorkbench } from '@/context/WorkbenchContext';
import { DatasetOrigin } from '@/lib/workbench/workbenchStore';

interface FileState {
  file: File | null;
  name: string;
  sizeBytes: number;
  content: string;
  rowCount: number;
  isSyntheticDemo?: boolean;
}

interface DatasetUploaderProps {
  onReconciliationComplete?: () => void;
}

export const DatasetUploader: React.FC<DatasetUploaderProps> = ({
  onReconciliationComplete,
}) => {
  const {
    runReconciliationFromCsv,
    runPersistedReconciliation,
    loadSampleDataset,
    persistedMetadata,
    persistedError,
    isLoading,
    error,
    clearError,
  } = useWorkbench();

  // Mode: Manual CSV vs PayPal Durable Ledger
  const [sourcingMode, setSourcingMode] = useState<'CSV' | 'LEDGER'>('CSV');

  // CSV States
  const [ordersFile, setOrdersFile] = useState<FileState | null>(null);
  const [txnsFile, setTxnsFile] = useState<FileState | null>(null);
  const [isDemoData, setIsDemoData] = useState<boolean>(false);
  const [localParseError, setLocalParseError] = useState<string | null>(null);

  // Ledger Sourcing States
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [acknowledgedPartial, setAcknowledgedPartial] = useState<boolean>(false);

  React.useEffect(() => {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Client-side hydration sync for default date window
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDate(start.toISOString().slice(0, 16));
    setEndDate(end.toISOString().slice(0, 16));
  }, []);

  const orderInputRef = useRef<HTMLInputElement>(null);
  const txnInputRef = useRef<HTMLInputElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const countCsvRows = (text: string): number => {
    const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
    return Math.max(0, lines.length - 1);
  };

  const handleFileSelect = (
    file: File,
    type: 'orders' | 'transactions'
  ) => {
    setLocalParseError(null);
    clearError();
    setIsDemoData(false);

    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setLocalParseError(`Invalid file format: ${file.name}. Only .csv files are supported.`);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setLocalParseError(`File ${file.name} exceeds maximum 5MB size limit.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      const rowCount = countCsvRows(text);

      const state: FileState = {
        file,
        name: file.name,
        sizeBytes: file.size,
        content: text,
        rowCount,
      };

      if (type === 'orders') {
        setOrdersFile(state);
      } else {
        setTxnsFile(state);
      }
    };

    reader.onerror = () => {
      setLocalParseError(`Failed to read ${file.name}.`);
    };

    reader.readAsText(file);
  };

  const handleDrop = (
    e: React.DragEvent<HTMLDivElement>,
    type: 'orders' | 'transactions'
  ) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0], type);
    }
  };

  const handleLoadSampleData = async () => {
    setLocalParseError(null);
    clearError();
    try {
      const data = await loadSampleDataset();
      const orderRows = countCsvRows(data.ordersCsv);
      const txnRows = countCsvRows(data.transactionsCsv);

      setOrdersFile({
        file: null,
        name: 'synthetic_demo_merchant_orders.csv',
        sizeBytes: new Blob([data.ordersCsv]).size,
        content: data.ordersCsv,
        rowCount: orderRows,
        isSyntheticDemo: true,
      });

      if (sourcingMode === 'CSV') {
        setTxnsFile({
          file: null,
          name: 'synthetic_demo_paypal_settlements.csv',
          sizeBytes: new Blob([data.transactionsCsv]).size,
          content: data.transactionsCsv,
          rowCount: txnRows,
          isSyntheticDemo: true,
        });
      }

      setIsDemoData(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load sample dataset';
      setLocalParseError(msg);
    }
  };

  const setDatePreset = (hoursOrDays: number, isHours = false) => {
    const end = new Date();
    const start = new Date(
      end.getTime() - (isHours ? hoursOrDays * 3600 * 1000 : hoursOrDays * 86400 * 1000)
    );
    setStartDate(start.toISOString().slice(0, 16));
    setEndDate(end.toISOString().slice(0, 16));
    setAcknowledgedPartial(false);
    clearError();
  };

  const handleExecute = async () => {
    setLocalParseError(null);
    clearError();

    if (!ordersFile) {
      setLocalParseError('Merchant orders dataset is required.');
      return;
    }

    if (sourcingMode === 'CSV') {
      if (!txnsFile) {
        setLocalParseError('PayPal transactions CSV file is required.');
        return;
      }

      const origin: DatasetOrigin = isDemoData ? 'SYNTHETIC_DEMO' : 'IMPORTED';
      try {
        await runReconciliationFromCsv(ordersFile.content, txnsFile.content, origin);
        if (onReconciliationComplete) {
          onReconciliationComplete();
        }
      } catch (err: unknown) {
        console.error('CSV Reconciliation execution error:', err);
      }
    } else {
      // Ledger Sourcing Mode
      const startIso = new Date(startDate).toISOString();
      const endIso = new Date(endDate).toISOString();

      try {
        await runPersistedReconciliation({
          startDate: startIso,
          endDate: endIso,
          acknowledgedPartial,
          ordersCsv: ordersFile.content,
        });
        if (onReconciliationComplete) {
          onReconciliationComplete();
        }
      } catch (err: unknown) {
        console.error('Ledger Reconciliation execution error:', err);
      }
    }
  };

  const canExecute =
    ordersFile !== null &&
    (sourcingMode === 'CSV' ? txnsFile !== null : Boolean(startDate && endDate)) &&
    !isLoading;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-5">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Upload className="w-4 h-4 text-slate-700" />
            <span>Ingest Datasets & Execute Reconciliation</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Select internal merchant ledger orders and reconcile against PayPal settlement data.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Segmented Sourcing Toggle */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setSourcingMode('CSV');
                clearError();
              }}
              className={`rounded-md px-2.5 py-1 transition-all ${
                sourcingMode === 'CSV'
                  ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Manual CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setSourcingMode('LEDGER');
                clearError();
              }}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-all ${
                sourcingMode === 'LEDGER'
                  ? 'bg-white text-teal-900 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Database className="w-3 h-3 text-teal-600" />
              <span>PayPal Durable Ledger</span>
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadSampleData}
            isLoading={isLoading}
            leftIcon={<Sparkles className="w-3.5 h-3.5 text-teal-600" />}
          >
            Load Sample Orders
          </Button>
        </div>
      </div>

      {/* Prominent Synthetic Demo Data Notice */}
      {isDemoData && (
        <div className="flex items-start gap-2.5 p-3 rounded-lg bg-teal-50/70 border border-teal-200 text-teal-900 text-xs">
          <Info className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold block tracking-wide">
              SYNTHETIC DEMONSTRATION DATA LOADED
            </span>
            <p className="text-teal-700 text-[11px] leading-relaxed">
              Synthetic merchant orders loaded for scenario verification.
              These records are synthetic fixtures and do not represent live merchant data.
            </p>
          </div>
        </div>
      )}

      {/* Dropzones & Sourcing Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Orders CSV Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, 'orders')}
          className={`relative rounded-xl border-2 border-dashed p-4 transition-all ${
            ordersFile
              ? 'border-emerald-300 bg-emerald-50/20'
              : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
          }`}
        >
          <input
            type="file"
            ref={orderInputRef}
            accept=".csv,text/csv"
            onChange={(e) => {
              if (e.target.files?.[0]) handleFileSelect(e.target.files[0], 'orders');
            }}
            className="hidden"
          />

          {ordersFile ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                    <FileCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-800 block truncate max-w-[200px]">
                      {ordersFile.name}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {formatFileSize(ordersFile.sizeBytes)} • {ordersFile.rowCount.toLocaleString()} orders
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setOrdersFile(null)}
                  className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded cursor-pointer"
                  title="Remove file"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-2 border-t border-emerald-200/50 flex items-center justify-between text-[11px]">
                <span className="text-emerald-700 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Validated Order Dataset
                </span>
                <button
                  type="button"
                  onClick={() => orderInputRef.current?.click()}
                  className="text-slate-600 hover:text-slate-900 underline cursor-pointer"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => orderInputRef.current?.click()}
              className="flex flex-col items-center justify-center text-center cursor-pointer py-3"
            >
              <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 mb-2">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-slate-800">
                1. Select Merchant Orders CSV
              </span>
              <p className="text-[11px] text-slate-400 mt-1 max-w-[220px]">
                Drop file here or click to browse. Max 5MB, up to 5,000 orders.
              </p>
            </div>
          )}
        </div>

        {/* Right Column: Transactions CSV OR Durable Ledger Sourcing */}
        {sourcingMode === 'CSV' ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(e, 'transactions')}
            className={`relative rounded-xl border-2 border-dashed p-4 transition-all ${
              txnsFile
                ? 'border-emerald-300 bg-emerald-50/20'
                : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
            }`}
          >
            <input
              type="file"
              ref={txnInputRef}
              accept=".csv,text/csv"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileSelect(e.target.files[0], 'transactions');
              }}
              className="hidden"
            />

            {txnsFile ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-700">
                      <FileCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-slate-800 block truncate max-w-[200px]">
                        {txnsFile.name}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {formatFileSize(txnsFile.sizeBytes)} • {txnsFile.rowCount.toLocaleString()} transactions
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setTxnsFile(null)}
                    className="p-1 text-slate-400 hover:text-rose-600 transition-colors rounded cursor-pointer"
                    title="Remove file"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="pt-2 border-t border-emerald-200/50 flex items-center justify-between text-[11px]">
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Validated Transaction Dataset
                  </span>
                  <button
                    type="button"
                    onClick={() => txnInputRef.current?.click()}
                    className="text-slate-600 hover:text-slate-900 underline cursor-pointer"
                  >
                    Replace
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => txnInputRef.current?.click()}
                className="flex flex-col items-center justify-center text-center cursor-pointer py-3"
              >
                <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 mb-2">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <span className="text-xs font-semibold text-slate-800">
                  2. Select PayPal Transactions CSV
                </span>
                <p className="text-[11px] text-slate-400 mt-1 max-w-[220px]">
                  Drop file here or click to browse. Max 5MB, up to 5,000 transactions.
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Durable Ledger Sourcing Panel */
          <div className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-900 block">
                    PayPal Durable Ledger Sourcing
                  </span>
                  <span className="text-[11px] text-slate-500">
                    PostgreSQL Persisted Transactions (SANDBOX)
                  </span>
                </div>
              </div>

              {/* Date Presets */}
              <div className="flex items-center gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setDatePreset(24, true)}
                  className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  24h
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset(7)}
                  className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  7d
                </button>
                <button
                  type="button"
                  onClick={() => setDatePreset(30)}
                  className="px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  30d
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <span>Start Date</span>
                </label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setAcknowledgedPartial(false);
                    clearError();
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-400" />
                  <span>End Date</span>
                </label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setAcknowledgedPartial(false);
                    clearError();
                  }}
                  className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>
            </div>

            <p className="text-[11px] text-teal-800/80 leading-relaxed">
              Coordinates with advisory locks and acquires a REPEATABLE READ snapshot to guarantee
              consistent ledger reads without interference from active imports.
            </p>
          </div>
        )}
      </div>

      {/* Incomplete Import Warning Banner with Operator Acknowledgement (F-13, F-18A) */}
      {persistedError?.code === 'INCOMPLETE_IMPORT_INTERSECTION' && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-900 text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">
                Unsuperseded Incomplete / Warning Imports Detected
              </span>
              <p className="text-amber-800 leading-relaxed text-[11px]">
                The PayPal ledger contains historical import runs with status PARTIAL, FAILED, or
                COMPLETED_WITH_WARNINGS within this date window that have not been superseded by a clean,
                covering import. Some transactions may be omitted from the ledger.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-amber-200/60 flex items-center gap-2">
            <input
              type="checkbox"
              id="acknowledgeIncomplete"
              checked={acknowledgedPartial}
              onChange={(e) => setAcknowledgedPartial(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-amber-400 text-teal-600 focus:ring-teal-500"
            />
            <label
              htmlFor="acknowledgeIncomplete"
              className="text-[11px] font-medium text-amber-900 cursor-pointer select-none"
            >
              I acknowledge that the PayPal ledger contains incomplete or warning-bearing imports for
              this date window, and accept the financial completeness risk.
            </label>
          </div>
        </div>
      )}

      {/* Other Errors display */}
      {(localParseError || (error && persistedError?.code !== 'INCOMPLETE_IMPORT_INTERSECTION')) && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold block">
              {persistedError?.code ? `Error: ${persistedError.code}` : 'Validation / Ingestion Error'}
            </span>
            <p className="text-rose-700 leading-relaxed">{localParseError || error}</p>
          </div>
        </div>
      )}

      {/* Sourcing Provenance Success Badge */}
      {persistedMetadata && (
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between text-slate-700">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-teal-600" />
            <span className="font-medium">
              Sourced from PayPal Durable Ledger: {persistedMetadata.reconciledTransactionCount.toLocaleString()} transactions
              ({persistedMetadata.totalEligibleCount.toLocaleString()} eligible, {persistedMetadata.adapterRejectedCount} rejected)
            </span>
          </div>
          {persistedMetadata.isPartial && (
            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              Partial Sourcing Acknowledged
            </span>
          )}
        </div>
      )}

      {/* Action footer */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-100">
        <div className="text-xs text-slate-500">
          {canExecute ? (
            <span className="text-emerald-700 font-medium">
              {sourcingMode === 'CSV' ? (
                `Ready to process ${ordersFile?.rowCount.toLocaleString()} orders against ${txnsFile?.rowCount.toLocaleString()} transactions.`
              ) : (
                `Ready to reconcile ${ordersFile?.rowCount.toLocaleString()} orders against PayPal durable ledger.`
              )}
            </span>
          ) : (
            <span>
              {sourcingMode === 'CSV'
                ? 'Both datasets are required to execute deterministic matching.'
                : 'Merchant orders and date range are required to execute deterministic matching.'}
            </span>
          )}
        </div>

        <Button
          variant="primary"
          size="md"
          disabled={!canExecute}
          isLoading={isLoading}
          onClick={handleExecute}
          leftIcon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
        >
          {isLoading ? 'Reconciling via Deterministic Engine...' : 'Run Deterministic Reconciliation'}
        </Button>
      </div>
    </div>
  );
};
