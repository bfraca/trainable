'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Folder,
  FolderOpen,
  File,
  ChevronRight,
  ChevronDown,
  Database,
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface S3File {
  name: string;
  key: string;
  size: number;
  last_modified: string;
}

interface S3Folder {
  name: string;
  prefix: string;
}

interface S3ListResponse {
  bucket: string;
  prefix: string;
  folders: S3Folder[];
  files: S3File[];
}

interface S3FileBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialBucket?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function S3FileBrowserModal({
  isOpen,
  onClose,
  onSelect,
  initialBucket = 'datasets',
}: S3FileBrowserModalProps) {
  const [buckets, setBuckets] = useState<string[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>(initialBucket);
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [folders, setFolders] = useState<S3Folder[]>([]);
  const [files, setFiles] = useState<S3File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{
    type: 'folder' | 'file';
    path: string;
  } | null>(null);

  const apiUrl = ''; // Use relative URLs — Next.js rewrites /api/* to backend

  const fetchBuckets = useCallback(async () => {
    try {
      const response = await fetch(`${apiUrl}/api/s3/buckets`);
      if (!response.ok) throw new Error('Failed to fetch buckets');
      const data = await response.json();
      setBuckets(data.buckets || []);
    } catch (err) {
      console.error('Error fetching buckets:', err);
      // Use default bucket if fetch fails
      setBuckets([initialBucket]);
    }
  }, [apiUrl, initialBucket]);

  const fetchContents = useCallback(
    async (bucket: string, prefix: string) => {
      setLoading(true);
      setError(null);
      try {
        const url = `${apiUrl}/api/s3/list?bucket=${encodeURIComponent(bucket)}&prefix=${encodeURIComponent(prefix)}`;
        const response = await fetch(url);
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to fetch S3 contents');
        }
        const data: S3ListResponse = await response.json();
        setFolders(data.folders || []);
        setFiles(data.files || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setFolders([]);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    },
    [apiUrl],
  );

  // Fetch buckets on mount
  useEffect(() => {
    if (isOpen) {
      fetchBuckets();
    }
  }, [isOpen, fetchBuckets]);

  // Fetch contents when bucket or prefix changes
  useEffect(() => {
    if (isOpen && selectedBucket) {
      fetchContents(selectedBucket, currentPrefix);
    }
  }, [isOpen, selectedBucket, currentPrefix, fetchContents]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentPrefix('');
      setSelectedItem(null);
      setError(null);
    }
  }, [isOpen]);

  const handleFolderClick = (folder: S3Folder) => {
    setCurrentPrefix(folder.prefix);
    setSelectedItem(null);
  };

  const handleFileClick = (file: S3File) => {
    setSelectedItem({ type: 'file', path: `s3://${selectedBucket}/${file.key}` });
  };

  const handleFolderSelect = (folder: S3Folder) => {
    setSelectedItem({ type: 'folder', path: `s3://${selectedBucket}/${folder.prefix}` });
  };

  const handleNavigateUp = () => {
    if (!currentPrefix) return;
    const parts = currentPrefix.split('/').filter(Boolean);
    parts.pop();
    setCurrentPrefix(parts.length > 0 ? parts.join('/') + '/' : '');
    setSelectedItem(null);
  };

  const handleBucketChange = (bucket: string) => {
    setSelectedBucket(bucket);
    setCurrentPrefix('');
    setSelectedItem(null);
  };

  const handleConfirmSelection = () => {
    if (selectedItem) {
      onSelect(selectedItem.path);
      onClose();
    }
  };

  const handleSelectCurrentFolder = () => {
    const path = currentPrefix
      ? `s3://${selectedBucket}/${currentPrefix}`
      : `s3://${selectedBucket}/`;
    onSelect(path);
    onClose();
  };

  if (!isOpen) return null;

  const breadcrumbs = currentPrefix.split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-2xl bg-surface-elevated border border-surface-border rounded-xl shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-surface-border">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-primary-900/50 rounded-lg flex items-center justify-center mr-3">
                <Database className="w-4 h-4 text-primary-400" />
              </div>
              <h2 className="text-lg font-semibold text-white">Browse S3</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Bucket selector and breadcrumbs */}
          <div className="px-6 py-3 border-b border-surface-border bg-neutral-800/50">
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedBucket}
                onChange={(e) => handleBucketChange(e.target.value)}
                className="px-3 py-1.5 text-sm bg-neutral-700 border border-neutral-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {buckets.map((bucket) => (
                  <option key={bucket} value={bucket}>
                    {bucket}
                  </option>
                ))}
              </select>

              <div className="flex items-center text-sm text-gray-400">
                <button
                  onClick={() => {
                    setCurrentPrefix('');
                    setSelectedItem(null);
                  }}
                  className="hover:text-white transition-colors"
                >
                  /
                </button>
                {breadcrumbs.map((crumb, idx) => (
                  <span key={idx} className="flex items-center">
                    <ChevronRight className="w-4 h-4 mx-1" />
                    <button
                      onClick={() => {
                        const newPrefix = breadcrumbs.slice(0, idx + 1).join('/') + '/';
                        setCurrentPrefix(newPrefix);
                        setSelectedItem(null);
                      }}
                      className="hover:text-white transition-colors"
                    >
                      {crumb}
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Content area */}
          <div className="h-80 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Loader2 className="w-8 h-8 text-primary-400 animate-spin mb-3" />
                <p className="text-sm text-gray-400">Loading...</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full px-6">
                <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
                <p className="text-sm text-red-400 text-center mb-4">{error}</p>
                <button
                  onClick={() => fetchContents(selectedBucket, currentPrefix)}
                  className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-neutral-700 hover:bg-neutral-600 rounded-lg transition-colors"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </button>
              </div>
            ) : folders.length === 0 && files.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full">
                <Folder className="w-10 h-10 text-gray-500 mb-3" />
                <p className="text-sm text-gray-400">This folder is empty</p>
                {currentPrefix && (
                  <button
                    onClick={handleSelectCurrentFolder}
                    className="mt-4 inline-flex items-center px-4 py-2 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Select this folder anyway
                  </button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-surface-border">
                {/* Navigate up + select current folder */}
                {currentPrefix && (
                  <>
                    <button
                      onClick={handleNavigateUp}
                      className="w-full flex items-center px-6 py-3 hover:bg-neutral-800 transition-colors text-left"
                    >
                      <ArrowLeft className="w-4 h-4 mr-3 text-gray-400" />
                      <span className="text-sm text-gray-400">..</span>
                    </button>
                    <button
                      onClick={handleSelectCurrentFolder}
                      className="w-full flex items-center px-6 py-2.5 bg-primary-900/20 hover:bg-primary-900/40 border-b border-primary-800/30 transition-colors text-left"
                    >
                      <FolderOpen className="w-4 h-4 mr-3 text-primary-400 flex-shrink-0" />
                      <span className="text-sm text-primary-300">Select this folder</span>
                      <span className="ml-2 text-xs text-primary-500 truncate">
                        {currentPrefix}
                      </span>
                    </button>
                  </>
                )}

                {/* Folders */}
                {folders.map((folder) => {
                  const folderPath = `s3://${selectedBucket}/${folder.prefix}`;
                  const isSelected = selectedItem?.path === folderPath;
                  return (
                    <div
                      key={folder.prefix}
                      className={`flex items-center px-6 py-3 hover:bg-neutral-800 transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary-900/30 hover:bg-primary-900/40' : ''
                      }`}
                    >
                      <button
                        onClick={() => handleFolderClick(folder)}
                        className="flex items-center flex-1 min-w-0"
                      >
                        <FolderOpen className="w-4 h-4 mr-3 text-amber-400 flex-shrink-0" />
                        <span className="text-sm text-white truncate">{folder.name}/</span>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFolderSelect(folder);
                        }}
                        className={`ml-2 px-2 py-1 text-xs rounded transition-colors ${
                          isSelected
                            ? 'bg-primary-600 text-white'
                            : 'text-gray-400 hover:text-white hover:bg-neutral-700'
                        }`}
                      >
                        {isSelected ? 'Selected' : 'Select'}
                      </button>
                    </div>
                  );
                })}

                {/* Files */}
                {files.map((file) => {
                  const filePath = `s3://${selectedBucket}/${file.key}`;
                  const isSelected = selectedItem?.path === filePath;
                  return (
                    <button
                      key={file.key}
                      onClick={() => handleFileClick(file)}
                      className={`w-full flex items-center px-6 py-3 hover:bg-neutral-800 transition-colors text-left ${
                        isSelected ? 'bg-primary-900/30 hover:bg-primary-900/40' : ''
                      }`}
                    >
                      <File className="w-4 h-4 mr-3 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-white truncate flex-1">{file.name}</span>
                      <span className="text-xs text-gray-500 ml-2">
                        {formatFileSize(file.size)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-surface-border bg-neutral-800/50">
            <div className="text-sm text-gray-400 truncate max-w-[60%]">
              {selectedItem ? (
                <span className="text-primary-400">{selectedItem.path}</span>
              ) : (
                <span>Select a file or folder</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSelection}
                disabled={!selectedItem}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Select
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
