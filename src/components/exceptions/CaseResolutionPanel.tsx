'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Compass,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  HelpCircle,
  ChevronRight,
  X,
  Lock,
  History,
  Loader2,
  PlayCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  EvaluatedRecommendation,
  CaseRecommendationsResult,
  RecommendationVisualState,
  UncertaintyLevel,
  MANDATORY_RESOLUTION_DISCLAIMER,
} from '@/lib/resolution/types';
import {
  CaseApprovalRecord,
  MANDATORY_APPROVAL_DISCLAIMER,
  APPROVED_AWAITING_EXECUTION_LABEL,
} from '@/lib/approvals/types';
import { ApprovalDecisionModal } from './ApprovalDecisionModal';
import { ApprovalAuditModal } from './ApprovalAuditModal';
import { ControlledExecutionModal } from './ControlledExecutionModal';

interface CaseResolutionPanelProps {
  caseId: string;
  currentCaseVersion?: number;
}

export const CaseResolutionPanel: React.FC<CaseResolutionPanelProps> = ({
  caseId,
  currentCaseVersion,
}) => {
  const [data, setData] = useState<CaseRecommendationsResult | null>(null);
  const [approvals, setApprovals] = useState<CaseApprovalRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequestingApproval, setIsRequestingApproval] = useState<string | null>(null);

  // Modals state
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<EvaluatedRecommendation | null>(null);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState<boolean>(false);

  const [decisionApproval, setDecisionApproval] = useState<CaseApprovalRecord | null>(null);
  const [isDecisionModalOpen, setIsDecisionModalOpen] = useState<boolean>(false);

  const [auditApprovalId, setAuditApprovalId] = useState<string | null>(null);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState<boolean>(false);

  const [executionApproval, setExecutionApproval] = useState<CaseApprovalRecord | null>(null);
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState<boolean>(false);

  const fetchApprovals = useCallback(async () => {
    try {
      const res = await fetch(`/api/exceptions/cases/${caseId}/approvals`);
      if (res.ok) {
        const json = await res.json();
        setApprovals(json.approvals || []);
      }
    } catch (err) {
      console.error('Failed to load case approvals:', err);
    }
  }, [caseId]);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setIsLoading(true);
      setError(null);
      try {
        const [recRes, appRes] = await Promise.all([
          fetch(`/api/exceptions/cases/${caseId}/recommendations`),
          fetch(`/api/exceptions/cases/${caseId}/approvals`),
        ]);

        if (appRes.ok) {
          const appJson = await appRes.json();
          if (isMounted) {
            setApprovals(appJson.approvals || []);
          }
        }

        if (!recRes.ok) {
          const errData = await recRes.json();
          throw new Error(errData.message || 'Failed to load resolution recommendations.');
        }
        const json: CaseRecommendationsResult = await recRes.json();
        if (isMounted) {
          setData(json);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to retrieve recommendations.');
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
  }, [caseId, currentCaseVersion]);

  // Request approval for a recommendation
  const handleRequestApproval = async (rec: EvaluatedRecommendation) => {
    setIsRequestingApproval(rec.id);
    setRequestError(null);

    try {
      const res = await fetch(`/api/exceptions/cases/${caseId}/approvals`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-operator-id': 'operator@closeloop.local',
        },
        body: JSON.stringify({
          recommendationId: rec.id,
          actionId: rec.actionId,
          actionParameters: {
            title: rec.title,
            description: rec.description,
            riskLevel: rec.riskLevel,
            explanation: rec.explanation,
          },
          caseVersion: data?.caseVersion || rec.caseVersion,
          evidenceFingerprint: rec.evidenceFingerprint || data?.evidenceFingerprint,
          expiresInHours: 48,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.message || 'Failed to submit approval request.');
      }

      await fetchApprovals();
    } catch (err: unknown) {
      setRequestError(err instanceof Error ? err.message : 'Error submitting approval request.');
    } finally {
      setIsRequestingApproval(null);
    }
  };

  const primaryRec = data?.recommendations.find((r) => r.isPrimary) || data?.recommendations[0];
  const alternativeRecs = data?.recommendations.filter((r) => r.id !== primaryRec?.id) || [];

  const getApprovalForRec = (recId: string): CaseApprovalRecord | undefined => {
    return approvals.find((a) => a.recommendationId === recId);
  };

  const getVisualBadge = (state: RecommendationVisualState) => {
    switch (state) {
      case 'RECOMMENDED':
        return {
          bg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
          label: 'Primary Recommended',
          icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />,
        };
      case 'REQUIRES_VERIFICATION':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-200',
          label: 'Requires Verification',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />,
        };
      case 'HIGH_UNCERTAINTY':
        return {
          bg: 'bg-orange-50 text-orange-800 border-orange-200',
          label: 'High Uncertainty',
          icon: <HelpCircle className="w-3.5 h-3.5 text-orange-600" />,
        };
      case 'EVIDENCE_STALE':
        return {
          bg: 'bg-rose-50 text-rose-800 border-rose-200',
          label: 'Evidence Stale',
          icon: <Clock className="w-3.5 h-3.5 text-rose-600" />,
        };
      case 'MANUAL_REVIEW_REQUIRED':
      default:
        return {
          bg: 'bg-purple-50 text-purple-800 border-purple-200',
          label: 'Manual Review Required',
          icon: <ShieldAlert className="w-3.5 h-3.5 text-purple-600" />,
        };
    }
  };

  const getUncertaintyColor = (level: UncertaintyLevel) => {
    switch (level) {
      case 'LOW':
        return 'text-emerald-700 bg-emerald-50 border-emerald-200';
      case 'MODERATE':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'HIGH':
        return 'text-amber-700 bg-amber-50 border-amber-200';
      case 'VERY_HIGH':
        return 'text-rose-700 bg-rose-50 border-rose-200';
    }
  };

  const openReviewModal = (rec: EvaluatedRecommendation) => {
    setSelectedRecommendation(rec);
    setIsReviewModalOpen(true);
  };

  const closeReviewModal = () => {
    setSelectedRecommendation(null);
    setIsReviewModalOpen(false);
  };

  const openDecisionModal = (approval: CaseApprovalRecord) => {
    setDecisionApproval(approval);
    setIsDecisionModalOpen(true);
  };

  const openAuditModal = (approvalId: string) => {
    setAuditApprovalId(approvalId);
    setIsAuditModalOpen(true);
  };

  const openExecutionModal = (approval: CaseApprovalRecord) => {
    setExecutionApproval(approval);
    setIsExecutionModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3" />
        <div className="h-16 bg-slate-100 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-xs text-rose-800 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Recommendation Engine Notice:</span> {error}
        </div>
      </div>
    );
  }

  if (!primaryRec) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-center text-xs text-slate-500">
        No active resolution recommendations found for this exception case.
      </div>
    );
  }

  const badge = getVisualBadge(primaryRec.visualState);
  const primaryApproval = getApprovalForRec(primaryRec.id);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs space-y-4 p-5">
      {/* Panel Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              Deterministic Resolution Copilot
            </h3>
            <p className="text-[11px] text-slate-500">
              Declarative, policy-governed operator action recommendations & cryptographic approvals
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border flex items-center gap-1 ${badge.bg}`}>
            {badge.icon}
            {badge.label}
          </span>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
            Case v{data?.caseVersion}
          </span>
        </div>
      </div>

      {/* Mandatory Advisory Notice */}
      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs flex items-start gap-2.5">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Advisory Notice:</strong> {MANDATORY_RESOLUTION_DISCLAIMER} Operator confirmation
          and verification are required prior to manual ledger adjustments.
        </p>
      </div>

      {/* Request Error Alert */}
      {requestError && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Approval Request Notice:</span> {requestError}
          </div>
        </div>
      )}

      {/* Stale Evidence Warning if applicable */}
      {data?.isEvidenceStale && (
        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-900 text-xs flex items-start gap-2.5">
          <Clock className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Evidence Drift Detected:</strong> The case or underlying evidence has progressed
            since previous investigation snapshot. Recommendations are preserved for audit
            provenance, but verify current transactions before taking action.
          </p>
        </div>
      )}

      {/* Primary Recommendation Card */}
      <div className="p-4 rounded-xl border border-teal-100 bg-teal-50/20 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-900 text-[10px] font-mono font-bold">
                {primaryRec.actionId}
              </span>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getUncertaintyColor(primaryRec.uncertainty.level)}`}>
                {primaryRec.uncertainty.score}% UNCERTAINTY ({primaryRec.uncertainty.level})
              </span>
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 text-[10px] font-bold uppercase">
                {primaryRec.riskLevel} RISK
              </span>

              {/* Approval Status Badge on Primary Card */}
              {primaryApproval && (
                primaryApproval.status === 'APPROVED' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-700" />
                    {APPROVED_AWAITING_EXECUTION_LABEL}
                  </span>
                ) : primaryApproval.status === 'PENDING_APPROVAL' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-700" />
                    PENDING APPROVAL
                  </span>
                ) : primaryApproval.status === 'REJECTED' ? (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                    REJECTED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                    EXPIRED
                  </span>
                )
              )}
            </div>
            <h4 className="text-sm font-bold text-slate-900">{primaryRec.title}</h4>
            <p className="text-xs text-slate-600 leading-relaxed">{primaryRec.explanation}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openReviewModal(primaryRec)}
              className="text-xs"
            >
              Details
            </Button>

            {/* Approval Workflow Actions */}
            {!primaryApproval || primaryApproval.status === 'EXPIRED' ? (
              <Button
                size="sm"
                onClick={() => handleRequestApproval(primaryRec)}
                disabled={isRequestingApproval === primaryRec.id}
                className="text-xs bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1"
              >
                {isRequestingApproval === primaryRec.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
                Request Approval
              </Button>
            ) : primaryApproval.status === 'PENDING_APPROVAL' ? (
              <Button
                size="sm"
                onClick={() => openDecisionModal(primaryApproval)}
                className="text-xs bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Review & Decide
              </Button>
            ) : primaryApproval.status === 'APPROVED' ? (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => openExecutionModal(primaryApproval)}
                  className="text-xs bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1 font-semibold"
                >
                  <PlayCircle className="w-3.5 h-3.5" />
                  Execute Action
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAuditModal(primaryApproval.id)}
                  className="text-xs flex items-center gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                >
                  <History className="w-3.5 h-3.5" />
                  Audit
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openAuditModal(primaryApproval.id)}
                className="text-xs flex items-center gap-1 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
              >
                <History className="w-3.5 h-3.5" />
                Audit Trail
              </Button>
            )}
          </div>
        </div>

        {/* Disclaimer for approved status */}
        {primaryApproval?.status === 'APPROVED' && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>
                <strong>Controlled Approval:</strong> {MANDATORY_APPROVAL_DISCLAIMER}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => openExecutionModal(primaryApproval)}
                className="text-[11px] h-7 px-2.5 bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-1"
              >
                <PlayCircle className="w-3 h-3" />
                Run Controlled Simulation
              </Button>
              <button
                onClick={() => openAuditModal(primaryApproval.id)}
                className="text-[11px] text-emerald-700 hover:text-emerald-900 underline font-semibold cursor-pointer"
              >
                Verify Hash Chain
              </button>
            </div>
          </div>
        )}

        {/* Supporting Evidence Chips & Preconditions */}
        <div className="pt-2 border-t border-teal-100/60 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
              Preconditions Satisfied
            </span>
            <ul className="list-disc list-inside text-slate-700 space-y-0.5 mt-0.5">
              {primaryRec.preconditionsSatisfied.map((p, idx) => (
                <li key={idx} className="truncate" title={p}>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider block">
              Supporting Evidence Citations
            </span>
            <div className="flex flex-wrap gap-1 mt-1 font-mono text-[10px]">
              {primaryRec.supportingEvidenceIds.length > 0 ? (
                primaryRec.supportingEvidenceIds.map((id) => (
                  <span
                    key={id}
                    className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-slate-600"
                    title={id}
                  >
                    {id.slice(0, 8)}...
                  </span>
                ))
              ) : (
                <span className="text-slate-400">None attached</span>
              )}
            </div>
          </div>
        </div>

        {/* Missing Information Notice */}
        {primaryRec.missingInformation.length > 0 && (
          <div className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <strong>Information Required:</strong>{' '}
              {primaryRec.missingInformation.join('; ')}
            </div>
          </div>
        )}
      </div>

      {/* Alternative Recommendations if present */}
      {alternativeRecs.length > 0 && (
        <div className="space-y-2 pt-1">
          <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
            Alternative / Contingency Options ({alternativeRecs.length})
          </span>
          <div className="space-y-1.5">
            {alternativeRecs.map((alt) => {
              const altApproval = getApprovalForRec(alt.id);
              return (
                <div
                  key={alt.id}
                  className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors flex items-center justify-between text-xs"
                >
                  <div
                    className="space-y-0.5 cursor-pointer flex-1"
                    onClick={() => openReviewModal(alt)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900">{alt.title}</span>
                      <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-200 text-slate-700">
                        {alt.actionId}
                      </span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${getUncertaintyColor(alt.uncertainty.level)}`}>
                        {alt.uncertainty.score}%
                      </span>

                      {altApproval && (
                        altApproval.status === 'APPROVED' ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-200">
                            APPROVED
                          </span>
                        ) : altApproval.status === 'PENDING_APPROVAL' ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-200">
                            PENDING APPROVAL
                          </span>
                        ) : null
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 line-clamp-1">{alt.description}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    {!altApproval ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRequestApproval(alt);
                        }}
                        disabled={isRequestingApproval === alt.id}
                        className="text-[11px] h-7 px-2"
                      >
                        Request Approval
                      </Button>
                    ) : altApproval.status === 'PENDING_APPROVAL' ? (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDecisionModal(altApproval);
                        }}
                        className="text-[11px] h-7 px-2 bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        Decide
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          openAuditModal(altApproval.id);
                        }}
                        className="text-[11px] h-7 px-2 text-indigo-700 border-indigo-200 hover:bg-indigo-50"
                      >
                        Audit
                      </Button>
                    )}
                    <ChevronRight
                      className="w-4 h-4 text-slate-400 cursor-pointer"
                      onClick={() => openReviewModal(alt)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Review Modal / Drawer (STRICTLY READ-ONLY - NO FINANCIAL MUTATIONS) */}
      {isReviewModalOpen && selectedRecommendation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-xl border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-teal-50 text-teal-800 border border-teal-200">
                    {selectedRecommendation.actionId}
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getUncertaintyColor(selectedRecommendation.uncertainty.level)}`}>
                    {selectedRecommendation.uncertainty.score}% Uncertainty ({selectedRecommendation.uncertainty.level})
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900">
                  {selectedRecommendation.title}
                </h3>
              </div>
              <button
                onClick={closeReviewModal}
                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Description & Detailed Explanation */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Operator Rationale & Next Step
              </h4>
              <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                {selectedRecommendation.explanation}
              </p>
            </div>

            {/* Explainable Uncertainty Breakdown */}
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Uncertainty Score Factors ({selectedRecommendation.uncertainty.factors.length})
              </h4>
              <div className="space-y-1.5">
                {selectedRecommendation.uncertainty.factors.map((f, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg border border-slate-200 bg-white text-xs flex items-start justify-between gap-2"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">{f.factor}:</span>{' '}
                      <span className="text-slate-600">{f.reason}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 shrink-0">
                      +{f.scoreContribution}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Preconditions & Contraindications Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-emerald-50/50 border border-emerald-100 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 block">
                  Preconditions Satisfied
                </span>
                <ul className="list-disc list-inside text-emerald-950 space-y-0.5 text-[11px]">
                  {selectedRecommendation.preconditionsSatisfied.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 block">
                  Contraindications Checked
                </span>
                <ul className="list-disc list-inside text-slate-700 space-y-0.5 text-[11px]">
                  {selectedRecommendation.contraindicationsChecked.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Supporting Evidence References */}
            <div className="space-y-1.5 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block">
                Evidence Provenance IDs
              </span>
              <div className="flex flex-wrap gap-1 font-mono text-[10px]">
                {selectedRecommendation.supportingEvidenceIds.map((id) => (
                  <span key={id} className="p-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {id}
                  </span>
                ))}
              </div>
            </div>

            {/* Read-Only Safety Disclaimer */}
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              <strong>Advisory Safeguard:</strong> This recommendation is generated deterministically
              for operator guidance. It does not execute a refund, void, or ledger modification.
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end pt-2 border-t border-slate-100">
              <Button variant="outline" size="sm" onClick={closeReviewModal}>
                Close
              </Button>
            </div>
          </div>
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

      {/* Controlled Execution Modal (Phase 3D.5) */}
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
};
