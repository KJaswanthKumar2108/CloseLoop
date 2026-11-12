'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  PlayCircle,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Layers,
  Sparkles,
} from 'lucide-react';
import { DEMO_SCENARIOS, DemoScenario } from '@/lib/demo/demoScenarios';
import { MANDATORY_SIMULATION_DISCLAIMER } from '@/lib/execution/types';

export default function DemoWorkspacePage() {
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulatedResult, setSimulatedResult] = useState<{
    scenarioId: string;
    executionId: string;
    timestamp: string;
    simulatedHash: string;
    status: string;
  } | null>(null);

  const scenario = DEMO_SCENARIOS[selectedScenarioIndex];

  const handleRunDemoSimulation = (s: DemoScenario) => {
    setIsSimulating(true);
    setTimeout(() => {
      setSimulatedResult({
        scenarioId: s.id,
        executionId: `demo_exec_${s.scenarioNumber}_${Date.now()}`,
        timestamp: new Date().toISOString(),
        simulatedHash: 'a7f9c2e48b1d603e5c7a91f34d8e2b0c6198f4e27b9c1d3a5e8f0a2b4c6e8d1a',
        status: 'SIMULATED',
      });
      setIsSimulating(false);
    }, 450);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Guided Demonstration Workspace"
        description="Repeatable, guided demonstration of CloseLoop's end-to-end exception resolution lifecycle."
        badge={
          <StatusBadge
            status="info"
            label="DEMO DATA — ISOLATED TEST HARNESS"
            showDot
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href="/reconciliation">
              <Button variant="outline" size="sm" leftIcon={<Layers className="w-3.5 h-3.5 text-[#0070E0]" />}>
                Reconciliation Workbench
              </Button>
            </Link>
            <Link href="/approvals">
              <Button variant="primary" size="sm" rightIcon={<ShieldCheck className="w-3.5 h-3.5" />}>
                Approvals Gate
              </Button>
            </Link>
          </div>
        }
      />

      {/* Safety & Isolation Notice */}
      <div className="p-4 rounded-xl border border-[#DFE7F1] bg-[#EFF6FF] shadow-2xs flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#003087] flex items-center justify-center text-white shrink-0 mt-0.5">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-[#10243E] uppercase tracking-wider">
              Hermetic Demonstration Environment
            </h3>
            <p className="text-xs text-[#52657D] mt-0.5 leading-relaxed">
              Demonstrates 3 deterministic scenarios: <strong>Amount Variance</strong>, <strong>Duplicate Payment Protection</strong>, and <strong>Ambiguous Evidence Suppression</strong>.
              All actions are performed in dry-run mode.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white text-[#0070E0] border border-[#BFDBFE]">
          {MANDATORY_SIMULATION_DISCLAIMER}
        </span>
      </div>

      {/* Scenario Selector Pills */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {DEMO_SCENARIOS.map((sc, idx) => {
          const isSelected = idx === selectedScenarioIndex;
          return (
            <button
              key={sc.id}
              onClick={() => {
                setSelectedScenarioIndex(idx);
                setSimulatedResult(null);
              }}
              className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                isSelected
                  ? 'border-[#0070E0] bg-white shadow-md ring-2 ring-[#0070E0]/20'
                  : 'border-[#DFE7F1] bg-[#F8FAFD] hover:bg-white text-[#52657D]'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-[#0070E0]">
                  SCENARIO {sc.scenarioNumber}
                </span>
                {isSelected && (
                  <span className="w-2 h-2 rounded-full bg-[#00875A]" />
                )}
              </div>
              <h4 className="text-xs font-bold text-[#10243E] mt-1">
                {sc.title}
              </h4>
              <p className="text-[11px] text-[#52657D] mt-1 line-clamp-2">
                {sc.tagline}
              </p>
            </button>
          );
        })}
      </div>

      {/* Active Scenario Workflow Canvas */}
      <div className="p-6 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-[#EAF0F6]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-[#EFF6FF] text-[#003087]">
                SCENARIO {scenario.scenarioNumber}
              </span>
              <h2 className="text-base font-bold text-[#10243E]">
                {scenario.title}
              </h2>
            </div>
            <p className="text-xs text-[#52657D] mt-1">
              {scenario.narrative}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<PlayCircle className="w-4 h-4" />}
            onClick={() => handleRunDemoSimulation(scenario)}
            isLoading={isSimulating}
          >
            {isSimulating ? 'Simulating Dry-Run...' : 'Simulate Lifecycle'}
          </Button>
        </div>

        {/* 7-Stage Lifecycle Progression */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold text-[#10243E] uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#0070E0]" />
            <span>Operational Lifecycle Stages</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <span className="text-[10px] font-mono font-bold text-[#0070E0] uppercase block">1. DETECT</span>
              <span className="font-semibold text-[#10243E] mt-0.5 block">{scenario.discrepancyType}</span>
              <span className="text-[11px] text-[#52657D] mt-0.5 block">Identified via multi-pass reconciliation</span>
            </div>

            <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <span className="text-[10px] font-mono font-bold text-[#0070E0] uppercase block">2. INVESTIGATE</span>
              <span className="font-semibold text-[#10243E] mt-0.5 block">AI Evidence Context</span>
              <span className="text-[11px] text-[#52657D] mt-0.5 block">Grounded in minor-unit transaction facts</span>
            </div>

            <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <span className="text-[10px] font-mono font-bold text-[#0070E0] uppercase block">3. DECIDE</span>
              <span className="font-semibold text-[#10243E] mt-0.5 block">Catalog Action</span>
              <span className="text-[11px] text-[#52657D] mt-0.5 block">{scenario.recommendedActionId}</span>
            </div>

            <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <span className="text-[10px] font-mono font-bold text-[#0070E0] uppercase block">4. APPROVE</span>
              <span className="font-semibold text-[#10243E] mt-0.5 block">Canonical Hash Gate</span>
              <span className="text-[11px] text-[#52657D] mt-0.5 block">Cryptographic parameter binding</span>
            </div>
          </div>
        </div>

        {/* Simulation Output Card (if executed) */}
        {simulatedResult && (
          <div className="p-4 rounded-xl border border-[#B2ECC8] bg-[#E8F8F0] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#00875A] flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-[#00875A]" />
                <span>Lifecycle Simulation Succeeded</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white text-[#00875A] border border-[#B2ECC8]">
                {simulatedResult.status}
              </span>
            </div>
            <p className="text-xs text-[#10243E]">
              Demonstration run executed cleanly without writing to real PayPal financial rails.
            </p>
            <div className="p-2.5 rounded bg-white border border-[#B2ECC8] font-mono text-[11px] text-[#10243E] flex items-center justify-between">
              <span>Canonical Hash: {simulatedResult.simulatedHash}</span>
              <span className="text-[#8291A5]">{simulatedResult.timestamp}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
