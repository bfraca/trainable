'use client';

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ArrowLeft } from 'lucide-react';
import { ExperimentDetail, Message, SSEEvent, MetricPoint, Stage, Artifact } from '@/lib/types';
import StageNav from './StageNav';
import ChatPanel from './ChatPanel';
import CanvasPanel from './CanvasPanel';

interface StudioProps {
  experiment: ExperimentDetail;
  sessionId: string;
  state: string;
  messages: Message[];
  artifacts: Artifact[];
  streamEvents: SSEEvent[];
  metricPoints: MetricPoint[];
  streamingText: string;
  report: string;
  onStartStage: (stage: Stage) => void;
  onSendMessage: (content: string) => void;
  onStop?: () => void;
}

export default function Studio({
  experiment,
  sessionId,
  state,
  messages,
  artifacts,
  streamEvents,
  metricPoints,
  streamingText,
  report,
  onStartStage,
  onSendMessage,
  onStop,
}: StudioProps) {
  const isRunning = state.includes('running');

  return (
    <div className="h-screen flex flex-col bg-surface">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-border shrink-0 bg-surface">
        <button
          onClick={() => (window.location.href = '/')}
          className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-gray-400" />
        </button>
        <a href="/" className="flex items-center shrink-0">
          <img src="/logo-brain.png" alt="Trainable" className="h-6 w-auto" />
        </a>
        <div className="w-px h-5 bg-surface-border" />
        <h1 className="text-sm font-semibold text-white truncate">{experiment.name}</h1>
        <div className="flex-1" />
        <StageNav state={state} onStartStage={onStartStage} onStop={onStop} isRunning={isRunning} />
      </header>

      {/* Split pane */}
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={40} minSize={25}>
          <ChatPanel
            messages={messages}
            streamEvents={streamEvents}
            streamingText={streamingText}
            onSendMessage={onSendMessage}
            onStop={onStop}
            isRunning={isRunning}
          />
        </Panel>
        <PanelResizeHandle className="w-1 bg-surface-border hover:bg-primary-500/50 transition-colors" />
        <Panel defaultSize={60} minSize={30}>
          <CanvasPanel
            report={report}
            artifacts={artifacts}
            metricPoints={metricPoints}
            chartConfig={null}
            state={state}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
