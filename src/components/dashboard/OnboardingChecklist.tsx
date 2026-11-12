import React from 'react';
import Link from 'next/link';
import { KeyRound, UploadCloud, Cpu, ArrowRight } from 'lucide-react';

export const OnboardingChecklist: React.FC = () => {
  const steps = [
    {
      step: '01',
      title: 'Connect PayPal Sandbox',
      description:
        'Provide your PayPal Sandbox Client ID and Secret in settings or environment variables to enable transaction history ingestion.',
      href: '/settings',
      actionText: 'Configure Credentials',
      icon: KeyRound,
      status: 'Required',
    },
    {
      step: '02',
      title: 'Import Merchant Ledger Records',
      description:
        'Upload your internal orders, invoices, or ERP ledger files to provide the baseline records for reconciliation comparison.',
      href: '/reconciliation',
      actionText: 'Go to Reconciliation',
      icon: UploadCloud,
      status: 'Next Step',
    },
    {
      step: '03',
      title: 'Run Deterministic Reconciliation',
      description:
        'The deterministic matching engine will compare IDs, timestamps, and exact minor units, routing any discrepancies to the AI Copilot.',
      href: '/exceptions',
      actionText: 'View Exceptions Queue',
      icon: Cpu,
      status: 'Automated',
    },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Reconciliation Readiness Checklist
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Complete the operational setup to initiate deterministic matching against PayPal Sandbox.
          </p>
        </div>
        <span className="text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
          Phase 1: Foundation Active
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
        {steps.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.step}
              className="p-5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-8 h-8 rounded-md bg-white border border-slate-200 flex items-center justify-center text-slate-700 shadow-2xs">
                    <Icon className="w-4 h-4 text-teal-600" />
                  </div>
                  <span className="text-[11px] font-mono font-bold text-slate-400">
                    STEP {item.step}
                  </span>
                </div>

                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-200/60 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {item.status}
                </span>
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 transition-colors"
                >
                  <span>{item.actionText}</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

