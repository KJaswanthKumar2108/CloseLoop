'use client';

import React, { useState } from 'react';
import {
  KeyRound,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldAlert,
  Search,
  Lock,
} from 'lucide-react';
import { fetchPayPalStatus } from '@/lib/api/paypalClient';
import { PayPalConnectionStatusResult } from '@/lib/paypal/auth';

interface PayPalSandboxCardProps {
  initialConfigured: boolean;
  initialHasClientId: boolean;
  initialHasSecret: boolean;
}

export const PayPalSandboxCard: React.FC<PayPalSandboxCardProps> = ({
  initialHasClientId,
  initialHasSecret,
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [statusResult, setStatusResult] = useState<PayPalConnectionStatusResult | null>(null);

  const handleTestConnection = async () => {
    setIsChecking(true);
    try {
      const result = await fetchPayPalStatus();
      setStatusResult(result);
    } catch {
      setStatusResult({
        provider: 'PayPal',
        environment: 'sandbox',
        configured: initialHasClientId && initialHasSecret,
        authenticated: false,
        transactionSearchAuthorized: false,
        status: 'SERVICE_UNAVAILABLE',
        message: 'Unexpected network error testing connection.',
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setIsChecking(false);
    }
  };

  const getStatusBadge = () => {
    if (isChecking) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
          <RefreshCw className="w-3 h-3 animate-spin text-amber-600" />
          <span>Testing Sandbox...</span>
        </span>
      );
    }

    if (!statusResult) {
      if (!initialHasClientId || !initialHasSecret) {
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Lock className="w-3 h-3 text-slate-500" />
            <span>Not Configured</span>
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
          <span>Ready to Test</span>
        </span>
      );
    }

    switch (statusResult.status) {
      case 'CONNECTED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Connected & Authorized</span>
          </span>
        );
      case 'INSUFFICIENT_SCOPE':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <ShieldAlert className="w-3 h-3 text-amber-600" />
            <span>Missing Search Scope</span>
          </span>
        );
      case 'AUTHENTICATION_FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            <span>Authentication Failed</span>
          </span>
        );
      case 'NOT_CONFIGURED':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <Lock className="w-3 h-3 text-slate-500" />
            <span>Not Configured</span>
          </span>
        );
      case 'SERVICE_UNAVAILABLE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <AlertCircle className="w-3 h-3 text-rose-600" />
            <span>Service Unavailable</span>
          </span>
        );
    }
  };

  return (
    <div className="p-6 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">
            PayPal Developer Platform (Sandbox)
          </h2>
        </div>
        <div className="flex items-center gap-3">
          {getStatusBadge()}
          <a
            href="https://developer.paypal.com/dashboard/applications/sandbox"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 font-medium"
          >
            <span>Developer Dashboard</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* Connectivity & Permission Matrix */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Environment</span>
          <span className="font-semibold text-slate-900 font-mono text-xs mt-0.5 block">
            Sandbox (api-m.sandbox.paypal.com)
          </span>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">OAuth Authentication</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {statusResult?.authenticated ? (
              <span className="font-semibold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Verified
              </span>
            ) : statusResult?.status === 'AUTHENTICATION_FAILED' ? (
              <span className="font-semibold text-rose-700 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> Failed
              </span>
            ) : (
              <span className="text-slate-600 font-medium">
                {initialHasClientId && initialHasSecret ? 'Ready for verification' : 'Awaiting credentials'}
              </span>
            )}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
          <span className="text-[11px] text-slate-500 font-medium block">Transaction Search Scope</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            {statusResult?.transactionSearchAuthorized ? (
              <span className="font-semibold text-emerald-700 flex items-center gap-1">
                <Search className="w-3.5 h-3.5 text-emerald-600" /> Authorized
              </span>
            ) : statusResult?.status === 'INSUFFICIENT_SCOPE' ? (
              <span className="font-semibold text-amber-700 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Not Granted
              </span>
            ) : (
              <span className="text-slate-600 font-medium">Pending test</span>
            )}
          </div>
        </div>
      </div>

      {/* Result Banner (if test was performed) */}
      {statusResult && (
        <div
          className={`p-3.5 rounded-lg border text-xs leading-relaxed ${
            statusResult.status === 'CONNECTED'
              ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
              : statusResult.status === 'INSUFFICIENT_SCOPE'
              ? 'bg-amber-50/80 border-amber-200 text-amber-950'
              : statusResult.status === 'NOT_CONFIGURED'
              ? 'bg-slate-50 border-slate-200 text-slate-800'
              : 'bg-rose-50/80 border-rose-200 text-rose-950'
          }`}
        >
          <div className="flex items-start gap-2">
            {statusResult.status === 'CONNECTED' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : statusResult.status === 'INSUFFICIENT_SCOPE' ? (
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-semibold">
                {statusResult.status === 'CONNECTED' && 'Sandbox Connectivity Verified'}
                {statusResult.status === 'INSUFFICIENT_SCOPE' && 'Insufficient Scope Warning'}
                {statusResult.status === 'AUTHENTICATION_FAILED' && 'OAuth Authentication Failed'}
                {statusResult.status === 'NOT_CONFIGURED' && 'Configuration Required'}
                {statusResult.status === 'SERVICE_UNAVAILABLE' && 'Sandbox Service Unavailable'}
              </div>
              <p className="text-[11px] opacity-90">{statusResult.message}</p>
              <p className="text-[10px] text-slate-500 font-mono pt-1">
                Last checked: {new Date(statusResult.checkedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Scope Disclaimer Notice */}
      <div className="p-3 rounded-lg bg-amber-50/50 border border-amber-200/60 text-[11px] text-amber-900 leading-relaxed">
        <span className="font-semibold">Important Distinction:</span> A successful connection test verifies that your Sandbox OAuth credentials authenticate and possess the required <code className="font-mono bg-amber-100/70 px-1 py-0.5 rounded text-[10px]">reporting/search/read</code> scope. It does not import transactions or prove that data has been reconciled.
      </div>

      {/* Variables Configuration Status */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div>
            <span className="font-medium text-slate-800 block">PAYPAL_CLIENT_ID</span>
            <span className="text-[11px] text-slate-400">OAuth2 Client Identification</span>
          </div>
          {initialHasClientId ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Present
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Missing in .env.local
            </span>
          )}
        </div>

        <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div>
            <span className="font-medium text-slate-800 block">PAYPAL_CLIENT_SECRET</span>
            <span className="text-[11px] text-slate-400">Server-Side Basic Auth Secret</span>
          </div>
          {initialHasSecret ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Present
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Missing in .env.local
            </span>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="pt-2 flex items-center justify-between border-t border-slate-100">
        <span className="text-[11px] text-slate-500">
          Server-side OAuth2 client credentials flow
        </span>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={isChecking}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 text-xs font-medium transition-colors shadow-2xs cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'Verifying Sandbox...' : 'Test Sandbox Connection'}</span>
        </button>
      </div>
    </div>
  );
};

