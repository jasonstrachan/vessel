/**
 * Error boundary for color cycle components
 * Provides graceful error handling and recovery options
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
}

export class ColorCycleErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
      errorId: `cc_error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({
      errorInfo
    });

    // Log error for debugging
    console.error('Color Cycle Error Boundary caught an error:', error, errorInfo);

    // Call custom error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Send error to monitoring service (if available)
    this.reportError(error, errorInfo);
  }

  private reportError = (error: Error, errorInfo: ErrorInfo) => {
    // Could integrate with error reporting service
    const errorReport = {
      id: this.state.errorId,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Log to console for development
    console.error('Color Cycle Error Report:', errorReport);
  };

  private handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    });
  };

  private handleReportBug = () => {
    const issueBody = `
## Error Report

**Error ID:** ${this.state.errorId}
**Error:** ${this.state.error?.message}
**Browser:** ${navigator.userAgent}
**URL:** ${window.location.href}
**Timestamp:** ${new Date().toISOString()}

### Stack Trace
\`\`\`
${this.state.error?.stack}
\`\`\`

### Component Stack
\`\`\`
${this.state.errorInfo?.componentStack}
\`\`\`

### Steps to Reproduce
1. [Describe what you were doing when the error occurred]

### Expected Behavior
[Describe what should have happened]

### Additional Context
[Any additional information about the problem]
    `.trim();

    const githubURL = `https://github.com/user/vessel/issues/new?` +
      `title=${encodeURIComponent(`Color Cycle Error: ${this.state.error?.message}`)}&` +
      `body=${encodeURIComponent(issueBody)}`;

    window.open(githubURL, '_blank');
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div className="color-cycle-error-boundary bg-red-900/20 border border-red-500 rounded-lg p-6 text-white max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white font-bold text-sm">!</span>
            </div>
            <div>
              <h2 className="font-semibold text-lg">Color Cycle Error</h2>
              <p className="text-sm text-gray-300">
                Error ID: <code className="bg-red-800 px-1 py-0.5 rounded text-xs">
                  {this.state.errorId}
                </code>
              </p>
            </div>
          </div>

          <div className="mb-4">
            <p className="text-sm text-gray-200 mb-2">
              Something went wrong with the color cycling feature. This is likely a temporary issue.
            </p>
            
            {this.state.error && (
              <details className="mb-3">
                <summary className="text-sm text-gray-300 cursor-pointer hover:text-white">
                  Show error details
                </summary>
                <div className="mt-2 p-3 bg-red-950 rounded text-xs font-mono">
                  <div className="text-red-300 mb-1">Error:</div>
                  <div className="text-white mb-2">{this.state.error.message}</div>
                  
                  {this.state.error.stack && (
                    <>
                      <div className="text-red-300 mb-1">Stack trace:</div>
                      <pre className="text-gray-300 text-xs overflow-x-auto">
                        {this.state.error.stack}
                      </pre>
                    </>
                  )}
                </div>
              </details>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={this.handleRetry}
              className="w-full px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-white font-medium text-sm transition-colors"
            >
              Try Again
            </button>
            
            <button
              onClick={this.handleReportBug}
              className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded text-white font-medium text-sm transition-colors"
            >
              Report This Bug
            </button>
            
            <div className="text-xs text-gray-400 text-center mt-2">
              You can continue using other features while we work on fixing this issue.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
