import React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  Sparkles,
  Bot,
  ShieldCheck,
  CheckCircle2,
  Send,
} from 'lucide-react';

export default function CopilotPage() {
  const guardrails = [
    {
      title: 'Evidence-Grounded Citing',
      detail: 'Mandatory citations to verified PayPal transaction IDs and exact minor-unit figures.',
    },
    {
      title: 'Zero Math Authority',
      detail: 'The LLM never calculates authoritative ledger balances or declares matches on its own.',
    },
    {
      title: 'Human Review Mandatory',
      detail: 'All drafted remediation actions route directly to the Approvals Gate before execution.',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Financial Operations Copilot"
        description="Evidence-grounded intelligence powered by Google Gemini to analyze payment variances and draft remediation actions."
        badge={
          <StatusBadge
            status="info"
            label="Gemini 2.5 Flash • Read-Only Advisory"
            showDot
          />
        }
      />

      {/* Operational Guardrails Banner */}
      <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/60 shadow-2xs">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="w-4 h-4 text-teal-700" />
          <h2 className="text-xs font-bold text-teal-900 uppercase tracking-wider">
            AI Operating Boundaries & Guardrails
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {guardrails.map((g) => (
            <div key={g.title} className="text-xs">
              <div className="font-semibold text-teal-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span>{g.title}</span>
              </div>
              <p className="text-teal-800/80 text-[11px] mt-0.5 pl-5">
                {g.detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Main Copilot Interactive Surface (Shell) */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs flex flex-col h-[520px]">
        <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-teal-600" />
            <span className="text-xs font-semibold text-slate-800">
              Interactive Exception Investigation Workspace
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Grounding: Strict Sandbox Schema
          </span>
        </div>

        <div className="flex-1 p-6 flex flex-col justify-center items-center overflow-y-auto">
          <EmptyState
            icon={Sparkles}
            title="AI Copilot Standing By"
            description="The copilot is ready to analyze transaction variances. Once discrepancies are identified in Phase 3, select an exception item to trigger root-cause analysis, policy evaluation, and suggested remediation."
            badge="Phase 1 Active"
            action={{
              label: 'View Exceptions Queue',
              href: '/exceptions',
            }}
          />
        </div>

        {/* Input prompt bar (disabled during Phase 1) */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Ask Copilot about an exception (e.g., 'Why is there a $0.35 variance on order #10842?')..."
              disabled
              className="w-full px-4 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-400 placeholder-slate-400 cursor-not-allowed"
            />
          </div>
          <Button
            variant="teal"
            size="sm"
            disabled
            leftIcon={<Send className="w-3.5 h-3.5" />}
          >
            Investigate
          </Button>
        </div>
      </div>
    </div>
  );
}
