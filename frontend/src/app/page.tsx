'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Loader2,
  CheckCircle2,
  Cpu,
  Zap,
  RefreshCw,
  WifiOff,
  LayoutGrid,
  TableProperties,
  ChevronLeft,
  ChevronRight,
  Trash2,
  X,
  Database,
} from 'lucide-react';
import { Experiment } from '@/lib/types';
import { api } from '@/lib/api';
import CreateModal from '@/components/CreateModal';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';

import StatsCard from './components/StatsCard';
import ExperimentCard from './components/ExperimentCard';
import ExperimentTable from './components/ExperimentTable';
import ErrorBoundary from '@/components/ErrorBoundary';

type ViewMode = 'cards' | 'table';

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
            <nav aria-label="Main navigation" className="flex items-center space-x-1 sm:space-x-4">
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
      <ErrorBoundary panelName="Dashboard">
        <main id="main-content" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          <div className="space-y-6">
            {/* Page header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">Dashboard</h1>
                <p className="mt-1 text-sm text-gray-400">Manage and monitor your ML experiments</p>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center bg-surface-elevated rounded-lg border border-surface-border p-0.5"
                  role="group"
                  aria-label="View mode"
                >
                  <button
                    onClick={() => setViewMode('cards')}
                    aria-label="Card view"
                    aria-pressed={viewMode === 'cards'}
                    className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-surface-hover text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    title="Card view"
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    aria-label="Table view"
                    aria-pressed={viewMode === 'table'}
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
                  Showing {page * PAGE_SIZE + 1}\u2013
                  {Math.min((page + 1) * PAGE_SIZE, experiments.length)} of {experiments.length}
                </span>
                <nav aria-label="Pagination" className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    aria-label="Previous page"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setPage(i)}
                      aria-label={`Page ${i + 1}`}
                      aria-current={i === page ? 'page' : undefined}
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
                    aria-label="Next page"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-surface-hover disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </nav>
              </div>
            )}
          </div>
        </main>
      </ErrorBoundary>

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
