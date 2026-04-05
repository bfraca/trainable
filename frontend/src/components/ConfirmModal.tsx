'use client';

import { useState, useEffect, useCallback } from 'react';
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';

interface ConfirmModalProps {
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  title: string;
  description: string;
  secondaryDescription?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}

export default function ConfirmModal({
  onConfirm,
  onClose,
  title,
  description,
  secondaryDescription,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
}: ConfirmModalProps) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    },
    [onClose, loading],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const isDanger = variant === 'danger';
  const Icon = isDanger ? Trash2 : AlertTriangle;
  const iconBg = isDanger ? 'bg-red-900/40' : 'bg-amber-900/40';
  const iconColor = isDanger ? 'text-red-400' : 'text-amber-400';
  const btnBg = isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={loading ? undefined : onClose}
      />
      <div className="relative bg-surface-elevated border border-surface-border rounded-xl shadow-2xl max-w-md w-full p-6 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className={`p-2.5 rounded-full ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
        </div>
        <p className="text-sm text-gray-300 mb-1">{description}</p>
        {secondaryDescription && (
          <p className="text-xs text-gray-500 mb-6">{secondaryDescription}</p>
        )}
        {!secondaryDescription && <div className="mb-6" />}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-300 bg-surface hover:bg-surface-hover border border-surface-border rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white ${btnBg} rounded-lg transition-colors disabled:opacity-50 inline-flex items-center`}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {confirmLabel}...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
