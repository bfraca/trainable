import {
  FileText,
  Image,
  Braces,
  Table,
  Database,
  Cpu,
  File as FileIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export function getSSEBase() {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  return `http://${window.location.hostname}:8000`;
}

export function getBackendUrl() {
  if (typeof window === 'undefined') return 'http://localhost:8000';
  return `http://${window.location.hostname}:8000`;
}

export function getFileIconInfo(name: string): { icon: LucideIcon; color: string } {
  if (/\.(png|jpg|jpeg|svg|gif)$/i.test(name)) return { icon: Image, color: 'text-purple-400' };
  if (name.endsWith('.py')) return { icon: FileText, color: 'text-yellow-400' };
  if (name.endsWith('.md')) return { icon: FileText, color: 'text-blue-400' };
  if (name.endsWith('.json')) return { icon: Braces, color: 'text-amber-400' };
  if (name.endsWith('.csv')) return { icon: Table, color: 'text-green-400' };
  if (/\.(parquet|arrow)$/i.test(name)) return { icon: Database, color: 'text-cyan-400' };
  if (/\.(pkl|joblib|h5|pt|pth|onnx)$/i.test(name)) return { icon: Cpu, color: 'text-pink-400' };
  return { icon: FileIcon, color: 'text-gray-400' };
}

export const DIR_LABELS: Record<string, string> = {
  eda: 'eda',
  prep: 'prep',
  train: 'train',
};

export const DIR_COLORS: Record<string, string> = {
  eda: 'text-blue-400',
  prep: 'text-amber-400',
  train: 'text-green-400',
};

export const FUN_VERBS = [
  'Schlepping',
  'Noodling',
  'Crunching',
  'Wrangling',
  'Percolating',
  'Tinkering',
  'Brewing',
  'Conjuring',
  'Finagling',
  'Rummaging',
  'Simmering',
  'Whittling',
  'Pondering',
  'Juggling',
  'Untangling',
];

export const PAST_VERBS = [
  'Schlepped',
  'Noodled',
  'Crunched',
  'Wrangled',
  'Percolated',
  'Tinkered',
  'Brewed',
  'Conjured',
  'Finagled',
  'Rummaged',
  'Simmered',
  'Whittled',
  'Pondered',
  'Juggled',
  'Untangled',
];
