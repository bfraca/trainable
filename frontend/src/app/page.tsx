'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  BarChart3,
  Database,
  Cpu,
  Zap,
  RefreshCw,
  AlertTriangle,
  WifiOff,
  LayoutGrid,
  TableProperties,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
} from 'lucide-react';
import { Experiment } from '@/lib/types';
import { api } from '@/lib/api';
import CreateModal from '@/components/CreateModal';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';

const statusConfig: Record<
  string,
  {
    color: string;
    bgColor: string;
    label: string;
    icon: 'running' | 'done' | 'failed' | 'pending';
    stage: string;
  }
> = {
  created: {
    color: 'text-gray-400',
    bgColor: 'bg-neutral-800',
    label: 'Created',
    icon: 'pending',
    stage: '',
  },
  eda_running: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/50',
    label: 'Running EDA',
    icon: 'running',
    stage: 'EDA',
  },
  eda_done: {
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/50',
    label: 'EDA Complete',
    icon: 'done',
    stage: 'EDA',
  },
  prep_running: {
    color: 'text-blue-400',
    bgColor: 'bg-blue-900/50',
    label: 'Preparing Data',
    icon: 'running',
    stage: 'Prep',
  },
  prep_done: {
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/50',
    label: 'Prep Complete',
    icon: 'done',
    stage: 'Prep',
  },
  train_running: {
    color: 'text-amber-400',
    bgColor: 'bg-amber-900/50',
    label: 'Training Model',
    icon: 'running',
    stage: 'Train',
  },
  train_done: {
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-900/50',
    label: 'Complete',
    icon: 'done',
    stage: 'Train',
  },
  failed: {
    color: 'text-red-400',
    bgColor: 'bg-red-900/50',
    label: 'Failed',
    icon: 'failed',
    stage: '',
  },
  cancelled: {
    color: 'text-gray-400',
    bgColor: 'bg-neutral-800',
    label: 'Cancelled',
    icon: 'failed',
    stage: '',
  },
};

function StageProgress({ status }: { status: string | null }) {
  const stages = ['EDA', 'Prep', 'Train'];
  const config = status ? statusConfig[status] : null;
  const currentStageIndex = config ? stages.indexOf(config.stage) : -1;
  const isDone = config?.icon === 'done';
  const isFailed = config?.icon === 'failed';

  return (
    <div className="flex items-center space-x-1">
      {stages.map((stage, index) => {
        const isActive = index === currentStageIndex;
        const isComplete = index < currentStageIndex || (isDone && index === currentStageIndex);
        const hasFailed = isFailed && index === currentStageIndex;
        return (
          <div key={stage} className="flex items-center">
            <div
              className={`w-2 h-2 rounded-full transition-all ${
                hasFailed
                  ? 'bg-red-500'
                  : isComplete
                    ? 'bg-emerald-500'
                    : isActive
                      ? 'bg-blue-500 animate-pulse'
                      : 'bg-neutral-600'
              }`}
            />
            {index < stages.length - 1 && (
              <div className={`w-4 h-0.5 ${isComplete ? 'bg-emerald-500' : 'bg-neutral-700'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const config = status ? statusConfig[status] : null;
  const { color, bgColor, label, icon } = config || {
    color: 'text-gray-400',
    bgColor: 'bg-neutral-800',
    label: 'New',
    icon: 'pending' as const,
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${bgColor} ${color}`}
    >
      {icon === 'running' && (
        <span className="relative flex h-1.5 w-1.5 mr-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-current" />
        </span>
      )}
      {icon === 'done' && <CheckCircle2 className="w-3 h-3 mr-1" />}
      {icon === 'failed' && <XCircle className="w-3 h-3 mr-1" />}
      {icon === 'pending' && <Clock className="w-3 h-3 mr-1" />}
      {label}
    </span>
  );
}

function StatsCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Zap;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-surface-elevated rounded-xl border border-surface-border p-4 shadow-sm">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="text-2xl font-bold text-white">{value}</p>
          <p className="text-xs text-gray-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function ExperimentCard({
  experiment,
  onClick,
  onDelete,
  selected,
  onToggleSelect,
}: {
  experiment: Experiment;
  onClick: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const isRunning = experiment.latest_state?.includes('running');

  return (
    <div
      onClick={onClick}
      className={`group relative bg-surface-elevated rounded-xl border transition-all duration-200 hover:shadow-lg hover:shadow-black/20 hover:border-primary-700 cursor-pointer ${
        selected
          ? 'border-primary-500 ring-1 ring-primary-500/50'
          : isRunning
            ? 'border-blue-700 shadow-md ring-1 ring-blue-900/50'
            : 'border-surface-border shadow-sm'
      }`}
    >
      {isRunning && !selected && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
          </span>
        </div>
      )}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              className={`mt-0.5 shrink-0 w-4.5 h-4.5 rounded border transition-all flex items-center justify-center ${
                selected
                  ? 'bg-primary-600 border-primary-600 text-white'
                  : 'border-gray-600 hover:border-gray-400 opacity-0 group-hover:opacity-100'
              }`}
            >
              {selected && <CheckCircle2 className="w-3 h-3" />}
            </button>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-white group-hover:text-primary-400 transition-colors truncate">
                {experiment.name}
              </h3>
              {experiment.description && (
                <p className="mt-1 text-sm text-gray-400 line-clamp-2">{experiment.description}</p>
              )}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="ml-2 p-1.5 rounded-lg text-gray-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-900/30 transition-all"
            title="Delete experiment"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between mb-4">
          <StatusBadge status={experiment.latest_state} />
          <StageProgress status={experiment.latest_state} />
        </div>
        <div className="border-t border-surface-border pt-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 truncate">
              {experiment.dataset_ref.split('/').pop()}
            </span>
            <ArrowRight className="w-4 h-4 text-gray-500 group-hover:text-primary-400 group-hover:translate-x-1 transition-all" />
          </div>
        </div>
      </div>
    </div>
  );
}

type ViewMode = 'cards' | 'table';
type SortKey = 'name' | 'status' | 'dataset' | 'created_at';
type SortDir = 'asc' | 'desc';

function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (column !== sortKey) return <ChevronUp className="w-3.5 h-3.5 text-gray-600" />;
  return sortDir === 'asc' ? (
    <ChevronUp className="w-3.5 h-3.5 text-primary-400" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 text-primary-400" />
  );
}

function ExperimentTable({
  experiments,
  onClick,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: {
  experiments: Experiment[];
  onClick: (exp: Experiment) => void;
  onDelete: (exp: Experiment) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = [...experiments].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'status':
        return dir * (a.latest_state || '').localeCompare(b.latest_state || '');
      case 'dataset':
        return dir * a.dataset_ref.localeCompare(b.dataset_ref);
      case 'created_at':
        return dir * a.created_at.localeCompare(b.created_at);
      default:
        return 0;
    }
  });

  const allOnPageSelected =
    experiments.length > 0 && experiments.every((e) => selectedIds.has(e.id));
  const someOnPageSelected = experiments.some((e) => selectedIds.has(e.id));

  const thClass =
    'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-200 transition-colors';

  return (
    <div className="bg-surface-elevated rounded-xl border border-surface-border shadow-sm overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="border-b border-surface-border bg-surface">
            <tr>
              <th className="px-4 py-3 w-10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAll();
                  }}
                  className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                    allOnPageSelected
                      ? 'bg-primary-600 border-primary-600 text-white'
                      : someOnPageSelected
                        ? 'bg-primary-600/50 border-primary-600 text-white'
                        : 'border-gray-600 hover:border-gray-400'
                  }`}
                >
                  {allOnPageSelected && <CheckCircle2 className="w-3 h-3" />}
                  {someOnPageSelected && !allOnPageSelected && (
                    <div className="w-2 h-0.5 bg-white rounded" />
                  )}
                </button>
              </th>
              <th className={thClass} onClick={() => toggleSort('name')}>
                <span className="inline-flex items-center gap-1">
                  Name <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('status')}>
                <span className="inline-flex items-center gap-1">
                  Status <SortIcon column="status" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={`${thClass} hidden sm:table-cell`}>Progress</th>
              <th
                className={`${thClass} hidden md:table-cell`}
                onClick={() => toggleSort('dataset')}
              >
                <span className="inline-flex items-center gap-1">
                  Dataset <SortIcon column="dataset" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('created_at')}>
                <span className="inline-flex items-center gap-1">
                  Created <SortIcon column="created_at" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="px-4 py-3">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {sorted.map((exp) => {
              const isRunning = exp.latest_state?.includes('running');
              const isSelected = selectedIds.has(exp.id);
              return (
                <tr
                  key={exp.id}
                  onClick={() => onClick(exp)}
                  className={`group cursor-pointer transition-colors hover:bg-surface-hover ${isSelected ? 'bg-primary-900/20' : isRunning ? 'bg-blue-900/10' : ''}`}
                >
                  <td className="px-4 py-3 w-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(exp.id);
                      }}
                      className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                        isSelected
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-600 hover:border-gray-400 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3 h-3" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isRunning && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{exp.name}</p>
                        {exp.description && (
                          <p className="text-xs text-gray-500 truncate max-w-xs">
                            {exp.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={exp.latest_state} />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <StageProgress status={exp.latest_state} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-gray-400 truncate block max-w-[180px]">
                      {exp.dataset_ref.split('/').pop()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(exp.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(exp);
                        }}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete experiment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ArrowRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PAGE_SIZE = 12;

export default function HomePage() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; type: string } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [deleteTarget, setDeleteTarget] = useState<Experiment | null>(null);
  const [bulkDeleteTarget, setBulkDeleteTarget] = useState(false);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const totalPages = Math.max(1, Math.ceil(experiments.length / PAGE_SIZE));
  const paginatedExperiments = experiments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page if it becomes out of bounds
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const pageIds = paginatedExperiments.map((e) => e.id);
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [paginatedExperiments]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const fetchExperiments = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true);
    try {
      const data = await api.listExperiments();
      setExperiments(data);
      setError(null);
    } catch (err: any) {
      setError({ message: err.message || 'Unable to connect', type: 'network' });
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  const handleDelete = useCallback(
    async (exp: Experiment) => {
      try {
        await api.deleteExperiment(exp.id);
        setExperiments((prev) => prev.filter((e) => e.id !== exp.id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(exp.id);
          return next;
        });
        toast({
          variant: 'success',
          title: 'Experiment deleted',
          description: `"${exp.name}" has been removed.`,
        });
      } catch (err: any) {
        toast({
          variant: 'error',
          title: 'Delete failed',
          description: err.message || 'Something went wrong.',
        });
      } finally {
        setDeleteTarget(null);
      }
    },
    [toast],
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    const deletedIds: string[] = [];
    let failed = 0;
    for (const id of ids) {
      try {
        await api.deleteExperiment(id);
        deletedIds.push(id);
      } catch {
        failed++;
      }
    }
    const deletedSet = new Set(deletedIds);
    setExperiments((prev) => prev.filter((e) => !deletedSet.has(e.id)));
    setSelectedIds(new Set());
    setBulkDeleteTarget(false);
    if (failed === 0) {
      toast({
        variant: 'success',
        title: `${deletedIds.length} experiment${deletedIds.length > 1 ? 's' : ''} deleted`,
        description: 'Selected experiments have been removed.',
      });
    } else {
      toast({
        variant: 'error',
        title: `Deleted ${deletedIds.length}, failed ${failed}`,
        description: 'Some experiments could not be deleted.',
      });
    }
    fetchExperiments();
  }, [selectedIds, toast, fetchExperiments]);

  useEffect(() => {
    fetchExperiments();
  }, [fetchExperiments]);

  // Auto-refresh when experiments are running
  useEffect(() => {
    const hasRunning = experiments.some((exp) => exp.latest_state?.includes('running'));
    if (hasRunning) {
      const interval = setInterval(fetchExperiments, 3000);
      return () => clearInterval(interval);
    }
  }, [experiments, fetchExperiments]);

  const runningCount = experiments.filter((exp) => exp.latest_state?.includes('running')).length;
  const completedCount = experiments.filter((exp) => exp.latest_state === 'train_done').length;

  return (
    <>
      {/* Header */}
      <header className="bg-surface border-b border-surface-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 sm:h-16">
            <a href="/" className="flex items-center rounded-lg transition-colors hover:opacity-90">
              <img src="/logo-with-text.png" alt="Trainable" className="h-8 sm:h-9 w-auto" />
            </a>
            <nav className="flex items-center space-x-1 sm:space-x-4">
              <a
                href="/"
                className="text-white bg-surface-hover px-2 sm:px-3 py-1.5 sm:py-2 text-sm font-medium rounded-lg transition-colors"
              >
                Experiments
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main */}
      <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="space-y-6">
          {/* Page header */}
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Dashboard</h1>
              <p className="mt-1 text-sm text-gray-400">Manage and monitor your ML experiments</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-surface-elevated rounded-lg border border-surface-border p-0.5">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-surface-hover text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  title="Card view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-surface-hover text-white' : 'text-gray-500 hover:text-gray-300'}`}
                  title="Table view"
                >
                  <TableProperties className="w-4 h-4" />
                </button>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center justify-center px-4 py-2.5 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                New Experiment
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              className="animate-fade-in"
              style={{ animationDelay: '0ms', animationFillMode: 'both' }}
            >
              <StatsCard
                icon={Cpu}
                label="Total Experiments"
                value={experiments.length}
                color="bg-gray-600"
              />
            </div>
            <div
              className="animate-fade-in"
              style={{ animationDelay: '50ms', animationFillMode: 'both' }}
            >
              <StatsCard icon={Zap} label="Running" value={runningCount} color="bg-blue-500" />
            </div>
            <div
              className="animate-fade-in"
              style={{ animationDelay: '100ms', animationFillMode: 'both' }}
            >
              <StatsCard
                icon={CheckCircle2}
                label="Completed"
                value={completedCount}
                color="bg-emerald-500"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="p-4 rounded-lg border bg-amber-900/30 border-amber-800">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-900/50">
                  <WifiOff className="w-5 h-5 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium text-amber-300">{error.message}</h3>
                  <button
                    onClick={() => fetchExperiments(true)}
                    disabled={retrying}
                    className="mt-3 inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-lg bg-amber-800/50 text-amber-200 hover:bg-amber-800/70 disabled:opacity-50"
                  >
                    {retrying ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Retrying...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Try Again
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Running indicator */}
          {runningCount > 0 && (
            <div className="flex items-center justify-center text-sm text-blue-400 bg-blue-900/30 px-4 py-2 rounded-lg border border-blue-800">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {runningCount} experiment{runningCount > 1 ? 's' : ''} running - auto-refreshing
            </div>
          )}

          {/* Selection toolbar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between bg-primary-900/30 border border-primary-700 rounded-lg px-4 py-2.5 animate-fade-in">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-primary-300">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="text-xs text-gray-400 hover:text-gray-200 transition-colors inline-flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <button
                onClick={() => setBulkDeleteTarget(true)}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-red-300 bg-red-900/40 hover:bg-red-900/60 border border-red-800 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Delete selected
              </button>
            </div>
          )}

          {/* Experiments list */}
          {loading ? (
            viewMode === 'cards' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-44 bg-surface-elevated rounded-xl border border-surface-border animate-pulse"
                  />
                ))}
              </div>
            ) : (
              <div className="bg-surface-elevated rounded-xl border border-surface-border animate-pulse h-64" />
            )
          ) : experiments.length === 0 ? (
            <div className="bg-surface-elevated rounded-xl border border-surface-border p-12 text-center shadow-sm animate-fade-in">
              <div className="mx-auto w-16 h-16 bg-neutral-800 rounded-full flex items-center justify-center mb-4">
                <Database className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-lg font-medium text-white mb-2">No experiments yet</h3>
              <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">
                Get started by creating your first ML experiment. Upload a dataset and let the AI
                agent guide you through the process.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create your first experiment
              </button>
            </div>
          ) : viewMode === 'table' ? (
            <ExperimentTable
              experiments={paginatedExperiments}
              onClick={(exp) => {
                const sid = exp.latest_session_id;
                window.location.href = `/experiments/${exp.id}${sid ? `?session=${sid}` : ''}`;
              }}
              onDelete={(exp) => setDeleteTarget(exp)}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleAll={toggleAllOnPage}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedExperiments.map((experiment, index) => (
                <div
                  key={experiment.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
                >
                  <ExperimentCard
                    experiment={experiment}
                    onClick={() => {
                      const sid = experiment.latest_session_id;
                      window.location.href = `/experiments/${experiment.id}${sid ? `?session=${sid}` : ''}`;
                    }}
                    onDelete={() => setDeleteTarget(experiment)}
                    selected={selectedIds.has(experiment.id)}
                    onToggleSelect={() => toggleSelect(experiment.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {!loading && experiments.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm text-gray-500">
                Showing {page * PAGE_SIZE + 1}–
                {Math.min((page + 1) * PAGE_SIZE, experiments.length)} of {experiments.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                      i === page
                        ? 'bg-primary-600 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-surface-hover'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(exp) => {
            setShowCreate(false);
            window.location.href = `/experiments/${exp.id}?session=${exp.session_id}`;
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
          title="Delete Experiment"
          description={`Are you sure you want to delete "${deleteTarget.name}"?`}
          secondaryDescription="This will remove the experiment record and its sessions. Your dataset files in S3 will not be deleted."
          confirmLabel="Delete"
          variant="danger"
        />
      )}

      {bulkDeleteTarget && (
        <ConfirmModal
          onConfirm={handleBulkDelete}
          onClose={() => setBulkDeleteTarget(false)}
          title={`Delete ${selectedIds.size} Experiment${selectedIds.size > 1 ? 's' : ''}`}
          description={`Are you sure you want to delete ${selectedIds.size} selected experiment${selectedIds.size > 1 ? 's' : ''}?`}
          secondaryDescription="This will remove the experiment records and their sessions. Your dataset files in S3 will not be deleted."
          confirmLabel={`Delete ${selectedIds.size}`}
          variant="danger"
        />
      )}
    </>
  );
}
