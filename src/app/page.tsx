'use client';

import React, { useEffect } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
import ColorPickerPanel from '../components/panels/ColorPickerPanel';
import ColorCyclePanel from '../components/panels/ColorCyclePanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import BrushEditorUI from '../components/BrushEditorUI';
// import RHC1Panel from '../components/panels/RHC1Panel'; // HIDDEN
import { DocumentModal } from '../components/modals/DocumentModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useAppStore } from '../stores/useAppStore';
import { autosaveService } from '../utils/autosave';


export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  // Use individual selectors to avoid unstable object references
  const saveProject = useAppStore(state => state.saveProject);
  const loadProject = useAppStore(state => state.loadProject);
  const toggleModal = useAppStore(state => state.toggleModal);
  const ui = useAppStore(state => state.ui);
  const autosave = useAppStore(state => state.autosave);
  const currentTool = useAppStore(state => state.tools.currentTool);
  const project = useAppStore(state => state.project);
  const newProject = useAppStore(state => state.newProject);

  // Create default project on initial load if no layers exist
  useEffect(() => {
    if (project && project.layers.length === 0) {
      // console.log('🎨 Creating default project with layer on load');
      newProject(1920, 1080, 'Untitled');
    }
  }, []); // Run once on mount only

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
      
      {/* Left Toolbar */}
      <LeftToolbar />
      
      {/* Separator */}
      <div className="w-[2px] bg-[#424242] h-screen flex-shrink-0" />
      
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
      
      {/* Separator */}
      {/* <div className="w-[2px] bg-[#424242] h-screen flex-shrink-0" /> */}
      
      {/* RHC1 - Color Controls + Layers - HIDDEN */}
      {/* <RHC1Panel /> */}
      
      {/* Separator */}
      {/* <div className="w-[2px] bg-[#424242] h-screen flex-shrink-0" /> */}
      
      {/* RHC2 - ColorPickerPanel + BrushLibrary + ControlsPanel OR ColorCyclePanel */}
      <div className="flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
        {currentTool === 'color-cycle' ? (
          // Show Color Cycle Panel when color-cycle tool is active
          <div className="flex-1 overflow-y-auto">
            <ColorCyclePanel />
          </div>
        ) : (
          // Show normal panels for other tools
          <>
            <div className="flex-shrink-0">
              <ColorPickerPanel />
            </div>
            <div className="flex-[2] min-h-0 overflow-y-auto">
              <BrushLibrary />
            </div>
            {/* Separator */}
            <div className="h-[2px] bg-[#424242] w-full flex-shrink-0" />
            <div className="flex-[3] min-h-0 overflow-y-auto">
              <ControlsPanel />
            </div>
          </>
        )}
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
      
      {/* Brush Editor UI Modal */}
      <BrushEditorUI />
      
    </main>
  );
}