'use client';

import { Bot, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CollapsibleToolCard from './CollapsibleToolCard';
import StageCompleteCard from './StageCompleteCard';
import { ChatItem } from '../types';

export default function renderChatItem(item: ChatItem) {
  switch (item.type) {
    case 'user':
      return (
        <div key={item.id} className="flex justify-end animate-fade-in">
          <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-primary-600 text-white text-sm">
            {item.content}
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div key={item.id} className="flex gap-3 animate-fade-in">
          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0 mt-0.5">
            <Bot className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-surface-elevated border border-surface-border text-sm text-gray-200 markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
          </div>
        </div>
      );
    case 'tool_start':
    case 'tool_end':
      return <CollapsibleToolCard key={item.id} item={item} />;
    case 'code_output':
      return null; // folded into the tool card above
    case 'error':
      return (
        <div
          key={item.id}
          className="animate-fade-in flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-800/50 rounded-lg text-sm text-red-400"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          {item.content}
        </div>
      );
    case 'status':
      return (
        <div key={item.id} className="text-center">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
              item.content.includes('running')
                ? 'bg-amber-500/20 text-amber-400'
                : item.content.includes('done')
                  ? 'bg-green-500/20 text-green-400'
                  : item.content === 'failed'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-neutral-800 text-gray-400'
            }`}
          >
            {item.content.includes('running') && <Loader2 className="w-3 h-3 animate-spin" />}
            {item.content.includes('done') && <CheckCircle2 className="w-3 h-3" />}
            {item.content.replace(/_/g, ' ')}
          </span>
        </div>
      );
    case 'stage_complete':
      return <StageCompleteCard key={item.id} item={item} />;
    default:
      return null;
  }
}
