'use client';

import React from 'react';
import { X, History, Clock, AlertCircle } from 'lucide-react';
import { ReconciliationRun } from '@/types/financial';
import { Button } from '@/components/ui/Button';

interface RunHistoryModalProps {
  runs: ReconciliationRun[];
  activeRunId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectRun?: (run: ReconciliationRun) => void;
}

export const RunHistoryModal: React.FC<RunHistoryModalProps> = ({
  runs,
  activeRunId,
  isOpen,
  onClose,
  onSelectRun,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-slate-700" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">Reconciliation Run History</h2>
              <p className="text-[11px] text-slate-500">
                In-memory execution history for current operational session.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-800 rounded-md hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Persistence Notice */}
        <div className="px-6 py-2.5 bg-amber-50/70 border-b border-amber-200/60 text-amber-900 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-[11px]">
            <strong>Session In-Memory Persistence:</strong> Historical runs are retained in-memory for the active operational session only and reset upon server restart.
          </span>
        </div>

        {/* Run List Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {runs.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              No reconciliation runs executed in this session yet.
            </div>
          ) : (
            runs.map((run) => {
              const isActive = run.id === activeRunId;
              return (
                <div
                  key={run.id}
                  className={`p-4 rounded-xl border transition-all ${
                    isActive
                      ? 'border-slate-900 bg-slate-50/80 shadow-xs ring-1 ring-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {run.id}
                      </span>
                      {isActive && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-900 text-white">
                          ACTIVE RUN
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>{new Date(run.startedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center text-xs pt-2 border-t border-slate-100">
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] text-slate-400 block uppercase">Orders</span>
                      <span className="font-mono font-bold text-slate-800">{run.totalOrders}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] text-slate-400 block uppercase">Txns</span>
                      <span className="font-mono font-bold text-slate-800">{run.totalTransactions}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-50/50 border border-emerald-100">
                      <span className="text-[10px] text-emerald-700 block uppercase">Matched</span>
                      <span className="font-mono font-bold text-emerald-800">{run.matchedCount}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-amber-50/50 border border-amber-100">
                      <span className="text-[10px] text-amber-700 block uppercase">Exceptions</span>
                      <span className="font-mono font-bold text-amber-800">{run.exceptionCount}</span>
                    </div>
                  </div>

                  {onSelectRun && !isActive && (
                    <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          onSelectRun(run);
                          onClose();
                        }}
                      >
                        Inspect This Run
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
