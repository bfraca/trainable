'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Loader2,
  Bot,
  Code2,
  CheckCircle2,
  Terminal,
  AlertCircle,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { Message, SSEEvent, ToolStartEvent, ToolEndEvent } from '@/lib/types';
import MessageBubble from './MessageBubble';

interface ChatPanelProps {
  messages: Message[];
  streamEvents: SSEEvent[];
  streamingText: string;
  onSendMessage: (content: string) => void;
  onStop?: () => void;
  isRunning: boolean;
}

const FUN_VERBS = [
  'Schlepping',
  'Noodling',
  'Crunching',
  'Wrangling',
  'Percolating',
  'Tinkering',
  'Brewing',
  'Conjuring',
  'Finagling',
  'Rummaging',
  'Simmering',
  'Whittling',
  'Pondering',
  'Juggling',
  'Untangling',
];

const PAST_VERBS = [
  'Schlepped',
  'Noodled',
  'Crunched',
  'Wrangled',
  'Percolated',
  'Tinkered',
  'Brewed',
  'Conjured',
  'Finagled',
  'Rummaged',
  'Simmered',
  'Whittled',
  'Pondered',
  'Juggled',
  'Untangled',
];

function useFunVerb(isAnimating: boolean) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * FUN_VERBS.length));
  useEffect(() => {
    if (!isAnimating) return;
    const id = setInterval(() => {
      setIndex((prev) => (prev + 1) % FUN_VERBS.length);
    }, 10000);
    return () => clearInterval(id);
  }, [isAnimating]);
  return FUN_VERBS[index];
}

function ToolCard({ event }: { event: ToolStartEvent | ToolEndEvent }) {
  const isStart = event.type === 'tool_start';
  const [collapsed, setCollapsed] = useState(true);
  const funVerb = useFunVerb(isStart);
  const [startedAt] = useState(() => Date.now());
  const [doneLabel] = useState(() => PAST_VERBS[Math.floor(Math.random() * PAST_VERBS.length)]);
  const [elapsed, setElapsed] = useState(0);
  const code = event.type === 'tool_start' ? event.data.input?.code : undefined;
  const output = event.type === 'tool_end' ? event.data.output : undefined;

  useEffect(() => {
    if (!isStart) return;
    const id = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [isStart, startedAt]);

  const displaySeconds = isStart ? elapsed : Math.max(1, elapsed);

  return (
    <div className="animate-fade-in border border-surface-border rounded-lg overflow-hidden mx-1">
      <div
        className="flex items-center gap-2 px-3 py-2 bg-neutral-800/80 cursor-pointer select-none"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setCollapsed((prev) => !prev);
          }
        }}
      >
        {isStart ? (
          <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
        )}
        <Code2 className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs font-medium text-gray-300 flex-1">
          {isStart
            ? `${funVerb}...${elapsed > 0 ? ` ${elapsed}s` : ''}`
            : `${doneLabel} for ${displaySeconds}s`}
        </span>
        <ChevronRight
          className={`w-3 h-3 text-gray-500 transition-transform duration-150 ${
            !collapsed ? 'rotate-90' : ''
          }`}
        />
      </div>
      {!collapsed && (
        <>
          {code && (
            <div className="px-3 py-2 border-t border-neutral-700/50">
              <pre className="text-xs text-gray-400 font-mono max-h-28 overflow-y-auto whitespace-pre-wrap">
                {code.length > 400 ? code.slice(0, 400) + '...' : code}
              </pre>
            </div>
          )}
          {output && (
            <div className="px-3 py-2 border-t border-neutral-700/50">
              <pre className="text-xs text-green-400/80 font-mono max-h-28 overflow-y-auto whitespace-pre-wrap">
                {output.length > 500 ? output.slice(0, 500) + '...' : output}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CodeOutput({ text, stream }: { text: string; stream: string }) {
  return (
    <div className="flex items-start gap-1.5 px-2 mx-1">
      <Terminal className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
      <pre
        className={`text-xs font-mono whitespace-pre-wrap break-all ${
          stream === 'stderr' ? 'text-red-400/70' : 'text-gray-500'
        }`}
      >
        {text}
      </pre>
    </div>
  );
}

export default function ChatPanel({
  messages,
  streamEvents,
  streamingText,
  onSendMessage,
  onStop,
  isRunning,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamEvents, streamingText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {/* Persisted messages */}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
        ))}

        {/* Live stream events */}
        {streamEvents.map((event, i) => {
          switch (event.type) {
            case 'tool_start':
            case 'tool_end':
              return <ToolCard key={`ev-${i}`} event={event} />;
            case 'code_output':
              return (
                <CodeOutput key={`ev-${i}`} text={event.data.text} stream={event.data.stream} />
              );
            case 'agent_message':
              return (
                <div key={`ev-${i}`} className="flex gap-2.5 animate-fade-in">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20">
                    <Bot className="w-3.5 h-3.5 text-emerald-400" />
                  </div>
                  <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-surface-elevated text-gray-200 border border-surface-border">
                    {event.data.text}
                  </div>
                </div>
              );
            case 'agent_error':
              return (
                <div
                  key={`ev-${i}`}
                  className="flex items-center gap-2 px-3 py-2 bg-red-900/30 border border-red-800/50 rounded-lg text-sm text-red-400 mx-1"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="truncate">{event.data.error}</span>
                </div>
              );
            case 'state_change':
              return (
                <div key={`ev-${i}`} className="text-center text-xs text-gray-600 py-1">
                  Stage: {event.data.state}
                </div>
              );
            default:
              return null;
          }
        })}

        {/* Streaming text cursor */}
        {streamingText && (
          <div className="flex gap-2.5 animate-fade-in">
            <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-emerald-500/20">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="max-w-[85%] px-3.5 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed bg-surface-elevated text-gray-200 border border-surface-border">
              {streamingText}
              <span className="inline-block w-1.5 h-4 bg-primary-500 ml-0.5 animate-blink" />
            </div>
          </div>
        )}

        {/* Running indicator */}
        {isRunning && streamEvents.length === 0 && !streamingText && (
          <div
            className="flex items-center gap-2 text-sm text-gray-500 py-2"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
            <span>Agent is thinking...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="px-4 py-3 border-t border-surface-border bg-surface">
        <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2 py-1.5 focus-within:border-primary-500 transition-colors">
          <button
            type="button"
            aria-label="Attach file"
            className="p-2 rounded-full hover:bg-neutral-700 transition-colors text-gray-400 hover:text-gray-300 shrink-0"
            title="Attach file"
          >
            <Plus className="w-4 h-4" />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything"
            aria-label="Chat message"
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none py-1.5"
          />
          {isRunning && !input.trim() && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop agent"
              className="p-2 bg-red-600 hover:bg-red-700 rounded-full transition-colors shrink-0"
              title="Stop agent"
            >
              <Square className="w-4 h-4 text-white" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className="p-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-30 rounded-full transition-colors shrink-0"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
