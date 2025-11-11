"use client";

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';
import { useToolSwitcher } from '@/utils/toolSwitch';
const toolShortcuts: Partial<Record<Tool, { aria: string; display: string }>> = {
  brush: { aria: 'KeyB', display: 'B' },
  custom: { aria: 'KeyU', display: 'U' },
  eraser: { aria: 'KeyE', display: 'E' },
  selection: { aria: 'KeyV', display: 'V' },
  eyedropper: { aria: 'KeyI', display: 'I' },
  'color-picker': { aria: 'Shift+KeyC', display: 'Shift+C' },
  fill: { aria: 'KeyG', display: 'G' },
  'color-adjust': { aria: 'KeyK', display: 'K' },
  crop: { aria: 'KeyC', display: 'C' },
  'new-document': { aria: 'Control+KeyN', display: 'Ctrl+N' },
  save: { aria: 'Control+KeyS', display: 'Ctrl+S' },
  load: { aria: 'Control+KeyO', display: 'Ctrl+O' },
  export: { aria: 'Control+Shift+KeyE', display: 'Ctrl+Shift+E' },
  options: { aria: 'Control+Comma', display: 'Ctrl+,' },
};

const LeftToolbar = () => {
  // Force refresh - toolbar black background fix
  const { tools: toolState, saveProject, toggleModal } = useAppStore();
  const switchTool = useToolSwitcher();

  const baseButtonStyle: React.CSSProperties = {
    fontFamily: 'IBM Plex Mono, "Courier New", monospace',
    fontSize: '0.95rem',
    fontWeight: 600,
    letterSpacing: '0.02em',
    border: '1px solid transparent',
    transition: 'background-color 0.15s ease, color 0.15s ease',
  };

  const toolGroups = [
    [
      { id: 'new-document' as Tool, label: 'New Document', abbr: 'Dc' },
      { id: 'selection' as Tool, label: 'Selection', abbr: 'Mq' },
    ],
    [
      { id: 'brush' as Tool, label: 'Brush', abbr: 'Br' },
      { id: 'custom' as Tool, label: 'Custom Brush', abbr: 'Cb' },
      { id: 'eraser' as Tool, label: 'Eraser', abbr: 'Er' },
      { id: 'eyedropper' as Tool, label: 'Eyedropper', abbr: 'Ey' },
      { id: 'color-picker' as Tool, label: 'Color Picker', abbr: 'Cp' },
      { id: 'fill' as Tool, label: 'Fill', abbr: 'Fl' },
      { id: 'color-adjust' as Tool, label: 'Hue/Sat', abbr: 'Hs' },
      { id: 'crop' as Tool, label: 'Crop', abbr: 'Cr' },
    ],
    [
      { id: 'save' as Tool, label: 'Save File', abbr: 'Sv' },
      { id: 'load' as Tool, label: 'Load File', abbr: 'Ld' },
      { id: 'export' as Tool, label: 'Export', abbr: 'Ex' },
      { id: 'options' as Tool, label: 'Options', abbr: 'Op' },
    ],
  ];

  const handleToolClick = async (toolId: Tool) => {
    if (toolId === 'new-document') {
      toggleModal('document');
    } else if (toolId === 'save') {
      try {
        
        await saveProject();
      } catch (error) {
        alert(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (toolId === 'load') {
      toggleModal('loadProject');
    } else if (toolId === 'export' || toolId === 'export-png') {
      toggleModal('export');
    } else if (toolId === 'options') {
      toggleModal('settings');
    } else {
      await switchTool(toolId);
    }
  };

  return (
    <div
      className="w-[48px] flex flex-col pt-4 pb-0 border-r"
      style={{
        backgroundColor: '#1A1A1A',
        borderColor: '#242424'
      }}
      role="toolbar"
      aria-label="Primary tool selection"
    >
      {toolGroups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 1 && (
            <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
          )}
          {group.map((tool, toolIndex) => {
            const isActive = toolState.currentTool === tool.id;

            return (
              <React.Fragment key={tool.id}>
                <button
                  onClick={() => handleToolClick(tool.id)}
                  title={tool.label}
                  aria-label={tool.label}
                  aria-pressed={isActive}
                  aria-keyshortcuts={toolShortcuts[tool.id]?.aria}
                  data-shortcut={toolShortcuts[tool.id]?.display}
                  type="button"
                  className={`w-[44px] h-10 min-h-[36px] mx-auto flex items-center justify-center bg-transparent border-0 appearance-none outline-none mb-1`}
                  style={baseButtonStyle}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: isActive ? '1px 3px' : 0,
                      color: isActive ? '#1A1A1A' : '#FFFFFF',
                      backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                      boxShadow: isActive ? '0 0 0 1px #FFFFFF' : 'none',
                      lineHeight: 1.2,
                    }}
                  >
                    {tool.abbr}
                  </span>
                </button>
                {groupIndex === 0 && toolIndex === 0 && (
                  <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
                )}
              </React.Fragment>
            );
          })}
          {groupIndex === toolGroups.length - 1 && (
            <div className="h-[2px] w-full my-2 flex-shrink-0" style={{ backgroundColor: '#D9D9D9' }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

export default LeftToolbar;
