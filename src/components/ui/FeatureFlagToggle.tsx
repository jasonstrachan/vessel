/**
 * FeatureFlagToggle - UI component for toggling feature flags during development
 */

import React, { useState, useEffect } from 'react';
import { featureFlags, setFeatureFlag, resetFeatureFlags } from '../../config/featureFlags';
import CustomSwitch from './CustomSwitch';

declare global {
  interface WindowEventMap {
    'feature-flag-changed': CustomEvent;
  }
}

interface FeatureFlagToggleProps {
  className?: string;
  showDebugFlags?: boolean;
}

export const FeatureFlagToggle: React.FC<FeatureFlagToggleProps> = ({ 
  className = '', 
  showDebugFlags = false 
}) => {
  const [flags, setFlags] = useState(featureFlags);
  const [isExpanded, setIsExpanded] = useState(false);

  // Listen for feature flag changes
  useEffect(() => {
    const handleFlagChange = () => {
      setFlags({ ...featureFlags });
    };

    window.addEventListener('feature-flag-changed', handleFlagChange);
    return () => {
      window.removeEventListener('feature-flag-changed', handleFlagChange);
    };
  }, []);

  const handleToggle = (flag: keyof typeof featureFlags, value: boolean) => {
    setFeatureFlag(flag, value);
    setFlags({ ...featureFlags });
  };

  const handleReset = () => {
    resetFeatureFlags();
    setFlags({ ...featureFlags });
  };

  // Don't show debug flags unless explicitly enabled
  const visibleFlags = (showDebugFlags 
    ? Object.keys(flags)
    : Object.keys(flags).filter(key => !key.includes('log') && !key.includes('Debug')))
    .sort();

  return (
    <div className={`feature-flags-toggle ${className}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="feature-flags-header"
        style={{
          padding: '8px 12px',
          background: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          fontFamily: 'monospace',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          width: '100%',
          textAlign: 'left'
        }}
      >
        <span style={{ 
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', 
          transition: 'transform 0.2s' 
        }}>
          ▶
        </span>
        Feature Flags ({flags.useColorCycleWorker ? 'Worker' : 'Main Thread'} · {flags.useCanvas2DColorCycle ? 'Canvas2D' : 'WebGL'})
      </button>

      {isExpanded && (
        <div 
          className="feature-flags-content"
          style={{
            background: '#2a2a2a',
            padding: '12px',
            borderRadius: '0 0 4px 4px',
            marginTop: '4px'
          }}
        >
          {visibleFlags.map(key => {
            const flagKey = key as keyof typeof featureFlags;
            const value = flags[flagKey];
            
            if (typeof value !== 'boolean') return null;

            return (
              <div 
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid #444'
                }}
              >
                <label 
                  style={{
                    fontSize: '12px',
                    color: '#ccc',
                    flex: 1
                  }}
                >
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </label>
                <CustomSwitch
                  checked={value}
                  onChange={(checked) => handleToggle(flagKey, checked)}
                />
              </div>
            );
          })}

          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={handleReset}
              style={{
                padding: '6px 12px',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Reset to Defaults
            </button>
            
            {/* Performance comparison button */}
            <button
              onClick={() => {
                // Toggle between implementations to test
                const currentImpl = flags.useCanvas2DColorCycle;
                setFeatureFlag('useCanvas2DColorCycle', !currentImpl);
                
              }}
              style={{
                padding: '6px 12px',
                background: '#4a7c59',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Toggle Implementation
            </button>

            <button
              onClick={() => {
                const current = flags.useColorCycleWorker;
                setFeatureFlag('useColorCycleWorker', !current);
              }}
              style={{
                padding: '6px 12px',
                background: '#3c5d8c',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              Toggle Worker Mode
            </button>
          </div>

          {/* Implementation status indicator */}
          <div style={{ 
            marginTop: '12px', 
            padding: '8px', 
            background: flags.useColorCycleWorker ? '#22384f' : (flags.useCanvas2DColorCycle ? '#2a4d3a' : '#4d3a2a'),
            borderRadius: '4px',
            fontSize: '11px',
            color: '#ccc'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>Rendering: <strong>{flags.useCanvas2DColorCycle ? 'Canvas2D' : 'WebGL'}</strong></div>
              <div>Compositor: <strong>{flags.useColorCycleWorker ? 'Worker' : 'Main Thread'}</strong></div>
            </div>
            <div style={{ marginTop: '4px', opacity: 0.7 }}>
              {flags.useCanvas2DColorCycle 
                ? '✓ Better compatibility, no WebGL required'
                : '✓ Hardware accelerated, better for complex gradients'}
              <br />
              {flags.useColorCycleWorker
                ? 'Worker isolates CC animation from UI thread'
                : 'Main thread handles CC animation (legacy)'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
