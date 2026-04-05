'use client';

import { useState } from 'react';
import { Experiment } from '@/lib/types';
import { FlaskConical, Clock, Trash2, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from './ConfirmModal';
import { useToast } from './Toast';

const STATE_COLORS: Record<string, string> = {
  created: 'bg-gray-600',
  eda_running: 'bg-amber-500',
  eda_done: 'bg-green-600',
  prep_running: 'bg-amber-500',
  prep_done: 'bg-green-600',
  train_running: 'bg-amber-500',
  train_done: 'bg-green-600',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-500',
};

const STATE_LABELS: Record<string, string> = {
  created: 'New',
  eda_running: 'EDA Running',
  eda_done: 'EDA Complete',
  prep_running: 'Prep Running',
  prep_done: 'Prep Complete',
  train_running: 'Training',
  train_done: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

interface GalleryProps {
  experiments: Experiment[];
  onRefresh: () => void;
  onCreateClick: () => void;
}

export default function Gallery({ experiments, onRefresh, onCreateClick }: GalleryProps) {
  const [deleteTarget, setDeleteTarget] = useState<Experiment | null>(null);
  const { toast } = useToast();

  if (experiments.length === 0) {
    return (
      <div className="text-center py-20">
        <FlaskConical className="w-16 h-16 text-gray-600 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-300 mb-2">No experiments yet</h2>
        <p className="text-gray-500 mb-6">
          Upload a dataset to get started with AI-powered analysis
        </p>
        <button
          onClick={onCreateClick}
          className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
        >
          Create Your First Experiment
        </button>
      </div>
    );
  }

  const handleDelete = async (exp: Experiment) => {
    try {
      await api.deleteExperiment(exp.id);
      onRefresh();
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
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {experiments.map((exp) => (
          <div
            key={exp.id}
            onClick={() => {
              const sid = exp.latest_session_id;
              window.location.href = `/experiments/${exp.id}${sid ? `?session=${sid}` : ''}`;
            }}
            className="group bg-surface-elevated hover:bg-surface-hover border border-surface-border rounded-xl p-5 cursor-pointer transition-all hover:border-gray-600"
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-white truncate flex-1">{exp.name}</h3>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(exp);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
              </button>
            </div>

            {exp.description && (
              <p className="text-sm text-gray-400 line-clamp-2 mb-3">{exp.description}</p>
            )}

            <div className="flex items-center justify-between mt-auto">
              <div className="flex items-center gap-2">
                {exp.latest_state && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-white ${STATE_COLORS[exp.latest_state] || 'bg-gray-600'}`}
                  >
                    {exp.latest_state?.includes('running') && (
                      <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse-dot" />
                    )}
                    {STATE_LABELS[exp.latest_state] || exp.latest_state}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <Clock className="w-3 h-3" />
                {new Date(exp.created_at).toLocaleDateString()}
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-surface-border flex items-center justify-between">
              <span className="text-xs text-gray-500 truncate">
                {exp.dataset_ref.split('/').pop()}
              </span>
              <ArrowRight className="w-4 h-4 text-gray-500 group-hover:text-accent transition-colors" />
            </div>
          </div>
        ))}
      </div>

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
    </>
  );
}
