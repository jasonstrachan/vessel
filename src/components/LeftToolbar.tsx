import React from 'react';
import { useAppStore } from '../stores/useAppStore';
import { Tool } from '../types';
const LeftToolbar = () => {
  // Force refresh - toolbar black background fix
  const { tools: toolState, setCurrentTool, saveProject, loadProject, toggleModal } = useAppStore();

  const toolGroups = [
    [
      { id: 'new-document' as Tool, label: 'New Document', abbr: 'Nd' },
      { id: 'selection' as Tool, label: 'Selection', abbr: 'Mq' },
    ],
    [
      { id: 'brush' as Tool, label: 'Brush', abbr: 'Br' },
      { id: 'custom' as Tool, label: 'Custom Brush', abbr: 'Cb' },
      { id: 'eraser' as Tool, label: 'Eraser', abbr: 'Er' },
      { id: 'eyedropper' as Tool, label: 'Eyedropper', abbr: 'Ey' },
      { id: 'fill' as Tool, label: 'Fill', abbr: 'Fl' },
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
      try {
        await loadProject();
        
      } catch (error) {
        alert(`Load failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } else if (toolId === 'export' || toolId === 'export-png') {
      toggleModal('export');
    } else if (toolId === 'options') {
      toggleModal('settings');
    } else {
      setCurrentTool(toolId);
    }
  };

  return (
    <div
      className="w-[48px] flex flex-col pt-4 pb-0 border-r"
      style={{
        backgroundColor: '#1A1A1A',
        borderColor: '#242424'
      }}
    >
      {toolGroups.map((group, groupIndex) => (
        <React.Fragment key={groupIndex}>
          {groupIndex > 0 && (
            <div className="h-[2px] bg-[#242424] w-[32px] mx-auto my-2 flex-shrink-0" />
          )}
          {group.map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              title={tool.label}
              className={`w-[48px] h-12 min-h-[40px] mx-auto flex items-center justify-center bg-transparent border-0 appearance-none outline-none mb-1`}
          style={{ 
            color: toolState.currentTool === tool.id ? '#FFFFFF' : '#5A5A61',
            fontFamily: 'IBM Plex Mono, "Courier New", monospace',
            fontSize: '1.1rem',
            fontWeight: 600,
            letterSpacing: '0.02em'
          }}
          onMouseEnter={(e) => {
            if (toolState.currentTool !== tool.id) {
              e.currentTarget.style.color = '#888888';
            }
          }}
          onMouseLeave={(e) => {
            if (toolState.currentTool !== tool.id) {
              e.currentTarget.style.color = '#5A5A61';
            }
          }}
        >
          <span>{tool.abbr}</span>
        </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
};

export default LeftToolbar;
