'use client';

import { useState } from 'react';
import { CheckCircle2, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import { ChatItem } from '../types';

export default function StageCompleteCard({ item }: { item: ChatItem }) {
  const [extraInstructions, setExtraInstructions] = useState('');
  const [started, setStarted] = useState(false);
  const next = item.meta;

  const handleContinue = async () => {
    if (!next?.nextStage || started) return;
    setStarted(true);
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
