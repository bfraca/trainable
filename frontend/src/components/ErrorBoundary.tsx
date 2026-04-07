'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  /** Human-readable name shown in the fallback UI (e.g. "Chat", "Metrics"). */
  panelName?: string;
  /** Optional custom fallback renderer.  Receives the error and a reset fn. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Generic React error boundary that catches render errors in its subtree
 * and shows a "Something went wrong — click to retry" fallback.
 *
 * Usage:
 *   <ErrorBoundary panelName="Chat">
 *     <ChatPanel />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.panelName ? `:${this.props.panelName}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  private handleReset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Custom fallback takes priority
    if (this.props.fallback) {
      return this.props.fallback(error, this.handleReset);
    }

    const label = this.props.panelName ?? 'This panel';

    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full w-full p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-yellow-500" />
        <p className="text-sm text-gray-400">
          <span className="font-medium text-gray-300">{label}</span> encountered an error.
        </p>
        <p className="text-xs text-gray-500 max-w-md break-words">{error.message}</p>
        <button
          onClick={this.handleReset}
          className="mt-2 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-surface-elevated border border-surface-border text-gray-300 hover:bg-surface-hover hover:text-white transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    );
  }
}
