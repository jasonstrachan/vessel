'use client';

import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';
import { ToolButton } from './ToolButton';

export const LeftToolbar = () => {
  const { currentTool, setCurrentTool } = useAppStore();

  const tools = [
    { tool: Tool.SELECT, icon: '⚏', label: 'Select' },
    { tool: Tool.BRUSH, icon: '◐', label: 'Brush' },
    { tool: Tool.BRUSH_SELECT, icon: '⛶', label: 'Brush Select' },
    { tool: Tool.FILL, icon: '●', label: 'Fill' },
    { tool: Tool.ERASER, icon: '◯', label: 'Eraser' },
  ];

  return (
    <div className="w-16 bg-[#2a2a2a] border-r border-[#404040] flex flex-col items-center py-2 gap-2">
      {tools.map(({ tool, icon, label }) => (
        <ToolButton
          key={tool}
          tool={tool}
          icon={icon}
          label={label}
          isActive={currentTool === tool}
          onClick={() => setCurrentTool(tool)}
        />
      ))}
    </div>
  );
};