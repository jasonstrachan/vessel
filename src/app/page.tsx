'use client';

import React, { useEffect, useState, useCallback } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import BrushLibrary from '../components/BrushLibrary';
import ControlsPanel from '../components/ControlsPanel';
import ColorPickerPanel from '../components/panels/ColorPickerPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import BrushEditorUI from '../components/BrushEditorUI';
import ConsoleSilencer from '../components/dev/ConsoleSilencer';
import MinimalLayerList from '../components/MinimalLayerList';
import FeedbackStrip from '../components/FeedbackStrip';
import FPSMeter from '../components/dev/FPSMeter';
// import RHC1Panel from '../components/panels/RHC1Panel'; // HIDDEN
import { DocumentModal } from '../components/modals/DocumentModal';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useAppStore } from '../stores/useAppStore';
import { autosaveService } from '../utils/autosave';
import { debugLog } from '../utils/debug';
import { preloadRisographTexture } from '../utils/risographTexture';
// import TestPluginBrushes from '../components/TestPluginBrushes'; // TEST COMPONENT - Disabled due to render loop


export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  // Use individual selectors to avoid unstable object references
  const saveProject = useAppStore(state => state.saveProject);
  const loadProject = useAppStore(state => state.loadProject);
  const toggleModal = useAppStore(state => state.toggleModal);
  const ui = useAppStore(state => state.ui);
  const autosave = useAppStore(state => state.autosave);
  // const currentTool = useAppStore(state => state.tools.currentTool);
  const project = useAppStore(state => state.project);
  const newProject = useAppStore(state => state.newProject);
  
  // Feedback strip state
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  
  const showFeedback = useCallback((message: string) => {
    setFeedbackMessage(message);
  }, []);

  // Create default project on initial load if no layers exist
  useEffect(() => {
    const store = useAppStore.getState();
    // Check top-level layers, not project.layers
    if (store.layers.length === 0) {
      newProject(1000, 1000, 'Untitled');
    } else {
      // quiet
    }
    
    // Preload risograph texture to avoid lag on first use
    preloadRisographTexture();
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
      } catch (error) {}
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

  // Save/Open keyboard shortcuts are centralized in useComprehensiveKeyboard

  return (
    <main className="w-screen h-screen bg-[#141514] text-white flex overflow-hidden">
      <ConsoleSilencer />
      
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
        <DrawingCanvas showFeedback={showFeedback} />
        <MinimalLayerList />
        {feedbackMessage && (
          <FeedbackStrip 
            message={feedbackMessage} 
            onClose={() => setFeedbackMessage(null)} 
          />
        )}
      </div>
      
      {/* Separator */}
      {/* <div className="w-[2px] bg-[#424242] h-screen flex-shrink-0" /> */}
      
      {/* RHC1 - Color Controls + Layers - HIDDEN */}
      {/* <RHC1Panel /> */}
      
      {/* Separator */}
      {/* <div className="w-[2px] bg-[#424242] h-screen flex-shrink-0" /> */}
      
      {/* RHC2 - ColorPickerPanel + BrushLibrary + ControlsPanel */}
      <div className="flex flex-col h-screen flex-shrink-0" style={{ width: '240px', minWidth: '240px', maxWidth: '240px' }}>
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

      {/* Export Modal */}
      <ExportModal
        isOpen={ui.modals.export}
        onClose={() => toggleModal('export')}
      />
      
      {/* Brush Editor UI Modal */}
      <BrushEditorUI />

      {/* TEST: Plugin Brush Test Panel - Disabled due to render loop */}
      {/* <TestPluginBrushes /> */}

      {/* Simple FPS overlay */}
      <FPSMeter />


    </main>
  );
}
