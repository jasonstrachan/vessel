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
      <button
        type="button"
        onClick={() => {
          handleChange('recolor');
        }}
        disabled={disabled || isChanging}
        title={
          mode === 'recolor'
            ? 'Toggle animation for Recolor mode'
            : 'Convert selected layer to Recolor and animate'
        }
        className={`
          w-full px-3 py-2 text-sm font-medium rounded-md transition-colors
          ${mode === 'recolor'
            ? 'bg-[#D9D9D9] text-[#31313A]'
            : 'bg-[#3A3A3A] text-[#D9D9D9] hover:bg-[#454545]'
          }
          ${disabled || isChanging ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {isChanging && mode !== 'recolor' ? (
          <div className="flex items-center gap-2 justify-center">
            <div className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
            Recolor and animate
          </div>
        ) : (
          'Recolor and animate'
        )}
      </button>
    </div>
  );
};
