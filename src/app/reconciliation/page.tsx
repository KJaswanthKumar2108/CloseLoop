'use client';

import React, { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Layers,
  History,
  FileSpreadsheet,
  CheckCircle2,
  TableProperties,
  Search,
} from 'lucide-react';
import { useWorkbench } from '@/context/WorkbenchContext';
import { DatasetUploader } from '@/components/workbench/DatasetUploader';
import { ReconciliationSummaryCards } from '@/components/workbench/ReconciliationSummaryCards';
import { ReconciliationGrid } from '@/components/workbench/ReconciliationGrid';
import { ExceptionDetailDrawer } from '@/components/workbench/ExceptionDetailDrawer';
import { RunHistoryModal } from '@/components/workbench/RunHistoryModal';
import { ReconciliationRecord } from '@/types/financial';

export default function ReconciliationPage() {
  const {
    activeRun,
    datasetOrigin,
    importSummary,
    runHistory,
    reviews,
    selectedRecordId,
    setSelectedRecordId,
  } = useWorkbench();

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<ReconciliationRecord | null>(null);

  // Grid Controls
  const [quickFilterText, setQuickFilterText] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<string>('ALL');

  const handleSelectRecord = (record: ReconciliationRecord) => {
    setSelectedRecord(record);
    setSelectedRecordId(record.id);
  };

  const handleCloseDrawer = () => {
    setSelectedRecord(null);
    setSelectedRecordId(null);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Reconciliation Workbench"
        description="Multi-pass deterministic matching comparing PayPal settlement records against merchant ledger entries with Bryntum Grid 8."
        badge={
          activeRun ? (
            <div className="flex items-center gap-2">
              <StatusBadge
                status="matched"
                label={`Run: ${activeRun.id}`}
                showDot
              />
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#EFF6FF] text-[#003087] border border-[#BFDBFE] font-bold">
                Bryntum Grid 8.0.1
              </span>
            </div>
          ) : (
            <StatusBadge status="neutral" label="Awaiting Reconciliation Run" showDot />
          )
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<History className="w-3.5 h-3.5 text-[#0070E0]" />}
              onClick={() => setIsHistoryModalOpen(true)}
              disabled={runHistory.length === 0}
            >
              Run History ({runHistory.length})
            </Button>
          </div>
        }
      />

      {/* Dataset Importer & Origin Selector */}
      <DatasetUploader />

      {/* Imported Dataset Metadata Banner */}
      {importSummary && (
        <div className="p-4 rounded-xl border border-[#DFE7F1] bg-white shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-[#EAF0F6]">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#0070E0]" />
              <h2 className="text-xs font-bold text-[#10243E] uppercase tracking-wider">
                Ingested Reconciliation Batches
              </h2>
            </div>
            {datasetOrigin && (
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-[#F5F8FC] text-[#52657D] border border-[#DFE7F1]">
                Origin: {datasetOrigin}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-xs">
            {importSummary.orders && (
              <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                <div className="flex items-center justify-between font-semibold text-[#10243E]">
                  <span>Merchant Orders CSV</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00875A]" />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                  <div>
                    <span className="text-[#8291A5] block">Total Rows</span>
                    <span className="font-mono font-bold text-[#10243E]">
                      {importSummary.orders.totalRows}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#00875A] block">Valid</span>
                    <span className="font-mono font-bold text-[#00875A]">
                      {importSummary.orders.validRows}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#D92D3F] block">Invalid</span>
                    <span className="font-mono font-bold text-[#D92D3F]">
                      {importSummary.orders.invalidRows}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {importSummary.transactions && (
              <div className="p-3 rounded-lg bg-[#F8FAFD] border border-[#EAF0F6]">
                <div className="flex items-center justify-between font-semibold text-[#10243E]">
                  <span>PayPal Transactions CSV</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-[#00875A]" />
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                  <div>
                    <span className="text-[#8291A5] block">Total Rows</span>
                    <span className="font-mono font-bold text-[#10243E]">
                      {importSummary.transactions.totalRows}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#00875A] block">Valid</span>
                    <span className="font-mono font-bold text-[#00875A]">
                      {importSummary.transactions.validRows}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#D92D3F] block">Invalid</span>
                    <span className="font-mono font-bold text-[#D92D3F]">
                      {importSummary.transactions.invalidRows}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operational Summary Cards */}
      {activeRun && <ReconciliationSummaryCards run={activeRun} />}

      {/* Bryntum Technical Showcase Banner */}
      <div className="p-4 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] shadow-2xs flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0070E0] text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs font-bold text-xs">
            B8
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#003087] text-white font-mono">
                POWERED BY BRYNTUM GRID 8
              </span>
              <h3 className="text-xs font-bold text-[#10243E]">
                High-Performance Client-Side Financial Terminal
              </h3>
            </div>
            <p className="text-[11px] text-[#52657D] mt-0.5 leading-relaxed">
              Featuring multi-column sorting, instant quick search, column resizing, reordering, and sub-millisecond cell rendering for enterprise PayPal transactions.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono px-2 py-1 rounded bg-white text-[#0070E0] border border-[#BFDBFE] font-bold">
            Read-Only Immutable Mode
          </span>
        </div>
      </div>

      {/* Main Results Table */}
      {activeRun ? (
        <div className="space-y-3">
          {/* Grid Toolbar & Filters */}
          <div className="p-3 bg-white rounded-xl border border-[#DFE7F1] shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-[#8291A5] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Quick search records, orders, IDs..."
                  value={quickFilterText}
                  onChange={(e) => setQuickFilterText(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-[#DFE7F1] focus:outline-none focus:ring-2 focus:ring-[#0070E0] focus:border-transparent bg-[#F8FAFD]"
                />
              </div>

              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#DFE7F1] bg-[#F8FAFD] text-[#10243E] font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="MATCHED">MATCHED</option>
                <option value="DISCREPANCY">DISCREPANCY</option>
                <option value="AMBIGUOUS">AMBIGUOUS</option>
                <option value="UNMATCHED_ORDER">UNMATCHED_ORDER</option>
                <option value="UNMATCHED_TRANSACTION">UNMATCHED_TRANSACTION</option>
              </select>

              <select
                value={selectedDiscrepancy}
                onChange={(e) => setSelectedDiscrepancy(e.target.value)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-[#DFE7F1] bg-[#F8FAFD] text-[#10243E] font-medium"
              >
                <option value="ALL">All Discrepancies</option>
                <option value="NONE">NONE</option>
                <option value="AMOUNT_MISMATCH">AMOUNT_MISMATCH</option>
                <option value="FEE_VARIANCE">FEE_VARIANCE</option>
                <option value="TIMING_DELAY">TIMING_DELAY</option>
                <option value="CURRENCY_MISMATCH">CURRENCY_MISMATCH</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#52657D]">
              <TableProperties className="w-3.5 h-3.5 text-[#0070E0]" />
              <span>Showing <strong>{activeRun.records.length}</strong> reconciled records</span>
            </div>
          </div>

          <ReconciliationGrid
            records={activeRun.records}
            reviews={reviews}
            onSelectRecord={handleSelectRecord}
            selectedRecordId={selectedRecordId}
            quickFilterText={quickFilterText}
            selectedStatus={selectedStatus}
            selectedDiscrepancy={selectedDiscrepancy}
          />
        </div>
      ) : (
        <EmptyState
          icon={Layers}
          title="No Active Reconciliation Run"
          description="Select both Merchant Orders CSV and PayPal Transactions CSV above, or click 'Load Synthetic Sample Data' to run the deterministic engine."
        />
      )}

      {/* Exception Detail Drawer (Master-Detail Interaction) */}
      {selectedRecord && (
        <ExceptionDetailDrawer
          record={selectedRecord}
          onClose={handleCloseDrawer}
        />
      )}

      {/* Run History Modal */}
      {isHistoryModalOpen && (
        <RunHistoryModal
          runs={runHistory}
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
        />
      )}
    </div>
  );
}
