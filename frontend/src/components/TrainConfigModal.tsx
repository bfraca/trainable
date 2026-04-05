'use client';

import { useState, useEffect, useCallback } from 'react';
import { Cpu, Zap, X } from 'lucide-react';

const COMPUTE_OPTIONS = [
  {
    id: undefined as string | undefined,
    label: 'CPU',
    desc: 'No GPU acceleration',
    detail: 'Best for sklearn, XGBoost, LightGBM',
  },
  { id: 'T4', label: 'T4', desc: '16 GB VRAM', detail: 'Good for small neural networks' },
  { id: 'A10G', label: 'A10G', desc: '24 GB VRAM', detail: 'Good for medium models' },
  { id: 'A100', label: 'A100', desc: '40/80 GB VRAM', detail: 'Large model training' },
  { id: 'H100', label: 'H100', desc: '80 GB VRAM', detail: 'Maximum performance' },
];

interface TrainConfigModalProps {
  onConfirm: (config: { gpu?: string; instructions?: string }) => void;
  onClose: () => void;
}

export default function TrainConfigModal({ onConfirm, onClose }: TrainConfigModalProps) {
  const [selectedGpu, setSelectedGpu] = useState<string | undefined>(undefined);
  const [instructions, setInstructions] = useState('');

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfirm = () => {
    onConfirm({
      gpu: selectedGpu,
      instructions: instructions.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-elevated border border-surface-border rounded-xl shadow-2xl max-w-lg w-full animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-primary-900/40">
              <Zap className="w-4 h-4 text-primary-400" />
            </div>
            <h2 className="text-base font-semibold text-white">Configure Training</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-hover rounded-lg transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Compute selector */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Compute
            </label>
            <div className="space-y-2">
              {COMPUTE_OPTIONS.map((opt) => {
                const isSelected = selectedGpu === opt.id;
                const isGpu = opt.id !== undefined;
                return (
                  <button
                    key={opt.label}
                    onClick={() => setSelectedGpu(opt.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-border bg-surface hover:bg-surface-hover hover:border-gray-600'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-md ${isSelected ? 'bg-primary-500/20' : 'bg-surface-hover'}`}
                    >
                      {isGpu ? (
                        <Zap
                          className={`w-3.5 h-3.5 ${isSelected ? 'text-primary-400' : 'text-gray-500'}`}
                        />
                      ) : (
                        <Cpu
                          className={`w-3.5 h-3.5 ${isSelected ? 'text-primary-400' : 'text-gray-500'}`}
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-gray-200'}`}
                        >
                          {opt.label}
                        </span>
                        <span className="text-xs text-gray-500">{opt.desc}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{opt.detail}</p>
                    </div>
                    <div
                      className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                        isSelected ? 'border-primary-500' : 'border-gray-600'
                      }`}
                    >
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary-500" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Additional Instructions <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Use PyTorch with a ResNet architecture..."
              rows={3}
              className="w-full px-3 py-2 text-sm text-gray-200 bg-surface border border-surface-border rounded-lg resize-none placeholder:text-gray-600 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/25 transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 border-t border-surface-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-surface hover:bg-surface-hover border border-surface-border rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
          >
            Start Training
          </button>
        </div>
      </div>
    </div>
  );
}
