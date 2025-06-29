'use client';

import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';
import { ToolButton } from './ToolButton';
import { HSVColorPicker } from './HSVColorPicker';
import { BrushSettings } from './BrushSettings';
import { LayerPanel } from './LayerPanel';

export const Toolbar = () => {
  const { currentTool, setCurrentTool, brushSettings, setBrushSettings } = useAppStore();

  const tools = [
    { tool: Tool.BRUSH, icon: '◐', label: 'Brush' },
    { tool: Tool.PIXEL_BRUSH, icon: '▣', label: 'Pixel Brush' },
    { tool: Tool.ERASER, icon: '◯', label: 'Eraser' },
    { tool: Tool.FILL, icon: '●', label: 'Fill' },
    { tool: Tool.SELECT, icon: '⚏', label: 'Select' },
    { tool: Tool.CLEAR, icon: '✕', label: 'Clear' },
  ];

  return (
    <div className="w-64 bg-slate-900 border-r border-slate-700/50 flex flex-col shadow-xl">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-slate-100 font-semibold text-sm tracking-wide">TOOLS</h2>
          <HSVColorPicker
            color={brushSettings.color}
            onChange={(color) => setBrushSettings({ color })}
          />
        </div>
        
        {/* Tool Grid */}
        <div className="grid grid-cols-3 gap-2">
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
      </div>

      {/* Brush Settings */}
      <div className="flex-1 overflow-y-auto">
        <BrushSettings />
      </div>
    </div>
  );
};