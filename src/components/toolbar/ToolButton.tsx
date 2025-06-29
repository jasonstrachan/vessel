'use client';

import { Tool } from '@/types';

interface ToolButtonProps {
  tool: Tool;
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

export const ToolButton = ({ tool, icon, label, isActive, onClick }: ToolButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`
        w-12 h-12 rounded border transition-all duration-200 
        flex items-center justify-center group relative
        ${
          isActive
            ? 'bg-[#60a5fa] border-[#60a5fa] text-white'
            : 'bg-[#3a3a3a] border-[#404040] text-[#888888] hover:bg-[#404040] hover:text-white'
        }
      `}
      title={label}
    >
      <span className="text-sm">{icon}</span>
      
      {/* Tooltip */}
      <div className="absolute left-full ml-2 px-2 py-1 bg-[#1a1a1a] text-white text-xs rounded 
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none
                      whitespace-nowrap z-50 border border-[#404040]">
        {label}
      </div>
    </button>
  );
};