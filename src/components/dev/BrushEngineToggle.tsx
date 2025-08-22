/**
 * Development component for toggling between brush engine implementations
 * Only visible in development mode
 */

import React, { useState, useEffect } from 'react';
import { 
  toggleBrushEngineImplementation, 
  getBrushEngineStatus 
} from '@/hooks/useBrushEngineAdapter';

export const BrushEngineToggle: React.FC = () => {
  const [status, setStatus] = useState<ReturnType<typeof getBrushEngineStatus> | null>(null);
  
  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  // Initialize status after mount to avoid hydration mismatch
  useEffect(() => {
    setStatus(getBrushEngineStatus());
  }, []);
  
  const handleToggle = () => {
    const newValue = toggleBrushEngineImplementation();
    // Update status but note that page reload is needed
    setStatus(prev => prev ? { ...prev, pendingImplementation: newValue ? 'modular' : 'monolithic' } : null);
  };
  
  const handleReload = () => {
    window.location.reload();
  };
  
  // Don't render until status is loaded
  if (!status) {
    return null;
  }
  
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      padding: '12px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      zIndex: 9999,
      minWidth: '200px'
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        🔧 Brush Engine
      </div>
      
      <div style={{ marginBottom: '8px' }}>
        Current: <span style={{
          color: status.implementation === 'modular' ? '#4ade80' : '#fbbf24',
          fontWeight: 'bold'
        }}>
          {status.implementation.toUpperCase()}
        </span>
      </div>
      
      {status.pendingImplementation && status.pendingImplementation !== status.implementation && (
        <div style={{ 
          marginBottom: '8px',
          padding: '4px',
          background: 'rgba(59, 130, 246, 0.2)',
          borderRadius: '4px'
        }}>
          Pending: {status.pendingImplementation.toUpperCase()}
          <button
            onClick={handleReload}
            style={{
              marginLeft: '8px',
              padding: '2px 6px',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '10px'
            }}
          >
            Reload
          </button>
        </div>
      )}
      
      <button
        onClick={handleToggle}
        style={{
          width: '100%',
          padding: '6px',
          background: status.implementation === 'modular' ? '#dc2626' : '#059669',
          border: 'none',
          borderRadius: '4px',
          color: 'white',
          cursor: 'pointer',
          fontWeight: 'bold',
          fontSize: '11px'
        }}
      >
        Switch to {status.implementation === 'modular' ? 'MONOLITHIC' : 'MODULAR'}
      </button>
      
      <div style={{ 
        marginTop: '8px',
        fontSize: '10px',
        opacity: 0.7
      }}>
        {status.environmentFlag && (
          <div>Env: {status.environmentFlag}</div>
        )}
        {status.localStorageFlag && (
          <div>Local: {status.localStorageFlag}</div>
        )}
      </div>
    </div>
  );
};

/**
 * Performance comparison component
 */
export const BrushEnginePerformance: React.FC = () => {
  const [metrics, setMetrics] = useState<{
    strokeTime?: number;
    stampCount?: number;
    memoryUsage?: number;
  }>({});
  
  // Only render in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  useEffect(() => {
    // Listen for performance metrics from brush engine
    const handleMetrics = (event: CustomEvent) => {
      setMetrics(event.detail);
    };
    
    window.addEventListener('brush-performance' as any, handleMetrics);
    return () => window.removeEventListener('brush-performance' as any, handleMetrics);
  }, []);
  
  if (Object.keys(metrics).length === 0) {
    return null;
  }
  
  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: 20,
      padding: '12px',
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      borderRadius: '8px',
      fontSize: '11px',
      fontFamily: 'monospace',
      zIndex: 9999
    }}>
      <div style={{ marginBottom: '8px', fontWeight: 'bold' }}>
        📊 Performance
      </div>
      
      {metrics.strokeTime && (
        <div>Stroke: {metrics.strokeTime.toFixed(2)}ms</div>
      )}
      {metrics.stampCount && (
        <div>Stamps: {metrics.stampCount}</div>
      )}
      {metrics.memoryUsage && (
        <div>Memory: {(metrics.memoryUsage / 1024 / 1024).toFixed(1)}MB</div>
      )}
    </div>
  );
};