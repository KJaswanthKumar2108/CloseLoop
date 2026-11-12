'use client';

import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Info,
  HelpCircle,
  ArrowRight,
  RefreshCw,
  Fingerprint,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { InvestigationResult } from '@/lib/ai/types';

interface CaseInvestigationPanelProps {
  caseId: string;
  discrepancyType?: string;
  currentCaseVersion?: number;
}

export const CaseInvestigationPanel: React.FC<CaseInvestigationPanelProps> = ({
  caseId,
  currentCaseVersion,
}) => {
  const [investigation, setInvestigation] = useState<InvestigationResult | null>(null);
  const [provider, setProvider] = useState<string>('');
  const [model, setModel] = useState<string>('');
  const [fingerprint, setFingerprint] = useState<string>('');
  const [caseVersion, setCaseVersion] = useState<number>(1);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [snapshotMetadata, setSnapshotMetadata] = useState<{
    analyzedVersion: number;
    currentVersion: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const dynamicallyStale =
    isStale ||
    (currentCaseVersion !== undefined &&
      currentCaseVersion > 0 &&
      caseVersion > 0 &&
      currentCaseVersion !== caseVersion);

  // Fetch latest investigation on mount
  useEffect(() => {
    let isMounted = true;
    async function loadLatest() {
      try {
        const res = await fetch(`/api/exceptions/cases/${caseId}/investigate`);
        if (res.ok) {
          const data = await res.json();
          if (data.investigations && data.investigations.length > 0) {
            const latest = data.investigations[0];
            if (isMounted) {
              setInvestigation(latest.investigationResult);
              setProvider(latest.provider);
              setModel(latest.model);
              setFingerprint(latest.evidenceFingerprint);
              setCaseVersion(latest.caseVersion);
              setIsStale(Boolean(latest.isStale));
              setSnapshotMetadata(latest.snapshotMetadata || null);
            }
          }
        }
      } catch {
        // Silently ignore load failure on initial view
      }
    }
    loadLatest();
    return () => {
      isMounted = false;
    };
  }, [caseId]);

  const handleRunInvestigation = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/exceptions/cases/${caseId}/investigate`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || 'Investigation failed to complete.');
      }

      setInvestigation(data.investigation);
      setProvider(data.provider);
      setModel(data.model);
      setFingerprint(data.evidenceFingerprint);
      setCaseVersion(data.caseVersion);
      setIsStale(Boolean(data.isStale));
      setSnapshotMetadata(data.snapshotMetadata || null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Investigation failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs space-y-4 p-5">
      {/* Header & Trigger */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
              Evidence-Grounded AI Copilot
            </h3>
            <p className="text-[11px] text-slate-500">
              Read-only root-cause explanation and advisory investigative next steps
            </p>
          </div>
        </div>

        <Button
          variant="primary"
          size="sm"
          onClick={handleRunInvestigation}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
        >
          {investigation ? 'Re-Investigate' : 'Investigate with AI'}
        </Button>
      </div>

      {/* Mandatory Financial Truth Disclaimer */}
      <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Advisory Notice:</strong> AI findings are investigative hypotheses grounded in
          persisted evidence and require human operator verification. No payment, refund,
          settlement, or ledger operation has been executed.
        </p>
      </div>

      {/* Stale Snapshot Warning (F-35) */}
      {dynamicallyStale && (
        <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-orange-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            <strong>Snapshot Outdated:</strong> This investigation analyzed case version{' '}
            <strong>v{snapshotMetadata?.analyzedVersion ?? caseVersion}</strong>, but the case has
            since progressed to version{' '}
            <strong>v{snapshotMetadata?.currentVersion ?? currentCaseVersion}</strong>. Findings
            are preserved for provenance audit but may not reflect recent evidence updates. Re-run
            investigation to analyze the current evidence snapshot.
          </p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Investigation Error:</span> {error}
          </div>
        </div>
      )}

      {/* Investigation Details View */}
      {investigation && (
        <div className="space-y-4 pt-2">
          {/* Metadata Badges */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
              Provider: <strong className="text-slate-900">{provider}</strong>
            </span>
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
              Model: <strong className="text-slate-900">{model}</strong>
            </span>
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200">
              Case Version: <strong className="text-slate-900">v{caseVersion}</strong>
            </span>
            <span className="bg-white px-2 py-0.5 rounded border border-slate-200 flex items-center gap-1">
              <Fingerprint className="w-3 h-3 text-slate-400" />
              Fingerprint: <strong className="text-slate-900">{fingerprint.slice(0, 12)}...</strong>
            </span>
          </div>

          {/* Section A: Investigation Summary */}
          <div className="p-3.5 rounded-lg bg-slate-50/60 border border-slate-200 space-y-1.5">
            <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider">
              Investigation Summary
            </h4>
            <p className="text-xs text-slate-700 leading-relaxed">
              {investigation.summary.conciseExplanation}
            </p>
            <div className="text-[11px] text-slate-500 pt-1">
              <strong>Outcome:</strong> {investigation.summary.investigationOutcome}
            </div>
          </div>

          {/* Section B: Established Facts */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Established Facts ({investigation.establishedFacts.length})
            </h4>
            <div className="space-y-1.5">
              {investigation.establishedFacts.map((fact) => (
                <div
                  key={fact.factId}
                  className="p-2.5 rounded-lg border border-slate-200 bg-white text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{fact.description}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                        fact.classification === 'OBSERVED_FACT'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-blue-50 text-blue-800 border border-blue-200'
                      }`}
                    >
                      {fact.classification.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Citations: {fact.sourceEvidenceIds.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section C: AI Inferences */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
              AI Inferences & Root-Cause Hypotheses ({investigation.inferences.length})
            </h4>
            <div className="space-y-2">
              {investigation.inferences.map((inf) => (
                <div
                  key={inf.inferenceId}
                  className="p-3 rounded-lg border border-indigo-100 bg-indigo-50/30 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900">{inf.explanation}</span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                        inf.confidenceCategory === 'HIGH'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inf.confidenceCategory === 'MEDIUM'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {inf.confidenceCategory} CONFIDENCE
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600">
                    <strong>Rationale:</strong> {inf.confidenceRationale}
                  </p>
                  <p className="text-[11px] text-amber-800">
                    <strong>Uncertainty:</strong> {inf.explicitUncertainty}
                  </p>
                  <div className="text-[10px] text-slate-400 font-mono">
                    Supporting: {inf.supportingEvidenceIds.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section D: Missing Evidence */}
          {investigation.missingEvidence && investigation.missingEvidence.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                Missing Evidence ({investigation.missingEvidence.length})
              </h4>
              <div className="space-y-1.5">
                {investigation.missingEvidence.map((m, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg border border-slate-200 bg-white text-xs space-y-1"
                  >
                    <div className="font-bold text-slate-800">{m.item}</div>
                    <div className="text-[11px] text-slate-600">
                      <strong>Why it matters:</strong> {m.whyItMatters}
                    </div>
                    <div className="text-[11px] text-teal-800">
                      <strong>How to obtain:</strong> {m.howToObtain}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section E: Suggested Next Investigative Steps */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowRight className="w-3.5 h-3.5 text-slate-700" />
              Suggested Operator Steps ({investigation.suggestedSteps.length})
            </h4>
            <div className="space-y-1.5">
              {investigation.suggestedSteps.map((step) => (
                <div
                  key={step.stepNumber}
                  className="p-2.5 rounded-lg border border-slate-200 bg-white text-xs flex items-start gap-2.5"
                >
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {step.stepNumber}
                  </span>
                  <div className="space-y-1">
                    <span className="font-bold text-slate-900">{step.action}</span>
                    <p className="text-[11px] text-slate-600">{step.rationale}</p>
                    <div className="text-[10px] text-indigo-700">
                      <strong>Verification:</strong> {step.requiredVerification}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

