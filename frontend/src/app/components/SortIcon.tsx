import { ChevronUp, ChevronDown } from 'lucide-react';

export type SortKey = 'name' | 'status' | 'dataset' | 'created_at';
export type SortDir = 'asc' | 'desc';

export default function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
}) {
  if (column !== sortKey) return <ChevronUp className="w-3.5 h-3.5 text-gray-600" />;
  return sortDir === 'asc' ? (
    <ChevronUp className="w-3.5 h-3.5 text-primary-400" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 text-primary-400" />
  );
}
