import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { WorkbenchProvider } from '@/context/WorkbenchContext';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CloseLoop — AI-Powered PayPal Payment Reconciliation',
  description:
    'Every payment accounted for. Every discrepancy explained. Every action under control. PayPal AI Hackathon.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col text-slate-800 bg-slate-50 font-sans selection:bg-teal-500/20 selection:text-teal-900">
        <WorkbenchProvider>
          <Sidebar />
          <div className="lg:pl-64 flex flex-col flex-1 min-h-screen">
            <Header />
            <main className="flex-1 p-6 sm:p-8 max-w-7xl mx-auto w-full">
              {children}
            </main>
          </div>
        </WorkbenchProvider>
      </body>
    </html>
  );
}
