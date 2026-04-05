'use client';

import { Play, Square, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Stage } from '@/lib/types';

interface StageNavProps {
  state: string;
  onStartStage: (stage: Stage) => void;
  onStop?: () => void;
  isRunning: boolean;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'eda', label: 'EDA' },
  { key: 'prep', label: 'Prep' },
  { key: 'train', label: 'Train' },
];

function getStageStatus(stage: Stage, state: string): 'pending' | 'running' | 'done' | 'failed' {
  if (state === `${stage}_running`) return 'running';
  if (state === `${stage}_done`) return 'done';
  if (state === 'failed') return 'failed';
  if (state === 'cancelled') return 'pending';

  const order = ['eda', 'prep', 'train'];
  const currentIdx = order.findIndex((s) => state.startsWith(s));
  const stageIdx = order.indexOf(stage);

  if (currentIdx > stageIdx) return 'done';
  return 'pending';
}

/** Only allow starting a stage if the previous stage is complete. */
function canStartStage(stage: Stage, state: string): boolean {
  const REQUIRED: Record<string, string> = { prep: 'eda_done', train: 'prep_done' };
  const required = REQUIRED[stage];
  if (!required) return state === 'created' || state === 'failed' || state === 'cancelled';
  return state === required;
}

export default function StageNav({ state, onStartStage, onStop, isRunning }: StageNavProps) {
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, i) => {
        const status = getStageStatus(stage.key, state);
        const canStart = !isRunning && status === 'pending' && canStartStage(stage.key, state);
        const canStop = status === 'running' && onStop;

        return (
          <div key={stage.key} className="flex items-center">
            {i > 0 && <div className="w-6 h-px bg-surface-border mx-1" />}
            <button
              onClick={() =>
                canStop ? onStop?.() : canStart ? onStartStage(stage.key) : undefined
              }
              disabled={!canStart && !canStop}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                status === 'running'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 cursor-pointer'
                  : status === 'done'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : status === 'failed'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : canStart
                        ? 'bg-surface-elevated hover:bg-surface-hover text-gray-300 border border-surface-border hover:border-gray-500'
                        : 'bg-surface-elevated text-gray-600 border border-surface-border cursor-not-allowed'
              }`}
              title={canStop ? 'Click to stop' : undefined}
            >
              {status === 'running' ? (
                <span className="group-hover:hidden">
                  <Loader2 className="w-3 h-3 animate-spin" />
                </span>
              ) : status === 'done' ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : status === 'failed' ? (
                <AlertCircle className="w-3 h-3" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {stage.label}
              {canStop && <Square className="w-2.5 h-2.5 ml-0.5 opacity-0 hover:opacity-100" />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
