'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import {
  SSEEvent,
  FileTreeNode,
  Stage,
  MetricPoint,
  ChartConfig,
  GeneratedFile,
} from '@/lib/types';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  ArrowLeft,
  Bot,
  Send,
  Square,
  Loader2,
  PanelRightOpen,
  BarChart3,
  GripVertical,
  Plus,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import StageNav from '@/components/StageNav';

// Lazy-load TrainConfigModal — only rendered when user starts training
const TrainConfigModal = dynamic(() => import('@/components/TrainConfigModal'));

import { connectSSE as connectSSEUtil } from '@/lib/sse';
import { ChatItem, NEXT_STAGE } from './types';
import {
  buildTreeFromFlatList,
  insertNodeIntoTree,
  ensureStageFolders,
  unwrapTree,
} from './utils/fileTree';
import WorkspaceSidebar from './components/WorkspaceSidebar';
import renderChatItem from './components/ChatItemRenderer';
import ErrorBoundary from '@/components/ErrorBoundary';

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
  const [reconnectingIn, setReconnectingIn] = useState<number | null>(null);

  // Train config modal
  const [showTrainConfig, setShowTrainConfig] = useState(false);
  const [pendingTrainInstructions, setPendingTrainInstructions] = useState<string | undefined>();

  // Canvas state — opens on demand
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [canvasContent, setCanvasContent] = useState('');
  const [canvasTitle, setCanvasTitle] = useState('Report');
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
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

  // ---------------------------------------------------------------------------
  // SSE connection
  // ---------------------------------------------------------------------------
  const connectSSE = useCallback(
    (sid: string) => {
      if (sseRef.current) sseRef.current.close();

      const handleEvent = (event: SSEEvent) => {
        switch (event.type) {
          case 'state_change':
            setSessionState(event.data.state);
            if (event.data.state.includes('running')) setIsRunning(true);
            if (
              event.data.state.includes('done') ||
              event.data.state === 'failed' ||
              event.data.state === 'cancelled'
            )
              setIsRunning(false);
            if (event.data.state.endsWith('_done')) {
              const stageName = event.data.state.replace('_done', '').toUpperCase();
              const next = NEXT_STAGE[event.data.state];
              addItem({
                type: 'stage_complete',
                content: stageName,
                meta: next ? { nextStage: next.stage, nextLabel: next.label } : null,
              });
            }
            break;
          case 'agent_message':
            addItem({ type: 'assistant', content: event.data.text });
            break;
          case 'agent_token':
            setChatItems((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.type === 'assistant' && Date.now() - last.timestamp < 5000) {
                return [...prev.slice(0, -1), { ...last, content: last.content + event.data.text }];
              }
              return [
                ...prev,
                {
                  id: `${Date.now()}`,
                  type: 'assistant',
                  content: event.data.text,
                  timestamp: Date.now(),
                },
              ];
            });
            break;
          case 'tool_start':
            addItem({ type: 'tool_start', content: event.data.tool, meta: event.data.input });
            break;
          case 'tool_end':
            setChatItems((prev) => {
              const idx = prev.findLastIndex(
                (i) => i.type === 'tool_start' && i.content === event.data.tool,
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
                    output: event.data.output,
                    outputs: updated[idx].meta?.outputs || [],
                    duration,
                  },
                };
                return updated;
              }
              return [
                ...prev,
                {
                  id: `${Date.now()}-${Math.random()}`,
                  type: 'tool_end',
                  content: event.data.tool,
                  meta: { output: event.data.output },
                  timestamp: Date.now(),
                },
              ];
            });
            break;
          case 'code_output':
            setChatItems((prev) => {
              const idx = prev.findLastIndex((i) => i.type === 'tool_start');
              if (idx >= 0) {
                const updated = [...prev];
                const outputs = updated[idx].meta?.outputs || [];
                updated[idx] = {
                  ...updated[idx],
                  meta: {
                    ...updated[idx].meta,
                    outputs: [...outputs, { text: event.data.text, stream: event.data.stream }],
                  },
                };
                return updated;
              }
              addItem({
                type: 'code_output',
                content: event.data.text,
                meta: { stream: event.data.stream },
              });
              return prev;
            });
            break;
          case 'agent_error':
            addItem({ type: 'error', content: event.data.error });
            setIsRunning(false);
            break;
          case 'report_ready':
            setCanvasContent(event.data.content);
            setCanvasTitle(`${(event.data.stage || 'EDA').toUpperCase()} Report`);
            setCanvasOpen(true);
            break;
          case 'files_ready': {
            const stage = event.data.stage || '';
            const newFiles = event.data.files || [];
            setGeneratedFiles((prev) => {
              const existingPaths = new Set(prev.map((f) => f.path));
              const merged = [...prev];
              for (const f of newFiles) {
                if (!existingPaths.has(f.path)) merged.push(f);
              }
              return merged;
            });
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
            const stage = event.data.stage || '';
            setFileTree((prev) =>
              insertNodeIntoTree(
                prev,
                {
                  name: event.data.name,
                  path: event.data.path,
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
            const items = event.data.items || [];
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
            const key = `${event.data.step}:${event.data.name}:${event.data.run_tag || ''}`;
            if (!metricKeysRef.current.has(key)) {
              metricKeysRef.current.add(key);
              setMetricPoints((prev) => {
                if (prev.length === 0) setCanvasOpen(true);
                return [
                  ...prev,
                  {
                    step: event.data.step,
                    name: event.data.name,
                    value: event.data.value,
                    stage: event.data.stage,
                    run_tag: event.data.run_tag || null,
                    created_at: new Date().toISOString(),
                  },
                ];
              });
            }
            break;
          }
          case 'chart_config': {
            if (event.data.charts && Array.isArray(event.data.charts)) {
              setChartConfig({ charts: event.data.charts });
            }
            break;
          }
        }
      };

      // Use the shared SSE utility — single source of truth for connection logic
      const disconnect = connectSSEUtil(sid, {
        onEvent: handleEvent,
        onOpen: () => {
          setSseConnected(true);
          setReconnectingIn(null);
        },
        onError: () => setSseConnected(false),
        onReconnecting: (ms) => setReconnectingIn(ms),
        onReconnected: () => setReconnectingIn(null),
      });
      // Store disconnect fn so we can close from handleStop / cleanup
      sseRef.current = { close: disconnect } as EventSource;
    },
    [addItem],
  );

  // ---------------------------------------------------------------------------
  // Load experiment and auto-start
  // ---------------------------------------------------------------------------
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

          const restored: ChatItem[] = [];
          let restoredCanvasContent = '';
          let restoredCanvasTitle = 'Report';
          let restoredCanvasOpen = false;
          let restoredFiles: Array<{ path: string; type?: string; _stage?: string }> = [];

          if (sessionData.messages?.length > 0) {
            for (const msg of sessionData.messages) {
              const eventType = msg.metadata?.event_type;
              const mkItem = (item: Omit<ChatItem, 'id' | 'timestamp'>): ChatItem => ({
                ...item,
                id: `${msg.id || Date.now()}-${Math.random()}`,
                timestamp: Date.now(),
              });

              if (eventType === 'tool_start') {
                restored.push(
                  mkItem({
                    type: 'tool_start',
                    content: (msg.metadata?.tool as string) || 'execute_code',
                    meta: msg.metadata?.input as Record<string, unknown>,
                  }),
                );
              } else if (eventType === 'tool_end') {
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
                        {
                          text: msg.content || msg.metadata?.text,
                          stream: msg.metadata?.stream,
                        },
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

          setChatItems(restored);
          setCanvasContent(restoredCanvasContent);
          setCanvasTitle(restoredCanvasTitle);
          setCanvasOpen(restoredCanvasOpen);
          setGeneratedFiles(restoredFiles);

          if (restoredFiles.length > 0) {
            setFileTree(buildTreeFromFlatList(restoredFiles, `/sessions/${sid}`));
          }
          api
            .getFileTree(sid)
            .then((tree) => {
              if (!cancelled) setFileTree(ensureStageFolders(unwrapTree(tree)));
            })
            .catch(() => {});

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

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------
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
    setIsRunning(true);

    try {
      await api.sendMessage(sessionId, text, true);
    } catch (e: any) {
      addItem({ type: 'error', content: e.message });
      setIsRunning(false);
    }
  };

  const handleStartStage = useCallback(
    async (stage: Stage, extraInstructions?: string) => {
      if (!sessionId) return;

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

  // Listen for stage-start events from StageCompleteCard
  useEffect(() => {
    const handler = (e: Event) => {
      const { stage, instructions } = (e as CustomEvent).detail;
      handleStartStage(stage, instructions);
    };
    window.addEventListener('trainable:start-stage', handler);
    return () => window.removeEventListener('trainable:start-stage', handler);
  }, [handleStartStage]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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
        <div className="flex items-center gap-1.5">
          {reconnectingIn !== null && (
            <span className="text-xs text-yellow-400 animate-pulse">Reconnecting...</span>
          )}
          <div
            className={`w-2 h-2 rounded-full ${
              sseConnected
                ? 'bg-green-500'
                : reconnectingIn !== null
                  ? 'bg-yellow-500 animate-pulse'
                  : 'bg-red-500'
            }`}
            title={
              sseConnected
                ? 'Connected'
                : reconnectingIn !== null
                  ? `Reconnecting in ${Math.round(reconnectingIn / 1000)}s`
                  : 'Disconnected'
            }
          />
        </div>
      </header>

      {/* Main area — chat + canvas side by side */}
      <PanelGroup direction="horizontal" className="flex-1">
        {/* Chat panel */}
        <Panel defaultSize={canvasOpen ? 25 : 100} minSize={15}>
          <ErrorBoundary panelName="Chat">
            <div className="h-full flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div
                  className={`mx-auto w-full space-y-4 ${canvasOpen ? 'max-w-3xl' : 'max-w-5xl'}`}
                >
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
          </ErrorBoundary>
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
              <ErrorBoundary panelName="Workspace">
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
              </ErrorBoundary>
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
