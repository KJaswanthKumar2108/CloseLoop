'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  AlertTriangle,
  Sparkles,
  ShieldCheck,
  History,
  Settings,
  Menu,
  X,
  CreditCard,
  ChevronRight,
  PlayCircle,
} from 'lucide-react';

const navigationItems = [
  {
    name: 'Overview',
    href: '/',
    icon: LayoutDashboard,
    badge: null,
  },
  {
    name: 'Demo Workspace',
    href: '/demo',
    icon: PlayCircle,
    badge: 'Showcase',
  },
  {
    name: 'Reconciliation',
    href: '/reconciliation',
    icon: Layers,
    badge: 'Bryntum',
  },
  {
    name: 'Exceptions',
    href: '/exceptions',
    icon: AlertTriangle,
    badge: 'Queue',
  },
  {
    name: 'AI Copilot',
    href: '/copilot',
    icon: Sparkles,
    badge: 'Gemini',
  },
  {
    name: 'Approvals Gate',
    href: '/approvals',
    icon: ShieldCheck,
    badge: null,
  },
  {
    name: 'Audit Trail',
    href: '/audit',
    icon: History,
    badge: null,
  },
  {
    name: 'Settings',
    href: '/settings',
    icon: Settings,
    badge: null,
  },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <>
      {/* Mobile top trigger */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#071B3A] border-b border-[#1A3359] text-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0070E0] flex items-center justify-center text-white font-bold shadow-xs">
            <CreditCard className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-sm tracking-tight text-white leading-tight">
              CloseLoop
            </span>
            <span className="text-[10px] text-[#009CDE] font-mono tracking-wider uppercase font-semibold">
              PayPal AI Operations
            </span>
          </div>
        </Link>
        <button
          onClick={() => setIsMobileOpen(!isMobileOpen)}
          className="p-2 rounded-md text-slate-300 hover:text-white hover:bg-[#0E2952] focus:outline-none"
          aria-label="Toggle Navigation"
        >
          {isMobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-[#071B3A]/80 z-40 backdrop-blur-xs"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-64 bg-[#071B3A] text-slate-200 flex flex-col border-r border-[#152B4D] transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="px-5 py-5 border-b border-[#152B4D] flex items-center justify-between bg-[#05152E]">
          <Link
            href="/"
            onClick={() => setIsMobileOpen(false)}
            className="flex items-center gap-3 group"
          >
            <div className="w-9 h-9 rounded-lg bg-[#0070E0] flex items-center justify-center text-white shadow-md shadow-[#003087]/50 group-hover:bg-[#005bb5] transition-colors">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base text-white tracking-tight">
                  CloseLoop
                </span>
                <span className="text-[10px] font-bold bg-[#003087] text-[#009CDE] border border-[#0070E0]/40 px-1.5 py-0.5 rounded font-mono">
                  v1.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium tracking-tight">
                PayPal Financial Command Center
              </p>
            </div>
          </Link>
        </div>

        {/* Bryntum Category Showcase Pill */}
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-lg bg-[#0E264D] border border-[#1A3D73] flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[9px] uppercase font-bold text-[#009CDE] tracking-wider">
              Best Bryntum Use
            </span>
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Bryntum Grid 8.0</span>
            </span>
          </div>
          <span className="w-2 h-2 rounded-full bg-[#00875A] ring-4 ring-[#00875A]/20" />
        </div>

        {/* Navigation items */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-[#6882A6]">
            Operational Lifecycle
          </div>
          {navigationItems.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsMobileOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all group ${
                  active
                    ? 'bg-[#0070E0] text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-[#0E264D]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={`w-4 h-4 transition-colors ${
                      active
                        ? 'text-white'
                        : 'text-[#6882A6] group-hover:text-slate-200'
                    }`}
                  />
                  <span>{item.name}</span>
                </div>

                {item.badge ? (
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      active
                        ? 'bg-white text-[#003087]'
                        : item.badge === 'Bryntum'
                        ? 'bg-[#003087] text-[#009CDE] border border-[#0070E0]/30'
                        : 'bg-[#152B4D] text-slate-300 group-hover:text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                ) : active ? (
                  <ChevronRight className="w-3.5 h-3.5 text-white/80" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Footer info */}
        <div className="p-4 border-t border-[#152B4D] text-xs text-slate-400 flex flex-col gap-2 bg-[#05152E]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Environment</span>
            <span className="text-[11px] font-mono font-semibold text-[#00875A] bg-[#00875A]/15 px-2 py-0.5 rounded border border-[#00875A]/30">
              PayPal Sandbox Connected
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>Precision Mode</span>
            <span className="font-mono text-slate-300 font-semibold">Integer Minor Units</span>
          </div>
        </div>
      </aside>
    </>
  );
};
