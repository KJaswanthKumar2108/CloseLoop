'use client';

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  History,
  X,
  Loader2,
  ArrowDown,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  ApprovalAuditEventRecord,
  CaseApprovalRecord,
  HashChainVerificationResult,
} from '@/lib/approvals/types';

interface ApprovalAuditModalProps {
  approvalId: string;
  isOpen: boolean;
  onClose: () => void;
}

export const ApprovalAuditModal: React.FC<ApprovalAuditModalProps> = ({
  approvalId,
  isOpen,
  onClose,
}) => {
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<CaseApprovalRecord | null>(null);
  const [events, setEvents] = useState<ApprovalAuditEventRecord[]>([]);
  const [verification, setVerification] = useState<HashChainVerificationResult | null>(null);

  useEffect(() => {
    if (!isOpen || !approvalId) return;

    let isMounted = true;
    async function fetchAudit() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/exceptions/approvals/${approvalId}/audit`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.message || 'Failed to retrieve approval audit trail.');
        }
        const data = await res.json();
        if (isMounted) {
          setApproval(data.approval);
          setEvents(data.events || []);
          setVerification(data.chainVerification);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch audit data.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchAudit();
    return () => {
      isMounted = false;
    };
  }, [approvalId, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Cryptographic Audit Trail & Chain Verification
              </h3>
              <p className="text-[11px] text-slate-500">
                Tamper-evident, hash-chained append-only event ledger (RFC 8785 + SHA-256)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
            <span className="text-xs">Verifying cryptographic hash chain...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Audit Error:</span> {error}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Hash Chain Verification Status Banner */}
            {verification?.isValid ? (
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <span className="font-bold">CHAIN INTEGRITY VERIFIED</span>
                    <p className="text-[11px] text-emerald-700">
                      All {verification.totalEvents} audit events form an unbroken SHA-256 hash chain with database immutability triggers.
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-mono text-[10px] font-bold shrink-0">
                  SECURE
                </span>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl border border-rose-300 bg-rose-50 text-rose-950 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                  <div>
                    <span className="font-bold">CHAIN COMPROMISED / TAMPER DETECTED</span>
                    <p className="text-[11px] text-rose-800">
                      {verification?.failureReason || 'Cryptographic audit chain verification failed.'}
                    </p>
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded bg-rose-200 text-rose-900 font-mono text-[10px] font-bold shrink-0">
                  COMPROMISED
                </span>
              </div>
            )}

            {/* Approval Overview Meta */}
            {approval && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] p-3 rounded-xl bg-slate-50 border border-slate-200 font-mono">
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Status</span>
                  <span className="font-bold text-slate-800">{approval.status}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Action</span>
                  <span className="font-bold text-slate-800 truncate block">{approval.actionId}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Case Version</span>
                  <span className="text-slate-800">v{approval.caseVersion}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[9px] uppercase">Requested By</span>
                  <span className="text-slate-800 truncate block">{approval.requestedBy}</span>
                </div>
              </div>
            )}

            {/* Event Timeline */}
            <div className="space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Sequential Audit Events ({events.length})
              </span>

              <div className="space-y-2 relative before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                {events.map((evt, idx) => (
                  <div
                    key={evt.id}
                    className="relative pl-7 text-xs space-y-1.5"
                  >
                    {/* Step Icon */}
                    <div className="absolute left-1.5 top-1.5 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    </div>

                    {/* Event Box */}
                    <div className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800 font-mono text-[10px] font-bold">
                            {evt.eventType}
                          </span>
                          <span className="text-[11px] text-slate-600">
                            by <strong className="text-slate-800">{evt.actorId}</strong>
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {new Date(evt.createdAt).toLocaleString()}
                        </span>
                      </div>

                      {/* Payload preview if available */}
                      {evt.canonicalPayload && Object.keys(evt.canonicalPayload).length > 0 && (
                        <div className="p-2 rounded bg-slate-50 border border-slate-100 font-mono text-[10px] text-slate-700">
                          {JSON.stringify(evt.canonicalPayload)}
                        </div>
                      )}

                      {/* Hash linkage */}
                      <div className="pt-1.5 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-1 text-[9px] font-mono text-slate-500">
                        <div className="truncate">
                          <span className="text-slate-400">Prev: </span>
                          <span title={evt.previousEventHash}>
                            {evt.previousEventHash.slice(0, 12)}...{evt.previousEventHash.slice(-6)}
                          </span>
                        </div>
                        <div className="truncate text-right">
                          <span className="text-slate-400">Hash: </span>
                          <span className="text-indigo-600 font-bold" title={evt.eventHash}>
                            {evt.eventHash.slice(0, 12)}...{evt.eventHash.slice(-6)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {idx < events.length - 1 && (
                      <div className="flex justify-center py-0.5 text-slate-300">
                        <ArrowDown className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-100">
          <span className="text-[10px] text-slate-400">
            PostgreSQL triggers prevent UPDATE/DELETE on audit records.
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
