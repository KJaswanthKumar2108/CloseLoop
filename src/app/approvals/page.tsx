'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  ShieldCheck,
  FileCheck2,
  Lock,
  Clock,
  PlayCircle,
  History,
  AlertTriangle,
  ArrowRight,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import {
  CaseApprovalRecord,
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '@/lib/approvals/types';
import { ApprovalDecisionModal } from '@/components/exceptions/ApprovalDecisionModal';
import { ApprovalAuditModal } from '@/components/exceptions/ApprovalAuditModal';
import { ControlledExecutionModal } from '@/components/exceptions/ControlledExecutionModal';

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<CaseApprovalRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [decisionApproval, setDecisionApproval] = useState<CaseApprovalRecord | null>(null);
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState<boolean>(false);

  const [auditApprovalId, setAuditApprovalId] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  const [executionApproval, setExecutionApproval] = useState<CaseApprovalRecord | null>(null);
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState<boolean>(false);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals');
      if (res.ok) {
        const json = await res.json();
        setApprovals(json.approvals || []);
      }
    } catch (err) {
      console.error('Failed to reload approvals:', err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/approvals');
        if (!res.ok) {
          throw new Error('Failed to retrieve approvals queue.');
        }
        const json = await res.json();
        if (isMounted) {
          setApprovals(json.approvals || []);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error loading approvals.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();
    return () => {
      isMounted = false;
    };
  }, []);

  const pendingApprovals = approvals.filter((a) => a.status === 'PENDING_APPROVAL');
  const approvedActions = approvals.filter((a) => a.status === 'APPROVED');
  const historicalApprovals = approvals.filter(
    (a) => a.status === 'REJECTED' || a.status === 'EXPIRED'
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Human Authorization Gate"
        description="Explicit human review queue for all proposed financial adjustments, ledger modifications, and PayPal API actions."
        badge={
          <StatusBadge
            status={pendingApprovals.length > 0 ? 'pending' : 'matched'}
            label={`${pendingApprovals.length} Action${pendingApprovals.length === 1 ? '' : 's'} Pending Review`}
            showDot
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/demo">
              <Button variant="outline" size="sm" leftIcon={<PlayCircle className="w-3.5 h-3.5 text-teal-600" />}>
                Demo Guided Scenarios
              </Button>
            </Link>
            <Link href="/exceptions">
              <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Exception Queue
              </Button>
            </Link>
          </div>
        }
      />

      {/* Security Architecture Principle */}
      <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs flex items-start gap-3.5">
        <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-700 shrink-0">
          <Lock className="w-4 h-4" />
        </div>
        <div>
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Strict Human-in-the-Loop Financial Control (Phase 3D.4 & 3D.5)
          </h2>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-3xl">
            Under CloseLoop’s security policy, AI models generate read-only diagnostic hypotheses. 
            All proposed actions require cryptographic human approval. Once approved, actions undergo 
            safe, controlled execution simulation with full audit provenance. {MANDATORY_APPROVAL_DISCLAIMER}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex flex-col items-center justify-center gap-3 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
          <span className="text-xs">Loading authorization queue...</span>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Queue Error:</span> {error}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 1: Pending Approvals Queue */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-slate-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Pending Authorization Queue ({pendingApprovals.length})
                </span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {pendingApprovals.length} awaiting decision
              </span>
            </div>

            {pendingApprovals.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={ShieldCheck}
                  title="No Pending Approvals"
                  description="All proposed operator recommendations have been reviewed. When new recommendations are submitted for approval from the Exception Copilot, they will appear here."
                  badge="Queue Clear"
                  action={{
                    label: 'Inspect Exceptions Queue',
                    href: '/exceptions',
                  }}
                />
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingApprovals.map((app) => (
                  <div key={app.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-200 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          PENDING APPROVAL
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          ID: {app.id.slice(0, 8)}...
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          Case v{app.caseVersion}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">{app.actionId}</h4>
                      <p className="text-xs text-slate-500">
                        Requested by <strong className="text-slate-700">{app.requestedBy}</strong> • Expires {new Date(app.expiresAt).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          setDecisionApproval(app);
                          setIsDecisionModalOpen(true);
                        }}
                        className="bg-amber-600 hover:bg-amber-700 text-white text-xs flex items-center gap-1 font-semibold"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Review & Decide
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAuditApprovalId(app.id);
                          setIsAuditModalOpen(true);
                        }}
                        className="text-xs flex items-center gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                      >
                        <History className="w-3.5 h-3.5" />
                        Audit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 2: Approved Actions Awaiting Controlled Execution */}
          {approvedActions.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-white overflow-hidden shadow-2xs">
              <div className="px-6 py-4 border-b border-emerald-100 flex items-center justify-between bg-emerald-50/50">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                    Approved Actions Awaiting Controlled Execution ({approvedActions.length})
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-emerald-800">
                  {APPROVED_AWAITING_EXECUTION_LABEL}
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {approvedActions.map((app) => (
                  <div key={app.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-emerald-50/20 transition-colors">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                          APPROVED
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          ID: {app.id.slice(0, 8)}...
                        </span>
                        <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded">
                          Binding: {app.canonicalBindingHash.slice(0, 10)}...
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">{app.actionId}</h4>
                      <p className="text-xs text-slate-600">
                        Decided by <strong>{app.decidedBy}</strong> • Reason: &ldquo;{app.decisionReason}&rdquo;
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => {
                          setExecutionApproval(app);
                          setIsExecutionModalOpen(true);
                        }}
                        className="bg-teal-600 hover:bg-teal-700 text-white text-xs flex items-center gap-1 font-semibold"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Run Controlled Simulation
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAuditApprovalId(app.id);
                          setIsAuditModalOpen(true);
                        }}
                        className="text-xs flex items-center gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                      >
                        <History className="w-3.5 h-3.5" />
                        Audit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Historical Decisions */}
          {historicalApprovals.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
              <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Decision History ({historicalApprovals.length})
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {historicalApprovals.map((app) => (
                  <div key={app.id} className="p-4 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                          app.status === 'REJECTED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          {app.status}
                        </span>
                        <span className="font-semibold text-slate-800">{app.actionId}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">
                        {app.decisionReason ? `Reason: "${app.decisionReason}"` : `Created at ${new Date(app.createdAt).toLocaleString()}`}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAuditApprovalId(app.id);
                        setIsAuditModalOpen(true);
                      }}
                      className="text-[11px] h-7 px-2"
                    >
                      Audit Trail
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision Modal */}
      {decisionApproval && (
        <ApprovalDecisionModal
          approval={decisionApproval}
          isOpen={isDecisionModalOpen}
          onClose={() => {
            setIsDecisionModalOpen(false);
            setDecisionApproval(null);
          }}
          onDecisionComplete={() => {
            fetchApprovals();
          }}
        />
      )}

      {/* Audit Modal */}
      {auditApprovalId && (
        <ApprovalAuditModal
          approvalId={auditApprovalId}
          isOpen={isAuditModalOpen}
          onClose={() => {
            setIsAuditModalOpen(false);
            setAuditApprovalId(null);
          }}
        />
      )}

      {/* Controlled Execution Modal */}
      {executionApproval && (
        <ControlledExecutionModal
          approval={executionApproval}
          isOpen={isExecutionModalOpen}
          onClose={() => {
            setIsExecutionModalOpen(false);
            setExecutionApproval(null);
          }}
          onExecutionComplete={() => {
            fetchApprovals();
          }}
        />
      )}
    </div>
  );
}
