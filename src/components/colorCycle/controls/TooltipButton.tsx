/**
 * TooltipButton - Button with hover tooltip for improved UX
 */

import React, { useState } from 'react';

interface TooltipButtonProps {
  onClick: () => void;
  disabled?: boolean;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

export const TooltipButton: React.FC<TooltipButtonProps> = ({
  onClick,
  disabled = false,
  tooltip,
  children,
  className = '',
  variant = 'secondary'
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const baseClasses = 'relative inline-flex items-center justify-center px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500 disabled:bg-gray-600',
    secondary: 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 focus:ring-gray-500 disabled:bg-gray-800 disabled:text-gray-500',
    danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 disabled:bg-gray-600'
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={`${baseClasses} ${variantClasses[variant]} ${className} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
      >
        {children}
      </button>
      
      {/* Tooltip */}
      {showTooltip && tooltip && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-50">
          <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap shadow-lg border border-gray-700">
            {tooltip}
            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
          </div>
        </div>
      )}
    </div>
  );
};