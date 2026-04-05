'use client';

import { FileText, Image, Database, Cpu, BarChart } from 'lucide-react';
import { Artifact } from '@/lib/types';

const TYPE_ICONS: Record<string, typeof FileText> = {
  report: FileText,
  chart: Image,
  dataset: Database,
  model: Cpu,
  metrics: BarChart,
};

const STAGE_COLORS: Record<string, string> = {
  eda: 'text-blue-400',
  prep: 'text-amber-400',
  train: 'text-green-400',
};

interface FilesTabProps {
  artifacts: Artifact[];
}

export default function FilesTab({ artifacts }: FilesTabProps) {
  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500">
        <Database className="w-12 h-12 mb-3 text-gray-600" />
        <p className="text-sm">Artifacts will appear here as the agent generates them</p>
      </div>
    );
  }

  // Group by stage
  const grouped = artifacts.reduce(
    (acc, a) => {
      acc[a.stage] = acc[a.stage] || [];
      acc[a.stage].push(a);
      return acc;
    },
    {} as Record<string, Artifact[]>,
  );

  return (
    <div className="p-4 space-y-4">
      {Object.entries(grouped).map(([stage, items]) => (
        <div key={stage}>
          <h3
            className={`text-xs font-semibold uppercase tracking-wider mb-2 ${STAGE_COLORS[stage] || 'text-gray-400'}`}
          >
            {stage}
          </h3>
          <div className="space-y-1">
            {items.map((artifact) => {
              const Icon = TYPE_ICONS[artifact.artifact_type] || FileText;
              return (
                <div
                  key={artifact.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer"
                >
                  <Icon className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-300 truncate flex-1">{artifact.name}</span>
                  <span className="text-xs text-gray-600">{artifact.artifact_type}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
