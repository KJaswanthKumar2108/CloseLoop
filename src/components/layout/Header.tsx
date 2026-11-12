'use client';

import React, { useState, useEffect } from 'react';
import { Breadcrumbs } from './Breadcrumbs';
import { ShieldCheck, Terminal, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { fetchPayPalStatus } from '@/lib/api/paypalClient';

export const Header: React.FC = () => {
  const [sandboxStatus, setSandboxStatus] = useState<{
    connected: boolean;
    loading: boolean;
  }>({
    connected: false,
    loading: true,
  });

  useEffect(() => {
    let isMounted = true;
    async function checkStatus() {
      try {
        const result = await fetchPayPalStatus();
        if (isMounted) {
          setSandboxStatus({
            connected: result.status === 'CONNECTED',
            loading: false,
          });
        }
      } catch {
        if (isMounted) {
          setSandboxStatus({
            connected: false,
            loading: false,
          });
        }
      }
    }
    checkStatus();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <header className="h-16 border-b border-[#DFE7F1] bg-white/90 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
      <div className="flex items-center gap-4">
        <Breadcrumbs />
      </div>

      <div className="flex items-center gap-3">
        {/* Real PayPal Sandbox Connectivity Indicator */}
        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${
            sandboxStatus.loading
              ? 'bg-[#EFF6FF] border-[#BFDBFE] text-[#1E40AF]'
              : sandboxStatus.connected
              ? 'bg-[#E8F8F0] border-[#B2ECC8] text-[#00875A]'
              : 'bg-[#FEF6E7] border-[#FCE3B4] text-[#D97706]'
          }`}
        >
          {sandboxStatus.loading ? (
            <RefreshCw className="w-3 h-3 animate-spin text-[#0070E0]" />
          ) : sandboxStatus.connected ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-[#00875A]" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-[#D97706]" />
          )}
          <span>
            {sandboxStatus.loading
              ? 'Checking PayPal Sandbox...'
              : sandboxStatus.connected
              ? 'PayPal Sandbox Connected'
              : 'PayPal Sandbox Offline'}
          </span>
        </div>

        {/* Security / Strict Mode Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F5F8FC] border border-[#DFE7F1] text-[#10243E] text-xs font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-[#0070E0]" />
          <span>Human Gate Active</span>
        </div>

        {/* API Health Pill */}
        <a
          href="/api/health"
          target="_blank"
          rel="noreferrer"
          className="hidden md:flex items-center gap-1 px-2.5 py-1 rounded text-xs text-[#52657D] hover:text-[#10243E] hover:bg-[#F5F8FC] transition-colors"
          title="Inspect GET /api/health endpoint"
        >
          <Terminal className="w-3.5 h-3.5 text-[#8291A5]" />
          <span className="font-mono text-[11px] font-semibold">/api/health</span>
        </a>
      </div>
    </header>
  );
};
