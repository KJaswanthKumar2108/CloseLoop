'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';

const routeNameMap: Record<string, string> = {
  reconciliation: 'Reconciliation',
  exceptions: 'Exceptions Queue',
  copilot: 'AI Copilot',
  approvals: 'Approvals Gate',
  audit: 'Activity & Audit',
  settings: 'Settings & Configuration',
};

export const Breadcrumbs: React.FC = () => {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-500" aria-label="Breadcrumb">
      <Link
        href="/"
        className="flex items-center gap-1 text-slate-600 hover:text-slate-900 transition-colors"
      >
        <Home className="w-3.5 h-3.5" />
        <span className="sr-only sm:not-sr-only sm:inline-block">Overview</span>
      </Link>

      {segments.map((seg, idx) => {
        const path = `/${segments.slice(0, idx + 1).join('/')}`;
        const isLast = idx === segments.length - 1;
        const displayName = routeNameMap[seg] || seg;

        return (
          <React.Fragment key={path}>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {isLast ? (
              <span className="font-semibold text-slate-800" aria-current="page">
                {displayName}
              </span>
            ) : (
              <Link
                href={path}
                className="text-slate-600 hover:text-slate-900 transition-colors"
              >
                {displayName}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};

