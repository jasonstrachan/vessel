'use client';

import React, { useEffect } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import { DocumentModal } from '../components/modals/DocumentModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useAppStore } from '../stores/useAppStore';
import { autosaveService } from '../utils/autosave';

// Import debug utilities in development
if (process.env.NODE_ENV === 'development') {
  import('../utils/debugUtils');
}

export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  const { saveProject, loadProject, ui, toggleModal, autosave } = useAppStore();

  // Load settings from localStorage on initial mount only
  useEffect(() => {
    const savedSettings = localStorage.getItem('tinybrush-settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);
        const store = useAppStore.getState();
        
        // Load autosave settings
        if (settings.autosave) {
          store.setAutosaveEnabled(settings.autosave.isEnabled);
          store.setAutosaveInterval(settings.autosave.interval);
        }
        
        // Load canvas settings
        if (settings.canvas) {
          if (typeof settings.canvas.showGrid === 'boolean' && settings.canvas.showGrid !== store.canvas.showGrid) {
            store.toggleGrid();
          }
          if (typeof settings.canvas.showRulers === 'boolean' && settings.canvas.showRulers !== store.canvas.showRulers) {
            store.toggleRulers();
          }
        }
        
        // Load history settings
        if (settings.history) {
          if (settings.history.maxHistorySize) {
            store.setHistorySize(settings.history.maxHistorySize);
          }
        }
      } catch (error) {
        console.warn('Failed to load settings from localStorage:', error);
      }
    }
  }, []); // Only run once on mount

  // Initialize/manage autosave service
  useEffect(() => {
    // Cleanup on unmount
    return () => {
      autosaveService.stop();
    };
  }, []);

  // Watch for autosave settings changes
  useEffect(() => {
    if (autosave.isEnabled) {
      autosaveService.setInterval(autosave.interval);
      autosaveService.start();
    } else {
      autosaveService.stop();
    }
  }, [autosave.isEnabled, autosave.interval]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default behavior for our shortcuts
      if ((event.ctrlKey || event.metaKey) && (event.key === 's' || event.key === 'o')) {
        event.preventDefault();
        
        if (event.key === 's') {
          // Ctrl+S or Cmd+S for save
          saveProject().catch(() => {});
        } else if (event.key === 'o') {
          // Ctrl+O or Cmd+O for open
          loadProject().catch(() => {});
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveProject, loadProject]);

  return (
    <main className="w-screen h-screen bg-[#141514] text-white flex overflow-hidden">
      {/* Debug Panel (development only) */}
      
      {/* Left Toolbar */}
      <LeftToolbar />
      
      {/* Main Canvas Area */}
      <div 
        className="flex-1 bg-[#141514] relative"
        style={{
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <DrawingCanvas />
      </div>
      
      {/* Right Panel */}
      <div className="bg-[#31313A] flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
        {/* <LayerPanel /> */}
        <div className="flex-[2] min-h-0">
          <BrushLibrary />
        </div>
        <div className="flex-[3] min-h-0">
          <ControlsPanel />
        </div>
      </div>
      
      {/* Document Modal */}
      <DocumentModal 
        isOpen={ui.modals.document}
        onClose={() => toggleModal('document')}
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={ui.modals.settings}
        onClose={() => toggleModal('settings')}
      />
    </main>
  );
}