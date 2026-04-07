'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, FolderOpen, BarChart3, FileText, ChevronRight, Code2, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { FileTreeNode, MetricPoint, ChartConfig } from '@/lib/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FileTreeRow from './FileTreeRow';

// Lazy-load heavy components — MetricsTab pulls in recharts, FileViewer pulls in react-syntax-highlighter
const MetricsTab = dynamic(() => import('@/components/MetricsTab'), {
  loading: () => (
    <div className="flex items-center justify-center p-8 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  ),
});
const FileViewer = dynamic(() => import('./FileViewer'), {
  loading: () => (
    <div className="flex items-center justify-center p-8 text-gray-500">
      <Loader2 className="w-5 h-5 animate-spin" />
    </div>
  ),
});
import { countFiles, fileBreadcrumb } from '../utils/fileTree';
import { getBackendUrl, getFileIconInfo } from '../utils/helpers';

/** Represents an open tab — a file, the report, or the metrics panel */
interface OpenTab {
  id: string; // file path, '__report__', or '__metrics__'
  label: string; // display name
  icon: LucideIcon;
  iconColor: string;
  type: 'file' | 'report' | 'metrics';
}

const REPORT_TAB_ID = '__report__';
const METRICS_TAB_ID = '__metrics__';

export default function WorkspaceSidebar({
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
