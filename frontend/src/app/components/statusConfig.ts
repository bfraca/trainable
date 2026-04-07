export const statusConfig: Record<
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
