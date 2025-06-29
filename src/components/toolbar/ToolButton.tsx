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
        p-3 rounded-lg border transition-all duration-200 
        flex flex-col items-center gap-1 group relative
        ${
          isActive
            ? 'bg-slate-500 border-slate-400 text-white'
            : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600 hover:border-slate-500'
        }
      `}
      title={label}
    >
      <span className="text-lg">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
      
      {/* Tooltip */}
      <div className="absolute left-full ml-2 px-2 py-1 bg-slate-900 text-white text-xs rounded 
                      opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none
                      whitespace-nowrap z-50">
        {label}
      </div>
    </button>
  );
};