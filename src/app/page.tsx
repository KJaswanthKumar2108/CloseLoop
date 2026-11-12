'use client';

import React from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist';
import { ServiceStatusCard } from '@/components/dashboard/ServiceStatusCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  Layers,
  Calculator,
  Bot,
  ArrowRight,
  AlertTriangle,
  PlayCircle,
} from 'lucide-react';
import { useWorkbench } from '@/context/WorkbenchContext';

export default function OverviewPage() {
  const { activeRun, datasetOrigin, runHistory } = useWorkbench();

  const manualReviewCount = activeRun
    ? activeRun.records.filter((r) => r.confidence === 'MANUAL_REVIEW_REQUIRED').length
    : 0;

  return (
    <div className="space-y-8">
      {/* Page Title & Status */}
      <PageHeader
        title="Financial Operations Overview"
        description="Every payment accounted for. Every discrepancy explained. Every action under control."
        badge={
          <StatusBadge
            status={activeRun ? 'matched' : 'info'}
            label={activeRun ? `Active Run: ${activeRun.id}` : 'PayPal AI Operations Command'}
            showDot
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/demo">
              <Button variant="outline" size="sm" leftIcon={<PlayCircle className="w-3.5 h-3.5 text-[#0070E0]" />}>
                Guided Demo Workspace
              </Button>
            </Link>
            <Link href="/reconciliation">
              <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                Reconciliation Workbench
              </Button>
            </Link>
          </div>
        }
      />

      {/* Editorial Hero Banner */}
      <div className="p-6 rounded-2xl border border-[#DFE7F1] bg-gradient-to-br from-[#071B3A] via-[#003087] to-[#0070E0] text-white shadow-md relative overflow-hidden">
        <div className="max-w-2xl space-y-3 relative z-10">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[10px] font-bold uppercase tracking-wider text-[#009CDE]">
            <span>Enterprise Financial Operations</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            Financial operations. Under control.
          </h1>
          <p className="text-xs text-slate-200 leading-relaxed max-w-xl">
            Trace every payment, investigate every exception, and control every resolution from one operational workspace.
            Powered by <strong>Bryntum Grid 8.0</strong> for high-density record matching and <strong>Google Gemini</strong> for evidence-grounded AI investigations.
          </p>
          <div className="flex items-center gap-3 pt-2">
            <Link href="/reconciliation">
              <button className="px-4 py-2 rounded-lg bg-white text-[#003087] font-bold text-xs hover:bg-[#F5F8FC] transition-colors shadow-sm cursor-pointer">
                Launch Bryntum Workbench
              </button>
            </Link>
            <Link href="/demo">
              <button className="px-4 py-2 rounded-lg bg-[#003087]/50 border border-white/30 text-white font-semibold text-xs hover:bg-white/10 transition-colors cursor-pointer">
                Explore 3 Guided Scenarios
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Executive Operational Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#52657D]">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Total Batches</span>
            <Layers className="w-4 h-4 text-[#0070E0]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#10243E]">
              {runHistory.length}
            </span>
            <span className="text-[11px] text-[#8291A5]">runs recorded</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#52657D]">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Active Records</span>
            <Calculator className="w-4 h-4 text-[#00875A]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#10243E]">
              {activeRun ? activeRun.records.length : 0}
            </span>
            <span className="text-[11px] text-[#8291A5]">reconciled items</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#52657D]">
            <span className="font-semibold uppercase tracking-wider text-[10px]">Exceptions In Queue</span>
            <AlertTriangle className="w-4 h-4 text-[#D97706]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-[#D97706]">
              {manualReviewCount}
            </span>
            <span className="text-[11px] text-[#8291A5]">requiring review</span>
          </div>
        </div>

        <div className="p-4 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs">
          <div className="flex items-center justify-between text-xs text-[#52657D]">
            <span className="font-semibold uppercase tracking-wider text-[10px]">AI Grounding Mode</span>
            <Bot className="w-4 h-4 text-[#0070E0]" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-sm font-bold text-[#10243E]">
              Strict Canonical Sandbox
            </span>
          </div>
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Active Reconciliation Snapshot */}
          <div className="p-5 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#EAF0F6]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#0070E0]" />
                <h2 className="text-xs font-bold text-[#10243E] uppercase tracking-wider">
                  Active Reconciliation Run
                </h2>
              </div>
              {datasetOrigin && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F5F8FC] border border-[#DFE7F1] text-[#52657D] font-bold">
                  {datasetOrigin}
                </span>
              )}
            </div>

            {activeRun ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                    <span className="text-[#8291A5] text-[10px] uppercase font-bold block">Matched</span>
                    <span className="text-lg font-bold font-mono text-[#00875A] mt-1 block">
                      {activeRun.matchedCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                    <span className="text-[#8291A5] text-[10px] uppercase font-bold block">Exceptions</span>
                    <span className="text-lg font-bold font-mono text-[#D97706] mt-1 block">
                      {activeRun.exceptionCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                    <span className="text-[#8291A5] text-[10px] uppercase font-bold block">Unmatched</span>
                    <span className="text-lg font-bold font-mono text-[#D92D3F] mt-1 block">
                      {activeRun.unmatchedOrderCount + activeRun.unmatchedTransactionCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                    <span className="text-[#8291A5] text-[10px] uppercase font-bold block">Match Rate</span>
                    <span className="text-lg font-bold font-mono text-[#0070E0] mt-1 block">
                      {activeRun.totalOrders > 0
                        ? `${Math.round((activeRun.matchedCount / activeRun.totalOrders) * 100)}%`
                        : '0%'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-[#52657D]">
                    Dataset ID: <code className="font-mono text-[#10243E]">{activeRun.id}</code>
                  </span>
                  <Link href="/reconciliation">
                    <Button variant="primary" size="sm" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
                      Open in Bryntum Grid
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={Layers}
                title="No Reconciliation Active"
                description="Load synthetic sample data or upload merchant ledger files to start deterministic matching."
                action={{
                  label: "Go to Reconciliation Workbench",
                  href: "/reconciliation"
                }}
              />
            )}
          </div>

          <OnboardingChecklist />
        </div>

        <div className="space-y-6">
          <ServiceStatusCard />
        </div>
      </div>
    </div>
  );
}
