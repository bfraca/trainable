import { CheckCircle2, ArrowRight, Trash2 } from 'lucide-react';
import { Experiment } from '@/lib/types';
import StatusBadge from './StatusBadge';
import StageProgress from './StageProgress';

export default function ExperimentCard({
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
              role="checkbox"
              aria-checked={selected}
              aria-label={`Select ${experiment.name}`}
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
            aria-label={`Delete ${experiment.name}`}
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
