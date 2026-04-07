'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { FileText, FolderOpen, BarChart3, Loader2 } from 'lucide-react';
import { Artifact, MetricPoint, ChartConfig } from '@/lib/types';
import ReportTab from './ReportTab';
import FilesTab from './FilesTab';

// Lazy-load MetricsTab — it pulls in recharts (~200 KB gzipped)
const MetricsTab = dynamic(() => import('./MetricsTab'), {
  loading: () => (
    <div className="flex items-center justify-center p-8 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  ),
});

interface CanvasPanelProps {
  report: string;
  artifacts: Artifact[];
  metricPoints: MetricPoint[];
  chartConfig: ChartConfig | null;
  state: string;
}

type Tab = 'report' | 'files' | 'metrics';

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'report', label: 'Report', icon: FileText },
  { key: 'files', label: 'Files', icon: FolderOpen },
  { key: 'metrics', label: 'Metrics', icon: BarChart3 },
];

export default function CanvasPanel({
  report,
  artifacts,
  metricPoints,
  chartConfig,
  state,
}: CanvasPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('report');

  return (
    <div className="h-full flex flex-col bg-surface-elevated">
      {/* Tab bar */}
      <div className="flex items-center border-b border-surface-border px-2 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                active
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'report' && <ReportTab report={report} />}
        {activeTab === 'files' && <FilesTab artifacts={artifacts} />}
        {activeTab === 'metrics' && (
          <MetricsTab metricPoints={metricPoints} chartConfig={chartConfig} state={state} />
        )}
      </div>
    </div>
  );
}
