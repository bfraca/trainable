'use client';

import { useState } from 'react';
import { CheckCircle2, ArrowRight, Trash2 } from 'lucide-react';
import { Experiment } from '@/lib/types';
import StatusBadge from './StatusBadge';
import StageProgress from './StageProgress';
import SortIcon, { SortKey, SortDir } from './SortIcon';

export default function ExperimentTable({
  experiments,
  onClick,
  onDelete,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: {
  experiments: Experiment[];
  onClick: (exp: Experiment) => void;
  onDelete: (exp: Experiment) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sorted = [...experiments].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'status':
        return dir * (a.latest_state || '').localeCompare(b.latest_state || '');
      case 'dataset':
        return dir * a.dataset_ref.localeCompare(b.dataset_ref);
      case 'created_at':
        return dir * a.created_at.localeCompare(b.created_at);
      default:
        return 0;
    }
  });

  const allOnPageSelected =
    experiments.length > 0 && experiments.every((e) => selectedIds.has(e.id));
  const someOnPageSelected = experiments.some((e) => selectedIds.has(e.id));

  const thClass =
    'px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-200 transition-colors';

  return (
    <div className="bg-surface-elevated rounded-xl border border-surface-border shadow-sm overflow-hidden animate-fade-in">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead className="border-b border-surface-border bg-surface">
            <tr>
              <th className="px-4 py-3 w-10">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAll();
                  }}
                  role="checkbox"
                  aria-checked={allOnPageSelected ? true : someOnPageSelected ? 'mixed' : false}
                  aria-label="Select all experiments on this page"
                  className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                    allOnPageSelected
                      ? 'bg-primary-600 border-primary-600 text-white'
                      : someOnPageSelected
                        ? 'bg-primary-600/50 border-primary-600 text-white'
                        : 'border-gray-600 hover:border-gray-400'
                  }`}
                >
                  {allOnPageSelected && <CheckCircle2 className="w-3 h-3" />}
                  {someOnPageSelected && !allOnPageSelected && (
                    <div className="w-2 h-0.5 bg-white rounded" />
                  )}
                </button>
              </th>
              <th className={thClass} onClick={() => toggleSort('name')}>
                <span className="inline-flex items-center gap-1">
                  Name <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('status')}>
                <span className="inline-flex items-center gap-1">
                  Status <SortIcon column="status" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={`${thClass} hidden sm:table-cell`}>Progress</th>
              <th
                className={`${thClass} hidden md:table-cell`}
                onClick={() => toggleSort('dataset')}
              >
                <span className="inline-flex items-center gap-1">
                  Dataset <SortIcon column="dataset" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className={thClass} onClick={() => toggleSort('created_at')}>
                <span className="inline-flex items-center gap-1">
                  Created <SortIcon column="created_at" sortKey={sortKey} sortDir={sortDir} />
                </span>
              </th>
              <th className="px-4 py-3">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {sorted.map((exp) => {
              const isRunning = exp.latest_state?.includes('running');
              const isSelected = selectedIds.has(exp.id);
              return (
                <tr
                  key={exp.id}
                  onClick={() => onClick(exp)}
                  className={`group cursor-pointer transition-colors hover:bg-surface-hover ${isSelected ? 'bg-primary-900/20' : isRunning ? 'bg-blue-900/10' : ''}`}
                >
                  <td className="px-4 py-3 w-10">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect(exp.id);
                      }}
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={`Select ${exp.name}`}
                      className={`w-4 h-4 rounded border transition-all flex items-center justify-center ${
                        isSelected
                          ? 'bg-primary-600 border-primary-600 text-white'
                          : 'border-gray-600 hover:border-gray-400 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isSelected && <CheckCircle2 className="w-3 h-3" />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {isRunning && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{exp.name}</p>
                        {exp.description && (
                          <p className="text-xs text-gray-500 truncate max-w-xs">
                            {exp.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={exp.latest_state} />
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <StageProgress status={exp.latest_state} />
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="text-xs text-gray-400 truncate block max-w-[180px]">
                      {exp.dataset_ref.split('/').pop()}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(exp.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(exp);
                        }}
                        aria-label={`Delete ${exp.name}`}
                        className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete experiment"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ArrowRight className="w-4 h-4 text-gray-500" />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
