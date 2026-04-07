import { CheckCircle2, XCircle, Clock } from 'lucide-react';
import { statusConfig } from './statusConfig';

export default function StatusBadge({ status }: { status: string | null }) {
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
