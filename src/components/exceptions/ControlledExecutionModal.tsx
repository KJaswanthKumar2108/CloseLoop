'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  PlayCircle,
  X,
  Loader2,
  FileCode,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CaseApprovalRecord } from '@/lib/approvals/types';
import {
  CaseExecutionRecord,
  ExecutionMode,
  MANDATORY_SIMULATION_DISCLAIMER,
  PAYPAL_SANDBOX_UNAVAILABLE_MESSAGE,
} from '@/lib/execution/types';

interface ControlledExecutionModalProps {
  approval: CaseApprovalRecord;
  isOpen: boolean;
  onClose: () => void;
  onExecutionComplete?: () => void;
}

export const ControlledExecutionModal: React.FC<ControlledExecutionModalProps> = ({
  approval,
  isOpen,
  onClose,
  onExecutionComplete,
}) => {
  const [selectedMode, setSelectedMode] = useState<ExecutionMode>('DRY_RUN');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<CaseExecutionRecord | null>(null);

  // Check if this approval was already executed
  useEffect(() => {
    if (!isOpen || !approval.id) return;

    let isMounted = true;
    async function checkExistingExecution() {
      try {
        const res = await fetch(`/api/exceptions/approvals/${approval.id}/executions`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted && json.executions && json.executions.length > 0) {
            setExecutionResult(json.executions[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load existing executions:', err);
      }
    }

    checkExistingExecution();
    return () => {
      isMounted = false;
    };
  }, [approval.id, isOpen]);

  if (!isOpen) return null;

  const handleRunExecution = async () => {
    setIsExecuting(true);
    setError(null);

    try {
      const res = await fetch(`/api/exceptions/approvals/${approval.id}/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operator-id': 'operator@closeloop.local',
        },
        body: JSON.stringify({
          executionMode: selectedMode,
          operatorConfirmation: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Execution simulation failed.');
      }

      setExecutionResult(data.execution);
      if (onExecutionComplete) {
        onExecutionComplete();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected execution error occurred.');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
              <PlayCircle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Controlled Resolution Demonstration
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  APPROVED
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                Phase 3D.5 deterministic execution simulation under cryptographic parameter lock
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isExecuting}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Notice */}
        {error && (
          <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Execution Blocked:</span> {error}
            </div>
          </div>
        )}

        {/* Cryptographic Pre-execution Gate Verification */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
          <div className="flex items-center justify-between pb-1 border-b border-slate-200/70">
            <span className="font-bold text-slate-700">Pre-Execution Integrity Verification</span>
            <span className="text-[10px] text-emerald-700 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              GATES VERIFIED
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-600">
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Approved Action</span>
              <span className="font-bold text-slate-800 truncate block">{approval.actionId}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Case Version</span>
              <span className="text-slate-800">v{approval.caseVersion} (Verified)</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Binding Hash</span>
              <span className="text-slate-800 truncate block" title={approval.canonicalBindingHash}>
                {approval.canonicalBindingHash.slice(0, 10)}...
              </span>
            </div>
            <div>
              <span className="text-slate-400 block text-[9px] uppercase">Decided By</span>
              <span className="text-slate-800 truncate block">{approval.decidedBy || 'Operator'}</span>
            </div>
          </div>
        </div>

        {/* Execution Mode Selector (Section A1) */}
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            Execution Mode
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* DRY RUN Mode */}
            <div
              onClick={() => setSelectedMode('DRY_RUN')}
              className={`p-3 rounded-xl border cursor-pointer transition-all ${
                selectedMode === 'DRY_RUN'
                  ? 'border-teal-500 bg-teal-50/40 ring-2 ring-teal-500/20'
                  : 'border-slate-200 bg-white hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">DRY RUN</span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-teal-100 text-teal-800">
                  RECOMMENDED
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Deterministic local simulation. Validates action without external financial mutation.
              </p>
            </div>

            {/* PAYPAL SANDBOX Mode */}
            <div
              className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 opacity-80 cursor-not-allowed"
              title={PAYPAL_SANDBOX_UNAVAILABLE_MESSAGE}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">SANDBOX</span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-amber-100 text-amber-800">
                  READ-ONLY
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Restricted scope. Ingest credentials configured for read-only safety.
              </p>
            </div>

            {/* LIVE Mode */}
            <div
              className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 opacity-50 cursor-not-allowed"
              title="Live mode disabled for security."
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-400">LIVE</span>
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-200 text-slate-600">
                  DISABLED
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Disabled permanently by FinTech safety governance policy.
              </p>
            </div>
          </div>
        </div>

        {/* Bound Action Parameters Preview */}
        {approval.actionParameters && Object.keys(approval.actionParameters).length > 0 && (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <FileCode className="w-3.5 h-3.5" />
              <span>Cryptographically Bound Parameters</span>
            </div>
            <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-200 text-[10px] font-mono overflow-x-auto">
              {JSON.stringify(approval.actionParameters, null, 2)}
            </pre>
          </div>
        )}

        {/* Execution Results View (if executed) */}
        {executionResult ? (
          <div className="space-y-3 p-4 rounded-xl border-2 border-teal-500/40 bg-teal-50/30">
            {/* Simulation Notice Banner */}
            <div className="p-3 rounded-lg bg-teal-100 border border-teal-300 text-teal-950 text-xs flex items-center justify-between font-semibold">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span>{MANDATORY_SIMULATION_DISCLAIMER}</span>
              </div>
              <span className="font-mono text-[10px] bg-teal-200 px-1.5 py-0.5 rounded text-teal-900">
                {executionResult.status}
              </span>
            </div>

            {/* Outcome description */}
            <div className="space-y-1 text-xs">
              <span className="font-bold text-slate-800">Simulated Outcome:</span>
              <p className="text-slate-700 bg-white p-2.5 rounded-lg border border-teal-200 leading-relaxed">
                {executionResult.resultSummary.simulatedOutcome}
              </p>
            </div>

            {/* Simulated Ledger Impact */}
            {executionResult.resultSummary.simulatedLedgerImpact && (
              <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                  Simulated Adjusting Journal Entry
                </span>
                <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-400 text-[9px] block">Debit Account:</span>
                    <span className="text-slate-800 font-bold">
                      {executionResult.resultSummary.simulatedLedgerImpact.accountDebited}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[9px] block">Credit Account:</span>
                    <span className="text-slate-800 font-bold">
                      {executionResult.resultSummary.simulatedLedgerImpact.accountCredited}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Simulated External Call */}
            {executionResult.resultSummary.simulatedExternalCall && (
              <div className="p-2.5 rounded-lg bg-slate-900 text-slate-200 text-[10px] font-mono space-y-1">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Target: {executionResult.resultSummary.simulatedExternalCall.targetSystem}</span>
                  <span className="text-teal-400">{executionResult.resultSummary.simulatedExternalCall.simulatedStatus}</span>
                </div>
                <div>{executionResult.resultSummary.simulatedExternalCall.mockEndpoint}</div>
                <div className="text-slate-400 italic">Note: {executionResult.resultSummary.simulatedExternalCall.note}</div>
              </div>
            )}

            <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between pt-1">
              <span>Execution ID: {executionResult.id.slice(0, 16)}...</span>
              <span>Audit Trail: Chained to parent approval</span>
            </div>
          </div>
        ) : (
          /* Mandatory Financial Safety Disclaimer */
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong>Controlled Demonstration Safeguard:</strong> CloseLoop will simulate the approved action
              and generate accounting impact vouchers. No real money will be transferred or refunded.
            </p>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isExecuting}
          >
            {executionResult ? 'Close' : 'Cancel'}
          </Button>

          {!executionResult && (
            <Button
              size="sm"
              onClick={handleRunExecution}
              disabled={isExecuting}
              className="bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1.5"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Simulating...
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" />
                  Execute Controlled Simulation (DRY RUN)
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

