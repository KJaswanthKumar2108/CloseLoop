import React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import {
  History,
  Download,
  ScrollText,
  Shield,
  Clock,
} from 'lucide-react';

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity & Immutable Audit Log"
        description="Comprehensive audit trail recording all reconciliation batches, AI diagnoses, human approvals, and executed actions."
        badge={
          <StatusBadge
            status="approved"
            label="Cryptographic Hash Chaining"
            showDot
          />
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled
            leftIcon={<Download className="w-3.5 h-3.5" />}
          >
            Export Audit Trail (CSV)
          </Button>
        }
      />

      {/* Audit Specification Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-xs mb-1">
            <Clock className="w-4 h-4 text-teal-600" />
            <span>Append-Only Immutability</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Audit entries cannot be updated or purged. Every financial modification creates an irrevocable chronological record.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-xs mb-1">
            <Shield className="w-4 h-4 text-teal-600" />
            <span>Actor Attribution</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Distinguishes whether an event was initiated by the System Matcher, AI Copilot Proposal, or Human Approver.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center gap-2 text-slate-900 font-semibold text-xs mb-1">
            <ScrollText className="w-4 h-4 text-teal-600" />
            <span>Financial Integrity Proof</span>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Maintains hash signatures linking consecutive reconciliation states for independent accounting verification.
          </p>
        </div>
      </div>

      {/* Audit Table Area */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-slate-600" />
            <span className="text-xs font-semibold text-slate-800">
              System Audit Events
            </span>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Logging Active (Phase 1 Baseline)
          </span>
        </div>

        <div className="p-8">
          <EmptyState
            icon={ScrollText}
            title="System Initialized — Ready for Ingestion"
            description="CloseLoop audit logger is initialized. When transactions are ingested from PayPal Sandbox and matched against internal books, every match result, exception diagnosis, and operator approval will appear here."
            badge="Phase 1 Active"
            action={{
              label: 'View System Health',
              href: '/api/health',
            }}
          />
        </div>
      </div>
    </div>
  );
}
