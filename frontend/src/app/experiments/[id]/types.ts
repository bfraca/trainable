import { Stage } from '@/lib/types';

export interface ChatItem {
  id: string;
  type:
    | 'user'
    | 'assistant'
    | 'tool_start'
    | 'tool_end'
    | 'code_output'
    | 'error'
    | 'status'
    | 'stage_complete';
  content: string;
  meta?: any;
  timestamp: number;
}

export const NEXT_STAGE: Record<string, { stage: Stage; label: string } | null> = {
  eda_done: { stage: 'prep', label: 'Data Prep' },
  prep_done: { stage: 'train', label: 'Training' },
  train_done: null, // pipeline complete
};
