import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Tool } from '../types';

const LeftToolbar = () => {
  const { tools: toolState, setCurrentTool } = useAppStore();
  
  const tools = [
    { id: 'selection' as Tool, icon: '⬛', label: 'Selection' },
    { id: 'brush' as Tool, icon: '🖌', label: 'Brush' },
    { id: 'eraser' as Tool, icon: '🧽', label: 'Eraser' },
    { id: 'eyedropper' as Tool, icon: '💧', label: 'Eyedropper' },
    { id: 'fill' as Tool, icon: '🪣', label: 'Fill' },
    { id: 'zoom' as Tool, icon: '🔍', label: 'Zoom' },
    { id: 'pan' as Tool, icon: '✋', label: 'Pan' },
  ];

  return (
    <div className="w-12 bg-[#2d2d2d] border-r border-[#404040] flex flex-col py-2">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setCurrentTool(tool.id)}
          title={tool.label}
          className={`w-10 h-10 mx-1 mb-1 flex items-center justify-center text-xs rounded border ${
            toolState.currentTool === tool.id
              ? 'bg-[#505050] border-[#707070]'
              : 'bg-[#353535] border-[#404040] hover:bg-[#404040]'
          }`}
        >
          {tool.icon}
        </button>
      ))}
    </div>
  );
};

export default LeftToolbar;