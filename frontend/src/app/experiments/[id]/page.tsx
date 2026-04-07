'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { SSEEvent, FileTreeNode, Stage, MetricPoint, ChartConfig } from '@/lib/types';
import { connectSSE as connectSSEUtil, SSE_BASE } from '@/lib/sse';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowLeft,
  Bot,
  Send,
  Square,
  Loader2,
  Code2,
  CheckCircle2,
  Terminal,
  AlertCircle,
  FileText,
  X,
  PanelRightOpen,
  FolderOpen,
  Folder,
  Image,
  BarChart3,
  Database,
  Cpu,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Braces,
  Table,
  File as FileIcon,
  ArrowRight,
  Sparkles,
  Plus,
} from 'lucide-react';
import StageNav from '@/components/StageNav';
import MetricsTab from '@/components/MetricsTab';
import TrainConfigModal from '@/components/TrainConfigModal';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('json', json);
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatItem {
  id: string;
  type:
    | 'user'
    | 'assistant'
    | 'tool_start'
    | 'tool_end'
    | 'code_output'
    | 'error'
    | 'status'
    | 'stage_complete';
  content: string;
  meta?: any;
  timestamp: number;
}

const NEXT_STAGE: Record<string, { stage: Stage; label: string } | null> = {
  eda_done: { stage: 'prep', label: 'Data Prep' },
  prep_done: { stage: 'train', label: 'Training' },
  train_done: null, // pipeline complete
};

export default function ExperimentPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const experimentId = params.id as string;
  const initialSessionId = searchParams.get('session') || '';
  const autoStart = searchParams.get('autostart') !== 'false';

  const [experimentName, setExperimentName] = useState('');
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [sessionState, setSessionState] = useState('created');
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);

  // Train config modal
  const [showTrainConfig, setShowTrainConfig] = useState(false);
  const [pendingTrainInstructions, setPendingTrainInstructions] = useState<string | undefined>();

  // Canvas state — opens on demand
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasContent, setCanvasContent] = useState('');
  const [canvasTitle, setCanvasTitle] = useState('Report');
  const [generatedFiles, setGeneratedFiles] = useState<any[]>([]);
  const [fileTree, setFileTree] = useState<FileTreeNode>(() =>
    ensureStageFolders({
      name: 'workspace',
      path: '/',
      type: 'directory',
      children: [],
    }),
  );

  // Metrics state
  const [metricPoints, setMetricPoints] = useState<MetricPoint[]>([]);
  const [chartConfig, setChartConfig] = useState<ChartConfig | null>(null);
  const metricKeysRef = useRef(new Set<string>());

  const bottomRef = useRef<HTMLDivElement>(null);
  const sseRef = useRef<EventSource | null>(null);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatItems]);

  const addItem = useCallback((item: Omit<ChatItem, 'id' | 'timestamp'>) => {
    setChatItems((prev) => [
      ...prev,
      { ...item, id: `${Date.now()}-${Math.random()}`, timestamp: Date.now() },
    ]);
  }, []);

  const connectSSE = useCallback(
    (sid: string) => {
      if (sseRef.current) sseRef.current.close();

      const handleEvent = (event: SSEEvent) => {
        const data = event.data as any;

        switch (event.type) {
          case 'state_change':
            setSessionState(data.state);
            if (data.state.includes('running')) setIsRunning(true);
            if (
              data.state.includes('done') ||
              data.state === 'failed' ||
              data.state === 'cancelled'
            )
              setIsRunning(false);
            // Show stage transition card when a stage completes
            if (data.state.endsWith('_done')) {
              const stageName = data.state.replace('_done', '').toUpperCase();
              const next = NEXT_STAGE[data.state];
              addItem({
                type: 'stage_complete',
                content: stageName,
                meta: next ? { nextStage: next.stage, nextLabel: next.label } : null,
              });
            }
            break;
          case 'agent_message':
            addItem({ type: 'assistant', content: data.text });
            break;
          case 'agent_token':
            setChatItems((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.type === 'assistant' && Date.now() - last.timestamp < 5000) {
                return [...prev.slice(0, -1), { ...last, content: last.content + data.text }];
              }
              return [
                ...prev,
                {
                  id: `${Date.now()}`,
                  type: 'assistant',
                  content: data.text,
                  timestamp: Date.now(),
                },
              ];
            });
            break;
          case 'tool_start':
            addItem({ type: 'tool_start', content: data.tool, meta: data.input });
            break;
          case 'tool_end':
            // Update the last tool_start in-place instead of adding a separate item
            setChatItems((prev) => {
              const idx = prev.findLastIndex(
                (i) => i.type === 'tool_start' && i.content === data.tool,
              );
              if (idx >= 0) {
                const updated = [...prev];
                const duration = Math.max(
                  1,
                  Math.round((Date.now() - updated[idx].timestamp) / 1000),
                );
                updated[idx] = {
                  ...updated[idx],
                  type: 'tool_end',
                  meta: {
                    ...updated[idx].meta,
                    output: data.output,
                    outputs: updated[idx].meta?.outputs || [],
                    duration,
                  },
                };
                return updated;
              }
              // Fallback: add as new item if no matching tool_start found
              return [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'tool_end',
                  content: data.tool,
                  meta: { output: data.output },
                  timestamp: Date.now(),
                },
              ];
            });
            break;
          case 'code_output':
            // Append to the most recent tool_start card instead of a separate item
            setChatItems((prev) => {
              const idx = prev.findLastIndex((i) => i.type === 'tool_start');
              if (idx >= 0) {
                const updated = [...prev];
                const outputs = updated[idx].meta?.outputs || [];
                updated[idx] = {
                  ...updated[idx],
                  meta: {
                    ...updated[idx].meta,
                    outputs: [...outputs, { text: data.text, stream: data.stream }],
                  },
                };
                return updated;
              }
              // Fallback: show standalone if no tool_start found
              addItem({ type: 'code_output', content: data.text, meta: { stream: data.stream } });
              return prev;
            });
            break;
          case 'agent_error':
            addItem({ type: 'error', content: data.error });
            setIsRunning(false);
            break;
          case 'report_ready':
            // Agent wrote a report.md — open canvas with it
            setCanvasContent(data.content);
            setCanvasTitle(`${(data.stage || 'EDA').toUpperCase()} Report`);
            setCanvasOpen(true);
            break;
          case 'files_ready': {
            // Merge new stage files into existing files (don't replace — stages accumulate)
            const stage = (data.stage as string) || '';
            const newFiles = (data.files || []) as { path: string; type: string }[];
            setGeneratedFiles((prev) => {
              const existingPaths = new Set(prev.map((f: any) => f.path));
              const merged = [...prev];
              for (const f of newFiles) {
                if (!existingPaths.has(f.path)) merged.push(f);
              }
              return merged;
            });
            // Merge into existing tree
            setFileTree((prev) => {
              let merged = JSON.parse(JSON.stringify(prev)) as FileTreeNode;
              for (const f of newFiles) {
                merged = insertNodeIntoTree(
                  merged,
                  { name: f.path.split('/').pop() || '', path: f.path, type: 'file' },
                  `/sessions/${sid}`,
                  stage,
                );
              }
              return ensureStageFolders(merged);
            });
            break;
          }
          case 'file_created': {
            const stage = (data.stage as string) || '';
            setFileTree((prev) =>
              insertNodeIntoTree(
                prev,
                {
                  name: data.name as string,
                  path: data.path as string,
                  type: 'file',
                },
                `/sessions/${sid}`,
                stage,
              ),
            );
            break;
          }
          case 'agent_aborted':
            addItem({ type: 'status', content: 'Agent stopped' });
            setIsRunning(false);
            break;
          case 'metrics_batch': {
            const items = (data.items || []) as any[];
            const newPoints: MetricPoint[] = [];
            const now = new Date().toISOString();
            for (const m of items) {
              const key = `${m.step}:${m.name}:${m.run_tag || ''}`;
              if (!metricKeysRef.current.has(key)) {
                metricKeysRef.current.add(key);
                newPoints.push({
                  step: m.step,
                  name: m.name,
                  value: m.value,
                  stage: m.stage,
                  run_tag: m.run_tag || null,
                  created_at: now,
                });
              }
            }
            if (newPoints.length > 0) {
              setMetricPoints((prev) => {
                if (prev.length === 0) setCanvasOpen(true);
                return [...prev, ...newPoints];
              });
            }
            break;
          }
          case 'metric': {
            const key = `${data.step}:${data.name}:${data.run_tag || ''}`;
            if (!metricKeysRef.current.has(key)) {
              metricKeysRef.current.add(key);
              setMetricPoints((prev) => {
                if (prev.length === 0) setCanvasOpen(true);
                return [
                  ...prev,
                  {
                    step: data.step as number,
                    name: data.name as string,
                    value: data.value as number,
                    stage: data.stage as string,
                    run_tag: (data.run_tag as string) || null,
                    created_at: new Date().toISOString(),
                  },
                ];
              });
            }
            break;
          }
          case 'chart_config': {
            const cfg = data as any;
            if (cfg.charts && Array.isArray(cfg.charts)) {
              setChartConfig({ charts: cfg.charts });
            }
            break;
          }
        }
      };

      // Use the shared SSE utility — single source of truth for connection logic
      const disconnect = connectSSEUtil(sid, {
        onEvent: handleEvent,
        onOpen: () => setSseConnected(true),
        onError: () => setSseConnected(false),
      });
      // Store disconnect fn so we can close from handleStop / cleanup
      sseRef.current = { close: disconnect } as EventSource;
    },
    [addItem],
  );

  // Load experiment and auto-start
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const exp = await api.getExperiment(experimentId);
        if (cancelled) return;
        setExperimentName(exp.name);

        const sid = initialSessionId || exp.sessions?.[0]?.id;
        if (sid) {
          setSessionId(sid);
          const sessionData = await api.getSession(sid);
          if (cancelled) return;

          // Reconstruct chat from saved messages — build array then set once
          const restored: ChatItem[] = [];
          let restoredCanvasContent = '';
          let restoredCanvasTitle = 'Report';
          let restoredCanvasOpen = false;
          let restoredFiles: any[] = [];

          if (sessionData.messages?.length > 0) {
            for (const msg of sessionData.messages) {
              const eventType = msg.metadata?.event_type;
              const mkItem = (item: Omit<ChatItem, 'id' | 'timestamp'>): ChatItem => ({
                ...item,
                id: `${msg.id || Date.now()}-${Math.random()}`,
                timestamp: Date.now(),
              });

              if (eventType === 'tool_start') {
                // On restore, skip tool_start — tool_end will represent the completed card
                // Keep it as a pending marker only so tool_end can merge into it
                restored.push(
                  mkItem({
                    type: 'tool_start',
                    content: (msg.metadata?.tool as string) || 'execute_code',
                    meta: msg.metadata?.input as Record<string, unknown>,
                  }),
                );
              } else if (eventType === 'tool_end') {
                // Merge into the most recent tool_start (any name — on restore they're always paired sequentially)
                const idx = restored.findLastIndex((i) => i.type === 'tool_start');
                if (idx >= 0) {
                  restored[idx] = {
                    ...restored[idx],
                    type: 'tool_end',
                    meta: {
                      ...restored[idx].meta,
                      output: msg.metadata?.output,
                      duration: msg.metadata?.duration || null,
                    },
                  };
                } else {
                  restored.push(
                    mkItem({
                      type: 'tool_end',
                      content: (msg.metadata?.tool as string) || 'execute_code',
                      meta: { output: msg.metadata?.output as string },
                    }),
                  );
                }
              } else if (eventType === 'code_output') {
                // Fold into the most recent tool card
                const idx = restored.findLastIndex(
                  (i) => i.type === 'tool_start' || i.type === 'tool_end',
                );
                if (idx >= 0) {
                  const outputs = restored[idx].meta?.outputs || [];
                  restored[idx] = {
                    ...restored[idx],
                    meta: {
                      ...restored[idx].meta,
                      outputs: [
                        ...outputs,
                        { text: msg.content || msg.metadata?.text, stream: msg.metadata?.stream },
                      ],
                    },
                  };
                }
              } else if (eventType === 'agent_message') {
                restored.push(mkItem({ type: 'assistant', content: msg.content }));
              } else if (eventType === 'report_ready') {
                restoredCanvasContent += msg.content + '\n';
                restoredCanvasTitle = `${((msg.metadata?.stage as string) || 'EDA').toUpperCase()} Report`;
                restoredCanvasOpen = true;
              } else if (eventType === 'files_ready') {
                const stageHint = (msg.metadata?.stage as string) || '';
                const newFiles = (msg.metadata?.files || []) as Array<{
                  path: string;
                  _stage?: string;
                }>;
                const existingPaths = new Set(restoredFiles.map((f: { path: string }) => f.path));
                for (const f of newFiles) {
                  if (!existingPaths.has(f.path)) {
                    restoredFiles.push({ ...f, _stage: stageHint });
                  }
                }
              } else if (eventType === 'state_change') {
                // Show stage transition cards for completed stages
                const st = msg.metadata?.state as string;
                if (st?.endsWith('_done')) {
                  const stageName = st.replace('_done', '').toUpperCase();
                  const next = NEXT_STAGE[st];
                  restored.push(
                    mkItem({
                      type: 'stage_complete',
                      content: stageName,
                      meta: next ? { nextStage: next.stage, nextLabel: next.label } : null,
                    }),
                  );
                }
              } else if (eventType === 'agent_error') {
                restored.push(
                  mkItem({
                    type: 'error',
                    content: (msg.metadata?.error as string) || msg.content,
                  }),
                );
              } else if (msg.role === 'user') {
                restored.push(mkItem({ type: 'user', content: msg.content }));
              } else if (msg.role === 'assistant') {
                restored.push(mkItem({ type: 'assistant', content: msg.content }));
              }
            }
          }

          if (cancelled) return;

          // Clean up: convert any orphaned tool_start (no matching tool_end) to tool_end
          for (let i = 0; i < restored.length; i++) {
            if (restored[i].type === 'tool_start') {
              restored[i] = { ...restored[i], type: 'tool_end' };
            }
          }

          // Set all state at once (replaces, not appends)
          setChatItems(restored);
          setCanvasContent(restoredCanvasContent);
          setCanvasTitle(restoredCanvasTitle);
          setCanvasOpen(restoredCanvasOpen);
          setGeneratedFiles(restoredFiles);

          // Build file tree from restored files, and also try fetching from backend
          if (restoredFiles.length > 0) {
            setFileTree(buildTreeFromFlatList(restoredFiles, `/sessions/${sid}`));
          }
          // Fetch live tree from volume (may have more files than what was in messages)
          api
            .getFileTree(sid)
            .then((tree) => {
              if (!cancelled) setFileTree(ensureStageFolders(unwrapTree(tree)));
            })
            .catch(() => {});

          // Load historical metrics
          api
            .getMetrics(sid)
            .then((metrics) => {
              if (!cancelled && metrics.length > 0) {
                setMetricPoints(metrics);
                setCanvasOpen(true);
                for (const m of metrics) {
                  metricKeysRef.current.add(`${m.step}:${m.name}:${m.run_tag || ''}`);
                }
              }
            })
            .catch(() => {});

          // Set running state from session
          if (sessionData.state) setSessionState(sessionData.state);
          if (sessionData.state?.includes('running')) {
            setIsRunning(true);
          }

          connectSSE(sid);

          if (sessionData.state === 'created' && autoStart && !hasAutoStarted.current) {
            hasAutoStarted.current = true;
            const prompt = exp.instructions
              ? `Analyze this dataset. ${exp.instructions}`
              : 'Analyze this dataset — perform a full EDA.';
            setChatItems((prev) => [
              ...prev,
              {
                id: `${Date.now()}-${Math.random()}`,
                type: 'user',
                content: prompt,
                timestamp: Date.now(),
              },
            ]);
            // Also save the initial prompt to DB
            api.sendMessage(sid, prompt).catch(() => {});

            setTimeout(async () => {
              if (cancelled) return;
              try {
                await api.startStage(sid, 'eda');
              } catch (e: any) {
                addItem({ type: 'error', content: `Failed to start: ${e.message}` });
              }
            }, 1000);
          }
        }
      } catch (e) {
        if (!cancelled) addItem({ type: 'error', content: 'Failed to load experiment' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      sseRef.current?.close();
    };
  }, [experimentId, initialSessionId]);

  const handleStop = async () => {
    if (!sessionId) return;
    try {
      await api.abortSession(sessionId);
    } catch (e: any) {
      addItem({ type: 'error', content: `Failed to stop: ${e.message}` });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !sessionId) return;
    const text = input.trim();
    setInput('');

    addItem({ type: 'user', content: text });
    setIsRunning(true); // Optimistic — show thinking indicator immediately

    try {
      // run_agent=true: backend silently aborts any running agent, then starts a new turn
      await api.sendMessage(sessionId, text, true);
    } catch (e: any) {
      addItem({ type: 'error', content: e.message });
      setIsRunning(false);
    }
  };

  const handleStartStage = useCallback(
    async (stage: Stage, extraInstructions?: string) => {
      if (!sessionId) return;

      // Intercept train stage — show config modal before starting
      if (stage === 'train') {
        setPendingTrainInstructions(extraInstructions);
        setShowTrainConfig(true);
        return;
      }

      try {
        await api.startStage(sessionId, stage, undefined, extraInstructions);
      } catch (e: any) {
        addItem({ type: 'error', content: `Failed to start ${stage}: ${e.message}` });
      }
    },
    [sessionId, addItem],
  );

  const handleTrainConfigConfirm = useCallback(
    async (config: { gpu?: string; instructions?: string }) => {
      setShowTrainConfig(false);
      if (!sessionId) return;
      try {
        let instructions = config.instructions || pendingTrainInstructions || undefined;
        if (pendingTrainInstructions && config.instructions) {
          instructions = `${pendingTrainInstructions}\n${config.instructions}`;
        }
        await api.startStage(sessionId, 'train', config.gpu, instructions);
      } catch (e: any) {
        addItem({ type: 'error', content: `Failed to start train: ${e.message}` });
      }
    },
    [sessionId, pendingTrainInstructions, addItem],
  );

  // Listen for stage-start events from StageCompleteCard (which renders outside component scope)
  useEffect(() => {
    const handler = (e: Event) => {
      const { stage, instructions } = (e as CustomEvent).detail;
      handleStartStage(stage, instructions);
    };
    window.addEventListener('trainable:start-stage', handler);
    return () => window.removeEventListener('trainable:start-stage', handler);
  }, [handleStartStage]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-black">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-border shrink-0 bg-surface">
        <button
          onClick={() => (window.location.href = '/')}
          className="p-1.5 hover:bg-surface-hover rounded-lg"
        >
          <ArrowLeft className="w-4 h-4 text-gray-400" />
        </button>
        <a href="/" className="shrink-0">
          <img src="/logo-brain.png" alt="Trainable" className="h-6 w-auto" />
        </a>
        <div className="w-px h-5 bg-surface-border" />
        <h1 className="text-sm font-semibold text-white truncate">{experimentName}</h1>
        <div className="flex-1" />
        <StageNav
          state={sessionState}
          onStartStage={handleStartStage}
          onStop={handleStop}
          isRunning={isRunning}
        />
        <button
          onClick={() => {
            setCanvasOpen(true);
            // Dispatch event to open metrics tab in sidebar
            window.dispatchEvent(new CustomEvent('trainable:open-metrics-tab'));
          }}
          className={`p-1.5 rounded-lg transition-colors relative ${
            metricPoints.length > 0
              ? 'hover:bg-emerald-600/20 text-emerald-400'
              : 'hover:bg-surface-hover text-gray-400'
          }`}
          title="Metrics"
        >
          <BarChart3 className="w-4 h-4" />
          {metricPoints.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400" />
          )}
        </button>
        <button
          onClick={() => setCanvasOpen((prev) => !prev)}
          className={`p-1.5 rounded-lg transition-colors ${canvasOpen ? 'bg-primary-600/20 text-primary-400' : 'hover:bg-surface-hover text-gray-400'}`}
          title="Toggle workspace"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>
        <div className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-green-500' : 'bg-red-500'}`} />
      </header>

      {/* Main area — chat + canvas side by side */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* Chat panel */}
        <Panel defaultSize={canvasOpen ? 25 : 100} minSize={15}>
          <div className="h-full flex flex-col min-w-0">
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className={`mx-auto w-full space-y-4 ${canvasOpen ? 'max-w-3xl' : 'max-w-5xl'}`}>
                {chatItems.map((item) => renderChatItem(item))}

                {isRunning &&
                  chatItems.length > 0 &&
                  chatItems[chatItems.length - 1]?.type === 'status' && (
                    <div className="flex gap-3 animate-fade-in">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center shrink-0">
                        <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin text-primary-500" />
                        Thinking...
                      </div>
                    </div>
                  )}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-surface-border bg-surface px-4 py-3">
              <div className={`mx-auto ${canvasOpen ? 'max-w-3xl' : 'max-w-5xl'}`}>
                <div className="flex items-center gap-1 bg-surface-elevated border border-surface-border rounded-full px-2 py-1.5 focus-within:border-primary-500 transition-colors">
                  <button
                    type="button"
                    className="p-2 rounded-full hover:bg-neutral-700 transition-colors text-gray-400 hover:text-gray-300 shrink-0"
                    title="Attach file"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) =>
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      (isRunning && !input.trim() ? handleStop() : handleSend())
                    }
                    placeholder="Ask anything"
                    className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none py-1.5"
                  />
                  {isRunning && !input.trim() ? (
                    <button
                      onClick={handleStop}
                      className="p-2 bg-red-600 hover:bg-red-700 rounded-full transition-colors shrink-0"
                      title="Stop agent"
                    >
                      <Square className="w-4 h-4 text-white" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={!input.trim()}
                      className="p-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-30 rounded-full transition-colors shrink-0"
                    >
                      <Send className="w-4 h-4 text-white" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Panel>

        {/* Resize handle + Workspace sidebar */}
        {canvasOpen && (
          <>
            <PanelResizeHandle className="w-1.5 bg-surface-border hover:bg-primary-500/50 active:bg-primary-500/70 transition-colors relative group flex items-center justify-center">
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <GripVertical className="w-3 h-3 text-gray-400" />
              </div>
            </PanelResizeHandle>
            <Panel defaultSize={75} minSize={30}>
              <WorkspaceSidebar
                experimentId={experimentId}
                sessionId={sessionId}
                canvasContent={canvasContent}
                canvasTitle={canvasTitle}
                generatedFiles={generatedFiles}
                fileTree={fileTree}
                metricPoints={metricPoints}
                chartConfig={chartConfig}
                sessionState={sessionState}
                onClose={() => setCanvasOpen(false)}
              />
            </Panel>
          </>
        )}
      </PanelGroup>

      {showTrainConfig && (
        <TrainConfigModal
          onConfirm={handleTrainConfigConfirm}
          onClose={() => setShowTrainConfig(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File tree helpers
// ---------------------------------------------------------------------------

/**
 * Strip infrastructure prefixes from a path to get a clean relative path
 * starting from the stage dir (eda/, prep/, train/).
 *
 * Handles all formats Modal may return:
 *   /sessions/{uuid}/eda/scripts/x.py  →  eda/scripts/x.py
 *   sessions/{uuid}/eda/figures/c.png  →  eda/figures/c.png
 *   eda/figures/chart.png              →  eda/figures/chart.png  (already clean)
 *   figures/chart.png                  →  figures/chart.png      (relative to stage)
 *   report.md                          →  report.md              (file at stage root)
 */
function stripSessionPrefix(path: string, rootPath: string): string {
  // Normalize leading slashes
  let rel = path.replace(/^\/+/, '');
  const rootNorm = rootPath.replace(/^\/+/, '').replace(/\/$/, '');

  // Strip rootPath prefix (e.g. sessions/{uuid})
  if (rel.startsWith(rootNorm + '/')) {
    rel = rel.slice(rootNorm.length + 1);
  }
  // Strip any remaining sessions/{uuid}/ prefix (may appear multiple times)
  while (/^sessions\/[^/]+\//.test(rel)) {
    rel = rel.replace(/^sessions\/[^/]+\//, '');
  }
  // Strip bare UUID-looking directory prefixes (e.g. {uuid}/eda/...)
  while (/^[0-9a-f]{8}-[0-9a-f]{4}-[^/]*\//.test(rel)) {
    rel = rel.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[^/]*\//, '');
  }
  return rel;
}

/**
 * Ensure a file path is prefixed with the stage dir (eda/, prep/, train/).
 * After stripping session prefixes, if the path doesn't start with a stage name,
 * prepend the stage so it goes into the right folder.
 */
function ensureStagePath(rawPath: string, stage: string, rootPath: string): string {
  const stages = ['eda', 'prep', 'train'];
  const clean = stripSessionPrefix(rawPath, rootPath);
  const firstSeg = clean.split('/')[0];
  // Already starts with a stage dir — good
  if (stages.includes(firstSeg)) return clean;
  // Doesn't start with a stage — prepend it
  if (stage) return `${stage}/${clean}`;
  return clean;
}

function buildTreeFromFlatList(
  files: { path: string; type: string; _stage?: string }[],
  rootPath: string,
): FileTreeNode {
  const root: FileTreeNode = { name: 'workspace', path: rootPath, type: 'directory', children: [] };

  for (const file of files) {
    const rel = ensureStagePath(file.path, file._stage || '', rootPath);
    if (!rel) continue;

    const segments = rel.split('/');
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast && file.type === 'file') {
        if (!current.children!.find((c) => c.name === segment && c.type === 'file')) {
          current.children!.push({ name: segment, path: file.path, type: 'file' });
        }
      } else {
        let child = current.children!.find((c) => c.name === segment && c.type === 'directory');
        if (!child) {
          child = {
            name: segment,
            path: segments.slice(0, i + 1).join('/'),
            type: 'directory',
            children: [],
          };
          current.children!.push(child);
        }
        current = child;
      }
    }
  }

  sortTree(root);
  return ensureStageFolders(unwrapTree(root));
}

function insertNodeIntoTree(
  tree: FileTreeNode,
  node: FileTreeNode,
  rootPath: string,
  stage: string = '',
): FileTreeNode {
  const cloned = JSON.parse(JSON.stringify(tree)) as FileTreeNode;
  const rel = ensureStagePath(node.path, stage, rootPath);
  if (!rel) return cloned;

  const segments = rel.split('/');
  let current = cloned;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const isLast = i === segments.length - 1;

    if (!current.children) current.children = [];

    if (isLast) {
      if (!current.children.find((c) => c.name === segment && c.type === node.type)) {
        current.children.push({ name: segment, path: node.path, type: node.type });
      }
    } else {
      let child = current.children.find((c) => c.name === segment && c.type === 'directory');
      if (!child) {
        child = {
          name: segment,
          path: segments.slice(0, i + 1).join('/'),
          type: 'directory',
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    }
  }

  sortTree(cloned);
  return cloned;
}

function sortTree(node: FileTreeNode) {
  if (!node.children) return;
  for (const child of node.children) sortTree(child);
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** Strip infrastructure directories (sessions, UUIDs) from the tree root.
 *  sessions > {uuid} > eda  →  shows eda at top level.
 *  Never unwraps stage dirs (eda, prep, train) even if they're the only child. */
function unwrapTree(tree: FileTreeNode): FileTreeNode {
  const isInfraName = (name: string) =>
    name === 'sessions' || /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(name);

  while (
    tree.children &&
    tree.children.length === 1 &&
    tree.children[0].type === 'directory' &&
    isInfraName(tree.children[0].name)
  ) {
    const only = tree.children[0];
    tree = { ...tree, children: only.children || [] };
  }
  return tree;
}

function countFiles(node: FileTreeNode): number {
  if (node.type === 'file') return 1;
  return (node.children || []).reduce((sum, c) => sum + countFiles(c), 0);
}

/** Ensure the tree always has eda, prep, train as top-level folders. */
function ensureStageFolders(tree: FileTreeNode): FileTreeNode {
  if (!tree.children) tree.children = [];
  for (const stage of ['eda', 'prep', 'train']) {
    if (!tree.children.find((c) => c.name === stage && c.type === 'directory')) {
      tree.children.push({
        name: stage,
        path: `__stage__/${stage}`,
        type: 'directory',
        children: [],
      });
    }
  }
  // Sort so stages appear in order: eda, prep, train (then anything else)
  const stageOrder: Record<string, number> = { eda: 0, prep: 1, train: 2 };
  tree.children.sort((a, b) => {
    const oa = stageOrder[a.name] ?? 99;
    const ob = stageOrder[b.name] ?? 99;
    if (oa !== ob) return oa - ob;
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return tree;
}

/** Build a breadcrumb from a file path, stripping infrastructure prefixes. */
function fileBreadcrumb(filePath: string): string[] {
  return stripSessionPrefix(filePath, '').split('/');
}

function getBackendUrl() {
  return SSE_BASE;
}

function getFileIconInfo(name: string): { icon: typeof FileText; color: string } {
  if (name.endsWith('.py')) return { icon: Code2, color: 'text-yellow-400' };
  if (name.endsWith('.md')) return { icon: FileText, color: 'text-blue-400' };
  if (/\.(png|jpg|jpeg|svg|gif)$/i.test(name)) return { icon: Image, color: 'text-purple-400' };
  if (name.endsWith('.csv')) return { icon: Table, color: 'text-green-400' };
  if (name.endsWith('.parquet')) return { icon: Database, color: 'text-amber-400' };
  if (name.endsWith('.json')) return { icon: Braces, color: 'text-orange-400' };
  if (name.endsWith('.pkl') || name.endsWith('.joblib'))
    return { icon: Cpu, color: 'text-red-400' };
  return { icon: FileIcon, color: 'text-gray-400' };
}

const DIR_LABELS: Record<string, string> = {
  eda: 'eda',
  prep: 'prep',
  train: 'train',
};

const DIR_COLORS: Record<string, string> = {
  eda: 'text-blue-400',
  prep: 'text-amber-400',
  train: 'text-green-400',
};

// ---------------------------------------------------------------------------
// FileTreeRow — recursive, github.dev style
// ---------------------------------------------------------------------------

function FileTreeRow({
  node,
  depth,
  expandedDirs,
  toggleDir,
  selectedFile,
  onSelectFile,
}: {
  node: FileTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isSelected = !isDir && selectedFile === node.path;
  const pl = 12 + depth * 16;

  if (isDir) {
    const color = DIR_COLORS[node.name] || 'text-gray-400';
    return (
      <>
        <button
          onClick={() => toggleDir(node.path)}
          className="w-full flex items-center gap-1.5 h-[26px] text-[13px] transition-colors hover:bg-white/[0.04] text-gray-300 group"
          style={{ paddingLeft: `${pl}px`, paddingRight: '10px' }}
        >
          <ChevronRight
            className={`w-3 h-3 shrink-0 text-gray-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
          />
          {isExpanded ? (
            <FolderOpen className={`w-4 h-4 shrink-0 ${color}`} />
          ) : (
            <Folder className={`w-4 h-4 shrink-0 ${color}`} />
          )}
          <span className="flex-1 text-left truncate">{DIR_LABELS[node.name] || node.name}</span>
        </button>
        {isExpanded &&
          node.children &&
          node.children.map((child) => (
            <FileTreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
            />
          ))}
      </>
    );
  }

  const { icon: FIcon, color } = getFileIconInfo(node.name);
  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={`w-full flex items-center gap-1.5 h-[26px] text-[13px] transition-colors ${
        isSelected
          ? 'bg-primary-500/10 text-primary-300'
          : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
      }`}
      style={{ paddingLeft: `${pl + 15}px`, paddingRight: '10px' }}
    >
      <FIcon className={`w-4 h-4 shrink-0 ${color}`} />
      <span className="flex-1 text-left truncate">{node.name}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FileViewer — displays file content based on type
// ---------------------------------------------------------------------------

function FileViewer({ filePath, sessionId }: { filePath: string; sessionId: string }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileName = filePath.split('/').pop() || '';
  const isImage = /\.(png|jpg|jpeg|svg|gif)$/i.test(fileName);
  const isPython = fileName.endsWith('.py');
  const isMarkdown = fileName.endsWith('.md');
  const isJSON = fileName.endsWith('.json');
  const isBinary = /\.(pkl|joblib|parquet|h5|hdf5|pt|pth|onnx)$/i.test(fileName);

  useEffect(() => {
    if (isImage || isBinary) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .readFile(filePath)
      .then((res) => {
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [filePath]);

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
          </div>
        ) : error ? (
          <div className="p-4 text-sm text-red-400">{error}</div>
        ) : isImage ? (
          <div className="p-6 flex items-center justify-center bg-[#0d1117]">
            <img
              src={`${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(filePath)}`}
              alt={fileName}
              className="max-w-full max-h-[60vh] rounded-lg"
            />
          </div>
        ) : isBinary ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-500">
            <Cpu className="w-8 h-8 mb-2" />
            <p className="text-sm">Binary file</p>
            <p className="text-xs text-gray-600 mt-1">{fileName}</p>
          </div>
        ) : isPython || isJSON ? (
          <SyntaxHighlighter
            language={isPython ? 'python' : 'json'}
            style={oneDark}
            customStyle={{
              margin: 0,
              padding: '16px',
              background: '#0d1117',
              fontSize: '13px',
              lineHeight: '1.6',
            }}
            showLineNumbers
            lineNumberStyle={{
              color: '#3b4048',
              fontSize: '12px',
              paddingRight: '16px',
              minWidth: '2.5em',
            }}
          >
            {content || ''}
          </SyntaxHighlighter>
        ) : isMarkdown ? (
          <div className="p-6 markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                img: ({ src, alt }) => {
                  let imgSrc = src || '';
                  if (imgSrc.startsWith('/data/')) {
                    imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(imgSrc)}`;
                  } else if (imgSrc && !imgSrc.startsWith('http')) {
                    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                    imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(dir + '/' + imgSrc)}`;
                  }
                  return (
                    <img
                      src={imgSrc}
                      alt={alt || ''}
                      className="max-w-full rounded-lg shadow-md my-4"
                    />
                  );
                },
              }}
            >
              {content || ''}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="p-4 text-[13px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
            {content || ''}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace Panel — github.dev-style: tree sidebar + tabbed editor
// ---------------------------------------------------------------------------

/** Represents an open tab — a file, the report, or the metrics panel */
interface OpenTab {
  id: string; // file path, '__report__', or '__metrics__'
  label: string; // display name
  icon: typeof FileText;
  iconColor: string;
  type: 'file' | 'report' | 'metrics';
}

const REPORT_TAB_ID = '__report__';
const METRICS_TAB_ID = '__metrics__';

function WorkspaceSidebar({
  experimentId,
  sessionId,
  canvasContent,
  canvasTitle,
  generatedFiles,
  fileTree,
  metricPoints,
  chartConfig,
  sessionState,
  onClose,
}: {
  experimentId: string;
  sessionId: string;
  canvasContent: string;
  canvasTitle: string;
  generatedFiles: any[];
  fileTree: FileTreeNode;
  metricPoints: MetricPoint[];
  chartConfig: ChartConfig | null;
  sessionState: string;
  onClose: () => void;
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Listen for "open metrics tab" event from header button
  useEffect(() => {
    const handler = () => {
      setOpenTabs((prev) => {
        if (prev.find((t) => t.id === METRICS_TAB_ID)) return prev;
        return [
          ...prev,
          {
            id: METRICS_TAB_ID,
            label: 'Metrics',
            icon: BarChart3,
            iconColor: 'text-emerald-400',
            type: 'metrics',
          },
        ];
      });
      setActiveTabId(METRICS_TAB_ID);
    };
    window.addEventListener('trainable:open-metrics-tab', handler);
    return () => window.removeEventListener('trainable:open-metrics-tab', handler);
  }, []);

  // Auto-expand directories when tree updates
  useEffect(() => {
    if (fileTree?.children) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        for (const child of fileTree.children || []) {
          if (child.type === 'directory') {
            next.add(child.path);
            for (const sub of child.children || []) {
              if (sub.type === 'directory') next.add(sub.path);
            }
          }
        }
        return next;
      });
    }
  }, [fileTree]);

  // Auto-open report tab when report arrives
  useEffect(() => {
    if (canvasContent) {
      setOpenTabs((prev) => {
        if (prev.find((t) => t.id === REPORT_TAB_ID)) {
          return prev; // already open
        }
        return [
          ...prev,
          {
            id: REPORT_TAB_ID,
            label: canvasTitle || 'Report',
            icon: FileText,
            iconColor: 'text-blue-400',
            type: 'report',
          },
        ];
      });
      // If no tab is active, activate the report
      setActiveTabId((prev) => prev || REPORT_TAB_ID);
    }
  }, [canvasContent, canvasTitle]);

  // Auto-open metrics tab when first metric arrives
  const hasMetrics = metricPoints.length > 0;
  useEffect(() => {
    if (hasMetrics) {
      setOpenTabs((prev) => {
        if (prev.find((t) => t.id === METRICS_TAB_ID)) return prev;
        return [
          ...prev,
          {
            id: METRICS_TAB_ID,
            label: 'Metrics',
            icon: BarChart3,
            iconColor: 'text-emerald-400',
            type: 'metrics',
          },
        ];
      });
      setActiveTabId((prev) => prev || METRICS_TAB_ID);
    }
  }, [hasMetrics]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const openFile = useCallback((filePath: string) => {
    const name = filePath.split('/').pop() || '';
    const { icon, color } = getFileIconInfo(name);
    setActiveTabId(filePath);
    setOpenTabs((prev) => {
      if (prev.find((t) => t.id === filePath)) return prev;
      return [...prev, { id: filePath, label: name, icon, iconColor: color, type: 'file' }];
    });
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      // Activate neighbor: try right, then left, then null
      setActiveTabId((currentId) => {
        if (currentId !== tabId) return currentId;
        if (next.length === 0) return null;
        const neighborIdx = Math.min(idx, next.length - 1);
        return next[neighborIdx].id;
      });
      return next;
    });
  }, []);

  const totalFiles = countFiles(fileTree);
  const hasTree = fileTree.children && fileTree.children.length > 0;
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const breadcrumb = activeTab?.type === 'file' ? fileBreadcrumb(activeTab.id) : [];

  return (
    <div className="h-full border-l border-surface-border flex flex-row bg-[#0d1117]">
      {/* Left: file tree sidebar */}
      <div className="w-[220px] shrink-0 flex flex-col border-r border-white/[0.06] bg-surface">
        {/* Tree header */}
        <div className="flex items-center justify-between px-3 h-9 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
            Explorer
            {totalFiles > 0 && (
              <span className="px-1 py-0.5 rounded bg-white/[0.06] text-[10px] text-gray-500 normal-case tracking-normal font-normal">
                {totalFiles}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => {
                setOpenTabs((prev) => {
                  if (prev.find((t) => t.id === METRICS_TAB_ID)) return prev;
                  return [
                    ...prev,
                    {
                      id: METRICS_TAB_ID,
                      label: 'Metrics',
                      icon: BarChart3,
                      iconColor: 'text-emerald-400',
                      type: 'metrics',
                    },
                  ];
                });
                setActiveTabId(METRICS_TAB_ID);
              }}
              className="p-1 hover:bg-white/[0.06] rounded transition-colors"
              title="Open Metrics"
            >
              <BarChart3 className="w-3 h-3 text-gray-600" />
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:bg-white/[0.06] rounded transition-colors"
            >
              <X className="w-3 h-3 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto">
          {hasTree ? (
            <div className="py-1">
              {fileTree.children!.map((node) => (
                <FileTreeRow
                  key={node.path}
                  node={node}
                  depth={0}
                  expandedDirs={expandedDirs}
                  toggleDir={toggleDir}
                  selectedFile={activeTab?.type === 'file' ? activeTab.id : null}
                  onSelectFile={openFile}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600 px-4">
              <FolderOpen className="w-7 h-7 mb-2 text-gray-700" />
              <p className="text-[11px] text-center">Files will appear here as the agent runs</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: tabbed editor area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Tab strip */}
        {openTabs.length > 0 && (
          <div className="flex items-end h-[35px] bg-surface border-b border-white/[0.06] shrink-0 overflow-x-auto">
            {openTabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`flex items-center gap-1.5 px-3 h-[34px] text-xs border-r border-white/[0.04] shrink-0 transition-colors ${
                    isActive
                      ? 'bg-[#0d1117] text-gray-200 border-t-2 border-t-primary-500'
                      : 'bg-surface text-gray-500 hover:text-gray-300 border-t-2 border-t-transparent'
                  }`}
                >
                  <TabIcon className={`w-3.5 h-3.5 shrink-0 ${tab.iconColor}`} />
                  <span className="truncate max-w-[120px]">{tab.label}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-1 p-0.5 rounded hover:bg-white/[0.1] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Breadcrumb (for file tabs) */}
        {activeTab?.type === 'file' && breadcrumb.length > 0 && (
          <div className="flex items-center gap-1 px-3 h-6 bg-[#0d1117] border-b border-white/[0.04] shrink-0">
            {breadcrumb.map((seg, i) => (
              <span key={i} className="flex items-center gap-1 text-[11px]">
                {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-gray-700" />}
                <span className={i === breadcrumb.length - 1 ? 'text-gray-400' : 'text-gray-600'}>
                  {seg}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {activeTab?.type === 'file' ? (
            <FileViewer filePath={activeTab.id} sessionId={sessionId} />
          ) : activeTab?.type === 'report' && canvasContent ? (
            <div className="h-full overflow-y-auto p-6 bg-[#0d1117]">
              <div className="markdown-content">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }) => {
                      let imgSrc = src || '';
                      if (imgSrc.startsWith('/data/')) {
                        imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(imgSrc)}`;
                      } else if (imgSrc && !imgSrc.startsWith('http')) {
                        const workspace = `/sessions/${sessionId}/eda`;
                        imgSrc = `${getBackendUrl()}/api/files/raw?path=${encodeURIComponent(workspace + '/' + imgSrc)}`;
                      }
                      return (
                        <img
                          src={imgSrc}
                          alt={alt || ''}
                          className="max-w-full rounded-lg shadow-md my-4"
                        />
                      );
                    },
                  }}
                >
                  {canvasContent}
                </ReactMarkdown>
              </div>
            </div>
          ) : activeTab?.type === 'metrics' ? (
            <div className="h-full overflow-hidden bg-[#0d1117]">
              <MetricsTab
                metricPoints={metricPoints}
                chartConfig={chartConfig}
                state={sessionState}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 bg-[#0d1117]">
              <Code2 className="w-8 h-8 mb-2 text-gray-700" />
              <p className="text-xs">Select a file to view</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
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

function CollapsibleToolCard({ item }: { item: ChatItem }) {
  const isStart = item.type === 'tool_start';
  const [collapsed, setCollapsed] = useState(true);
  const funVerb = useFunVerb(isStart);
  const [doneLabel] = useState(() => PAST_VERBS[Math.floor(Math.random() * PAST_VERBS.length)]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isStart) return;
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - item.timestamp) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [isStart, item.timestamp]);

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-amber-500/20">
        <Code2 className="w-3.5 h-3.5 text-amber-400" />
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-surface-elevated border border-surface-border overflow-hidden">
        <div
          className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none"
          onClick={() => setCollapsed((prev) => !prev)}
        >
          {isStart ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
          )}
          <span className="text-sm text-gray-300 flex-1">
            {isStart
              ? `${funVerb}...${elapsed > 0 ? ` ${elapsed}s` : ''}`
              : `${doneLabel} for ${item.meta?.duration || 1}s`}
          </span>
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-500 transition-transform duration-150 ${
              !collapsed ? 'rotate-90' : ''
            }`}
          />
        </div>
        {!collapsed && (
          <>
            {item.meta?.code && (
              <pre className="px-4 py-2 text-xs text-gray-400 font-mono max-h-24 overflow-y-auto border-t border-surface-border whitespace-pre-wrap">
                {item.meta.code.length > 300
                  ? item.meta.code.slice(0, 300) + '...'
                  : item.meta.code}
              </pre>
            )}
            {item.meta?.outputs?.length > 0 && (
              <div className="px-4 py-2 border-t border-surface-border max-h-32 overflow-y-auto">
                {item.meta.outputs.map((o: { text: string; stream: string }, i: number) => (
                  <pre
                    key={i}
                    className={`text-xs font-mono whitespace-pre-wrap break-all ${
                      o.stream === 'stderr' ? 'text-red-400/70' : 'text-gray-500'
                    }`}
                  >
                    {o.text}
                  </pre>
                ))}
              </div>
            )}
            {item.meta?.output && (
              <pre className="px-4 py-2 text-xs text-green-400/80 font-mono max-h-32 overflow-y-auto border-t border-surface-border whitespace-pre-wrap">
                {item.meta.output.length > 500
                  ? item.meta.output.slice(0, 500) + '...'
                  : item.meta.output}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function renderChatItem(item: ChatItem) {
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

function StageCompleteCard({ item }: { item: ChatItem }) {
  const [extraInstructions, setExtraInstructions] = useState('');
  const [started, setStarted] = useState(false);
  const next = item.meta;

  const handleContinue = async () => {
    if (!next?.nextStage || started) return;
    setStarted(true);
    // Access api.startStage via the module — the card is rendered inside ExperimentPage
    // which has handleStartStage in scope, but renderChatItem is outside.
    // We'll use a custom event to communicate back.
    window.dispatchEvent(
      new CustomEvent('trainable:start-stage', {
        detail: { stage: next.nextStage, instructions: extraInstructions || undefined },
      }),
    );
  };

  return (
    <div className="animate-fade-in">
      <div className="border border-green-500/30 bg-green-500/5 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <span className="text-sm font-medium text-green-300">{item.content} Complete</span>
        </div>

        {next ? (
          <>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={extraInstructions}
                onChange={(e) => setExtraInstructions(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                placeholder={`Optional instructions for ${next.nextLabel}...`}
                disabled={started}
                className="flex-1 px-3 py-2 bg-surface-elevated border border-surface-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-primary-500 disabled:opacity-50"
              />
            </div>
            <button
              onClick={handleContinue}
              disabled={started}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {started ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}
              Continue to {next.nextLabel}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-sm text-green-300">
            <Sparkles className="w-4 h-4" />
            Pipeline complete! Review your results in the workspace.
          </div>
        )}
      </div>
    </div>
  );
}
