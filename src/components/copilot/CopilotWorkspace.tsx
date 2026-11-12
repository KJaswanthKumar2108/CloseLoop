import React from 'react';
import { Bot, Sparkles, Send } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface CopilotWorkspaceProps {
  currentInvestigationId?: string;
}

export const CopilotWorkspace: React.FC<CopilotWorkspaceProps> = ({
  currentInvestigationId,
}) => {
  return (
    <div className="flex flex-col h-full rounded-xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-teal-600" />
          <span className="text-xs font-semibold text-slate-800">
            CloseLoop Copilot Investigation
          </span>
        </div>
        {currentInvestigationId && (
          <span className="font-mono text-[11px] text-slate-500">
            Ref: {currentInvestigationId}
          </span>
        )}
      </div>

      <div className="flex-1 p-6 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-center text-teal-600 mb-3">
          <Sparkles className="w-6 h-6" />
        </div>
        <h4 className="text-sm font-semibold text-slate-900 mb-1">
          Evidence-Grounded Intelligence
        </h4>
        <p className="text-xs text-slate-500 max-w-sm leading-relaxed">
          Select an exception from the queue or input a specific PayPal Transaction ID. 
          The copilot will inspect settlement line items, verify applicable fee schedules, and propose remediation actions.
        </p>
      </div>

      <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex items-center gap-2">
        <input
          type="text"
          placeholder="Ask a question or request discrepancy breakdown..."
          disabled
          className="flex-1 px-3.5 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-400 placeholder-slate-400 cursor-not-allowed"
        />
        <Button variant="teal" size="sm" disabled leftIcon={<Send className="w-3.5 h-3.5" />}>
          Send
        </Button>
      </div>
    </div>
  );
};

