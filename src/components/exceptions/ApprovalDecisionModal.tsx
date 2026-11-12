'use client';

import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Lock,
  X,
  Loader2,
  FileCode,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CaseApprovalRecord, MANDATORY_APPROVAL_DISCLAIMER } from '@/lib/approvals/types';

interface ApprovalDecisionModalProps {
  approval: CaseApprovalRecord;
  isOpen: boolean;
  onClose: () => void;
  onDecisionComplete: () => void;
}

export const ApprovalDecisionModal: React.FC<ApprovalDecisionModalProps> = ({
  approval,
  isOpen,
  onClose,
  onDecisionComplete,
}) => {
  const [reason, setReason] = useState<string>(
    'Operator verified recommendation parameters and evidence graph. Authorization granted for controlled resolution.'
  );
  const [operatorId, setOperatorId] = useState<string>('operator@closeloop.local');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDecision = async (decision: 'APPROVE' | 'REJECT') => {
    setIsSubmitting(true);
    setError(null);

    const endpoint = `/api/exceptions/approvals/${approval.id}/${decision === 'APPROVE' ? 'approve' : 'reject'}`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operator-id': operatorId.trim() || 'operator@closeloop.local',
        },
        body: JSON.stringify({
          reason: reason.trim(),
          decidedBy: operatorId.trim() || 'operator@closeloop.local',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Failed to ${decision.toLowerCase()} approval request.`);
      }

      onDecisionComplete();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-200">
                PENDING APPROVAL
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                ID: {approval.id.slice(0, 8)}...
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Operator Approval Decision
            </h3>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Decision Error:</span> {error}
            </div>
          </div>
        )}

        {/* Cryptographic Binding Card */}
        <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-700 font-semibold">
            <Lock className="w-3.5 h-3.5 text-slate-500" />
            <span>Cryptographic Parameter Binding (RFC 8785)</span>
          </div>

          <div className="space-y-1 font-mono text-[11px] text-slate-600">
            <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60">
              <span className="text-slate-400">Action:</span>
              <span className="font-bold text-slate-800">{approval.actionId}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60">
              <span className="text-slate-400">Case Version:</span>
              <span className="text-slate-800">v{approval.caseVersion}</span>
            </div>
            <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60">
              <span className="text-slate-400">Binding Hash:</span>
              <span className="text-slate-800 truncate max-w-[240px]" title={approval.canonicalBindingHash}>
                {approval.canonicalBindingHash.slice(0, 16)}...{approval.canonicalBindingHash.slice(-8)}
              </span>
            </div>
            <div className="flex justify-between items-center py-0.5">
              <span className="text-slate-400">Requested By:</span>
              <span className="text-slate-800">{approval.requestedBy}</span>
            </div>
          </div>
        </div>

        {/* Action Parameters Preview */}
        {approval.actionParameters && Object.keys(approval.actionParameters).length > 0 && (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <FileCode className="w-3.5 h-3.5" />
              <span>Bound Parameters</span>
            </div>
            <pre className="p-2.5 rounded-lg bg-slate-900 text-slate-200 text-[10px] font-mono overflow-x-auto">
              {JSON.stringify(approval.actionParameters, null, 2)}
            </pre>
          </div>
        )}

        {/* Operator Identity Field */}
        <div className="space-y-1 text-xs">
          <label className="font-bold text-slate-700 block">
            Operator Identifier
          </label>
          <input
            type="text"
            value={operatorId}
            onChange={(e) => setOperatorId(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none"
            placeholder="operator@closeloop.local"
          />
        </div>

        {/* Decision Reason Textarea */}
        <div className="space-y-1 text-xs">
          <label className="font-bold text-slate-700 block">
            Decision Reason / Audit Note <span className="text-rose-500">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-teal-500 focus:outline-none leading-relaxed"
            placeholder="Detail rationale for approval or rejection..."
          />
        </div>

        {/* Mandatory Financial Boundary Notice */}
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Financial Boundary Notice:</strong> {MANDATORY_APPROVAL_DISCLAIMER}
            Approval records operator authorization in the tamper-evident audit log.
            No automated payments or refunds will be executed.
          </p>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDecision('REJECT')}
              disabled={isSubmitting || reason.trim().length < 5}
              className="text-rose-600 border-rose-200 hover:bg-rose-50 hover:border-rose-300"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ShieldAlert className="w-3.5 h-3.5 mr-1" />}
              Reject Recommendation
            </Button>

            <Button
              size="sm"
              onClick={() => handleDecision('APPROVE')}
              disabled={isSubmitting || reason.trim().length < 5}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <ShieldCheck className="w-3.5 h-3.5 mr-1" />}
              Grant Approval
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

