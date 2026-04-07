'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  duration: number;
  dismissing?: boolean;
}

type ToastInput = {
  variant: ToastVariant;
  title: string;
  description?: string;
  duration?: number;
};

interface ToastContextValue {
  toast: (options: ToastInput) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
};

const MAX_TOASTS = 5;

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: typeof CheckCircle2; borderColor: string; iconColor: string }
> = {
  success: {
    icon: CheckCircle2,
    borderColor: 'border-l-emerald-500',
    iconColor: 'text-emerald-400',
  },
  error: { icon: XCircle, borderColor: 'border-l-red-500', iconColor: 'text-red-400' },
  warning: { icon: AlertTriangle, borderColor: 'border-l-amber-500', iconColor: 'text-amber-400' },
  info: { icon: Info, borderColor: 'border-l-primary-500', iconColor: 'text-primary-400' },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { icon: Icon, borderColor, iconColor } = VARIANT_CONFIG[toast.variant];

  return (
    <div
      className={`pointer-events-auto w-full max-w-sm bg-surface-elevated border border-surface-border border-l-4 ${borderColor} rounded-lg shadow-2xl ${
        toast.dismissing ? 'animate-toast-out' : 'animate-toast-in'
      }`}
      role="alert"
    >
      <div className="flex items-start gap-3 p-4">
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">{toast.title}</p>
          {toast.description && <p className="mt-1 text-xs text-gray-400">{toast.description}</p>}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="shrink-0 p-0.5 rounded text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      // Start exit animation
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
      // Remove after animation completes
      setTimeout(() => removeToast(id), 200);
    },
    [removeToast],
  );

  const toast = useCallback(
    (options: ToastInput) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const duration = options.duration ?? DEFAULT_DURATIONS[options.variant];
      const newToast: Toast = { ...options, id, duration };

      setToasts((prev) => {
        const next = [...prev, newToast];
        // Evict oldest if over limit
        if (next.length > MAX_TOASTS) {
          const evicted = next[0];
          setTimeout(() => removeToast(evicted.id), 0);
          return next.slice(1);
        }
        return next;
      });

      // Auto-dismiss timer
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss, removeToast],
  );

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {/* Toast container */}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}
