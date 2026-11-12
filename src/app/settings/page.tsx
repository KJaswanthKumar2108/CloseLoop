import React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { getEnvironmentStatus } from '@/lib/env';
import { PayPalSandboxCard } from '@/components/settings/PayPalSandboxCard';
import { PayPalTransactionPreviewCard } from '@/components/settings/PayPalTransactionPreviewCard';
import { PayPalImportCard } from '@/components/settings/PayPalImportCard';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Terminal,
  Database,
} from 'lucide-react';

export default function SettingsPage() {
  const envStatus = getEnvironmentStatus();
  const isConfigured = Boolean(envStatus.hasPaypalClientId && envStatus.hasPaypalSecret);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings & System Configuration"
        description="Manage PayPal Sandbox integration credentials, model parameters, and deterministic matching thresholds."
        badge={
          <StatusBadge
            status={isConfigured ? 'matched' : 'discrepancy'}
            label={isConfigured ? 'PayPal Sandbox Connected' : 'Awaiting Configuration'}
            showDot
          />
        }
      />

      {/* Security Guidance Note */}
      <div className="p-4 rounded-xl border border-[#DFE7F1] bg-[#EFF6FF] shadow-2xs flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-[#0070E0] shrink-0 mt-0.5" />
        <div className="text-xs text-[#10243E] leading-relaxed">
          <span className="font-bold">PayPal Security Notice:</span> CloseLoop enforces server-side credential isolation.
          Credentials must be configured via environment variables (<code className="font-mono bg-white px-1.5 py-0.5 rounded border border-[#BFDBFE]">.env.local</code>)
          and are never stored in client browsers, committed to version control, or returned via API responses.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PayPal Sandbox Connectivity & Verification Card */}
        <PayPalSandboxCard
          initialConfigured={isConfigured}
          initialHasClientId={envStatus.hasPaypalClientId}
          initialHasSecret={envStatus.hasPaypalSecret}
        />

        {/* Gemini AI Configuration Card */}
        <div className="p-6 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#EAF0F6]">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#0070E0]" />
              <h2 className="text-sm font-semibold text-[#10243E]">
                Google Gemini AI Foundation Model
              </h2>
            </div>
            <a
              href="https://aistudio.google.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#0070E0] hover:text-[#005bb5] font-medium"
            >
              <span>Google AI Studio</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <div>
                <span className="font-semibold text-[#10243E] block">
                  GEMINI_API_KEY
                </span>
                <span className="text-[11px] text-[#52657D]">
                  API key for evidence-grounded inference
                </span>
              </div>
              {envStatus.hasGeminiApiKey ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#00875A] bg-[#E8F8F0] px-2 py-0.5 rounded border border-[#B2ECC8]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00875A]" />
                  <span>Configured</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#D97706] bg-[#FEF6E7] px-2 py-0.5 rounded border border-[#FCE3B4]">
                  <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
                  <span>Missing in .env.local</span>
                </span>
              )}
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
              <div>
                <span className="font-semibold text-[#10243E] block">
                  GEMINI_MODEL
                </span>
                <span className="text-[11px] text-[#52657D]">
                  Default reasoning model
                </span>
              </div>
              <span className="font-mono text-xs text-[#003087] font-bold bg-[#EFF6FF] px-2.5 py-0.5 rounded border border-[#BFDBFE]">
                {envStatus.geminiModel}
              </span>
            </div>
          </div>

          {/* Database Role Pools Overview */}
          <div className="pt-2 border-t border-[#EAF0F6] space-y-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[#0070E0]" />
              <h3 className="text-xs font-bold text-[#10243E] uppercase tracking-wider">
                PostgreSQL Role Separation
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="p-2 rounded bg-[#F8FAFD] border border-[#EAF0F6]">
                <span className="text-[#8291A5] block">Reader Role</span>
                <span className="text-[#00875A] font-semibold">closeloop_reader</span>
              </div>
              <div className="p-2 rounded bg-[#F8FAFD] border border-[#EAF0F6]">
                <span className="text-[#8291A5] block">Auditor Role</span>
                <span className="text-[#00875A] font-semibold">closeloop_auditor</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phase 3C.2: PayPal Durable Ingestion & Ledger Card */}
      <PayPalImportCard isConfigured={isConfigured} />

      {/* Phase 3B: PayPal Transaction Search Preview Card */}
      <PayPalTransactionPreviewCard isConfigured={isConfigured} />
    </div>
  );
}
