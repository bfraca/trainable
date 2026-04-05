'use client';

import { useState, useRef, useEffect, DragEvent } from 'react';
import {
  X,
  Upload,
  FileText,
  Database,
  FolderOpen,
  Trash2,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import S3FileBrowserModal from './S3FileBrowserModal';

interface CreateModalProps {
  onClose: () => void;
  onCreated: (exp: { id: string; session_id: string }) => void;
}

type DataSource = 'upload' | 's3';
type Phase = 'form' | 'creating' | 'success';

const LOADING_MESSAGES = [
  'Uploading dataset...',
  'Provisioning sandbox...',
  'Initializing experiment...',
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function OrbitalSpinner() {
  return (
    <div className="relative w-20 h-20">
      {/* Outer ring */}
      <div className="absolute inset-0 rounded-full border-2 border-primary-500/20 animate-pulse-ring" />
      {/* Orbiting ring 1 */}
      <div className="absolute inset-1 animate-orbit">
        <div className="w-full h-full rounded-full border-2 border-transparent border-t-primary-400 border-r-primary-400/50" />
      </div>
      {/* Orbiting ring 2 (reverse) */}
      <div className="absolute inset-3 animate-orbit-reverse">
        <div className="w-full h-full rounded-full border-2 border-transparent border-b-primary-300 border-l-primary-300/50" />
      </div>
      {/* Center glow */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-primary-500 shadow-lg shadow-primary-500/50 animate-pulse" />
      </div>
    </div>
  );
}

export default function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [dataSource, setDataSource] = useState<DataSource>('upload');
  const [files, setFiles] = useState<File[]>([]);
  const [s3Path, setS3Path] = useState('');
  const [showS3Browser, setShowS3Browser] = useState(false);
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<{ id: string; session_id: string } | null>(null);

  // Cycle through loading messages
  useEffect(() => {
    if (phase !== 'creating') return;
    const interval = setInterval(() => {
      setLoadingMsgIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [phase]);

  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => !f.name.startsWith('.') && f.size > 0);
    setFiles((prev) => [...prev, ...arr]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (dataSource === 'upload' && files.length === 0) {
      setError('Please upload at least one file');
      return;
    }
    if (dataSource === 's3' && !s3Path.trim()) {
      setError('Please provide an S3 path');
      return;
    }

    setPhase('creating');
    setError('');
    setLoadingMsgIndex(0);

    try {
      let result;
      if (dataSource === 'upload') {
        const formData = new FormData();
        formData.append('name', name.trim());
        formData.append('description', description.trim());
        formData.append('instructions', instructions.trim());
        for (const f of files) {
          const path = (f as any).webkitRelativePath || f.name;
          formData.append('files', f, path);
        }
        result = await api.createExperiment(formData);
      } else {
        const formData = new FormData();
        formData.append('name', name.trim());
        formData.append('description', description.trim());
        formData.append('instructions', instructions.trim());
        formData.append('s3_path', s3Path.trim());
        result = await api.createExperimentFromS3(formData);
      }
      resultRef.current = result;
      setPhase('success');
      // Brief success flash, then navigate
      setTimeout(() => onCreated(result), 900);
    } catch (e: any) {
      setPhase('form');
      setError(e.message || 'Failed to create experiment');
    }
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const isLoading = phase === 'creating' || phase === 'success';

  return (
    <>
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div
          className={`bg-surface-elevated border border-surface-border rounded-2xl w-full flex flex-col overflow-hidden transition-all duration-500 ease-in-out ${
            isLoading ? 'max-w-sm max-h-[280px]' : 'max-w-lg max-h-[90vh] animate-fade-in'
          }`}
        >
          {/* Loading / Success State */}
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 animate-fade-in">
              {phase === 'creating' ? (
                <>
                  <OrbitalSpinner />
                  <div className="mt-6 text-center">
                    <p
                      key={loadingMsgIndex}
                      className="text-sm font-medium text-white animate-fade-in"
                    >
                      {LOADING_MESSAGES[loadingMsgIndex]}
                    </p>
                    <p className="mt-1.5 text-xs text-gray-500">{name}</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center animate-scale-in">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                    </div>
                    <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-emerald-300 animate-pulse" />
                  </div>
                  <div className="mt-4 text-center animate-slide-up">
                    <p className="text-sm font-medium text-white">Experiment created!</p>
                    <p className="mt-1 text-xs text-gray-500">Opening workspace...</p>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border shrink-0">
                <h2 className="text-lg font-semibold text-white">New Experiment</h2>
                <button
                  onClick={onClose}
                  className="p-1 hover:bg-surface-hover rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                {/* Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Titanic Survival Analysis"
                    className="w-full px-3 py-2 bg-surface border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Description
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description of the experiment"
                    className="w-full px-3 py-2 bg-surface border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500"
                  />
                </div>

                {/* Data Source Toggle */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Dataset</label>
                  <div className="flex rounded-lg border border-surface-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setDataSource('upload')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                        dataSource === 'upload'
                          ? 'bg-primary-600 text-white'
                          : 'bg-surface text-gray-400 hover:text-white'
                      }`}
                    >
                      <Upload className="w-4 h-4" />
                      Upload
                    </button>
                    <button
                      type="button"
                      onClick={() => setDataSource('s3')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium transition-colors ${
                        dataSource === 's3'
                          ? 'bg-primary-600 text-white'
                          : 'bg-surface text-gray-400 hover:text-white'
                      }`}
                    >
                      <Database className="w-4 h-4" />
                      S3 Path
                    </button>
                  </div>
                </div>

                {/* Upload or S3 */}
                {dataSource === 'upload' ? (
                  <div className="space-y-3">
                    {/* Hidden inputs */}
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.parquet,.tsv,.json,.xlsx,.xls,.txt"
                      multiple
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                      className="hidden"
                    />
                    <input
                      ref={folderRef}
                      type="file"
                      // @ts-ignore — webkitdirectory is non-standard but widely supported
                      webkitdirectory=""
                      directory=""
                      multiple
                      onChange={(e) => e.target.files && addFiles(e.target.files)}
                      className="hidden"
                    />

                    {/* Drop zone */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={handleDrop}
                      className={`flex flex-col items-center justify-center gap-2 px-4 py-6 border-2 border-dashed rounded-lg transition-colors ${
                        dragging
                          ? 'border-primary-500 bg-primary-500/10'
                          : 'border-surface-border hover:border-gray-500'
                      }`}
                    >
                      <Upload
                        className={`w-6 h-6 ${dragging ? 'text-primary-400' : 'text-gray-500'}`}
                      />
                      <p className="text-sm text-gray-400 text-center">
                        Drag & drop files here, or
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => fileRef.current?.click()}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-neutral-700 hover:bg-neutral-600 rounded-lg transition-colors"
                        >
                          Select Files
                        </button>
                        <button
                          type="button"
                          onClick={() => folderRef.current?.click()}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-neutral-700 hover:bg-neutral-600 rounded-lg transition-colors flex items-center gap-1"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Select Folder
                        </button>
                      </div>
                    </div>

                    {/* File list */}
                    {files.length > 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs text-gray-500 px-1">
                          <span>
                            {files.length} file{files.length !== 1 ? 's' : ''}
                          </span>
                          <span>{formatSize(totalSize)}</span>
                        </div>
                        <div className="max-h-32 overflow-y-auto space-y-0.5 rounded-lg border border-surface-border">
                          {files.map((f, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover text-sm"
                            >
                              <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                              <span className="text-gray-300 truncate flex-1">
                                {(f as any).webkitRelativePath || f.name}
                              </span>
                              <span className="text-gray-600 text-xs shrink-0">
                                {formatSize(f.size)}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeFile(i)}
                                className="p-0.5 hover:bg-red-500/20 rounded transition-colors shrink-0"
                              >
                                <Trash2 className="w-3 h-3 text-red-400" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={s3Path}
                        onChange={(e) => setS3Path(e.target.value)}
                        placeholder="s3://bucket/path/to/dataset.csv"
                        className="flex-1 px-3 py-2 bg-surface border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowS3Browser(true)}
                        className="px-3 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg text-sm font-medium transition-colors"
                      >
                        Browse
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">
                      Connect to any S3-compatible storage (AWS S3, MinIO, LocalStack)
                    </p>
                  </div>
                )}

                {/* Instructions */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Instructions <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                  <textarea
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Tell the AI what to focus on, e.g. 'Predict survival rate. Focus on feature interactions between class and age.'"
                    rows={3}
                    className="w-full px-3 py-2 bg-surface border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 resize-none"
                  />
                </div>

                {/* Error */}
                {error && <p className="text-sm text-red-400">{error}</p>}

                {/* Submit */}
                <button
                  type="submit"
                  className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium transition-colors"
                >
                  Create Experiment
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <S3FileBrowserModal
        isOpen={showS3Browser}
        onClose={() => setShowS3Browser(false)}
        onSelect={(path) => {
          setS3Path(path);
          setShowS3Browser(false);
        }}
        initialBucket="datasets"
      />
    </>
  );
}
