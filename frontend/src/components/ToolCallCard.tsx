'use client';

import { Code2, CheckCircle2, Loader2 } from 'lucide-react';
import { SSEEvent } from '@/lib/types';

interface ToolCallCardProps {
  event: SSEEvent;
}

export default function ToolCallCard({ event }: ToolCallCardProps) {
  const data = event.data as any;
  const isStart = event.type === 'tool_start';
  const toolName = data.tool || 'unknown';
  const input = data.input;
  const output = data.output;

  return (
    <div className="animate-fade-in border border-surface-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-elevated">
        {isStart ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        )}
        <Code2 className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs font-medium text-gray-300">{toolName}</span>
      </div>

      {/* Code input (for execute_code) */}
      {input?.code && (
        <div className="px-3 py-2 border-t border-surface-border">
          <pre className="text-xs text-gray-400 font-mono max-h-40 overflow-y-auto whitespace-pre-wrap">
            {input.code.length > 500 ? input.code.slice(0, 500) + '...' : input.code}
          </pre>
        </div>
      )}

      {/* Output */}
      {output && (
        <div className="px-3 py-2 border-t border-surface-border">
          <pre className="text-xs text-green-400/80 font-mono max-h-32 overflow-y-auto whitespace-pre-wrap">
            {output.length > 500 ? output.slice(0, 500) + '...' : output}
          </pre>
        </div>
      )}
    </div>
  );
}
