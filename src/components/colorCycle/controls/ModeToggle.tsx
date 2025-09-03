/**
 * ModeToggle - Clean toggle component for switching between brush and recolor modes
 */

import React, { useState } from 'react';

export interface ModeToggleProps {
  mode: 'brush' | 'recolor';
  onChange: (mode: 'brush' | 'recolor') => void;
  disabled?: boolean;
}

export const ModeToggle: React.FC<ModeToggleProps> = ({
  mode,
  onChange,
  disabled = false
}) => {
  const [isChanging, setIsChanging] = useState(false);

  const handleChange = async (newMode: 'brush' | 'recolor') => {
    if (isChanging || disabled) return;
    
    setIsChanging(true);
    try {
      await onChange(newMode);
    } finally {
      setIsChanging(false);
    }
  };
  return (
    <div className="mode-toggle">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Mode
      </label>
      <div className="flex bg-gray-700 rounded-lg p-1">
        <button
          type="button"
          onClick={() => handleChange('brush')}
          disabled={disabled || isChanging}
          title="Paint with animated color cycling brushes"
          className={`
            flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors
            ${mode === 'brush'
              ? 'bg-blue-600 text-white'
              : 'text-gray-300 hover:text-white hover:bg-gray-600'
            }
            ${disabled || isChanging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {isChanging && mode !== 'brush' ? (
            <div className="flex items-center gap-1">
              <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
              Brush
            </div>
          ) : (
            'Brush'
          )}
        </button>
        <button
          type="button"
          onClick={() => handleChange('recolor')}
          disabled={disabled || isChanging}
          title="Convert layers to animated indexed color"
          className={`
            flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors
            ${mode === 'recolor'
              ? 'bg-green-600 text-white'
              : 'text-gray-300 hover:text-white hover:bg-gray-600'
            }
            ${disabled || isChanging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {isChanging && mode !== 'recolor' ? (
            <div className="flex items-center gap-1">
              <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
              Recolor
            </div>
          ) : (
            'Recolor & Animate'
          )}
        </button>
      </div>
      
      {/* Mode Description */}
      <div className="mt-2 text-xs text-gray-400">
        {mode === 'brush' && (
          <span>Paint with animated color cycling brushes</span>
        )}
        {mode === 'recolor' && (
          <span>Convert layers to animated indexed color</span>
        )}
      </div>
    </div>
  );
};