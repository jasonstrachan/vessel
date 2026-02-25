'use client';

import React, { ErrorInfo } from 'react';

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

const isProduction = process.env.NODE_ENV === 'production';

class ProductionErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      // Best-effort logging without depending on store/state
      console.error('[global-error-boundary] Caught error', error, info);
    } catch {}
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999999
        }}>
          <div style={{ maxWidth: 560, padding: 16, border: '1px solid #933', borderRadius: 8, background: '#1b0f0f' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Vessel crashed</div>
            <div style={{ opacity: 0.9, marginBottom: 8 }}>An error occurred and was caught by the global error boundary.</div>
            <code style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.message || 'Unknown error'}</code>
            <div style={{ marginTop: 12, opacity: 0.8, fontSize: 12 }}>Check the console for details tagged with [global-error-boundary] or [global-error].</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function DevelopmentPassThrough({ children }: Props) {
  return <>{children}</>;
}

export default function GlobalErrorBoundary(props: Props) {
  if (isProduction) {
    return <ProductionErrorBoundary {...props} />;
  }
  return <DevelopmentPassThrough {...props} />;
}
