'use client';

import React, { useEffect, useState, useCallback } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import ColorPickerPanel from '../components/panels/ColorPickerPanel';
import LayersPanel from '../components/panels/LayersPanel';
import AlignmentPanel from '../components/panels/AlignmentPanel';
import AnimationControlsPanel from '../components/panels/AnimationControlsPanel';
import BrushLibraryPanel from '../components/panels/BrushLibraryPanel';
import BrushSettingsPanel from '../components/panels/BrushSettingsPanel';
import ColorAdjustmentsPanel from '../components/panels/ColorAdjustmentsPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import BrushEditorUI from '../components/BrushEditorUI';
import ConsoleSilencer from '../components/dev/ConsoleSilencer';
import FeedbackStrip from '../components/FeedbackStrip';
import FPSMeter from '../components/dev/FPSMeter';
// import RHC1Panel from '../components/panels/RHC1Panel'; // HIDDEN
import { DocumentModal } from '../components/modals/DocumentModal';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import { useAppStore } from '../stores/useAppStore';
import { autosaveService } from '../utils/autosave';
import { preloadRisographTexture } from '../utils/risographTexture';
// import TestPluginBrushes from '../components/TestPluginBrushes'; // TEST COMPONENT - Disabled due to render loop


export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  // Use individual selectors to avoid unstable object references
  const toggleModal = useAppStore(state => state.toggleModal);
  const ui = useAppStore(state => state.ui);
  const autosave = useAppStore(state => state.autosave);
  // const currentTool = useAppStore(state => state.tools.currentTool);
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
  }, [newProject]); // Include newProject dependency

  // Load settings from localStorage on initial mount only
  useEffect(() => {
    const savedSettings = localStorage.getItem('vessel-settings');
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
      } catch {}
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
    <main className="w-screen h-screen bg-[#141514] text-[#D9D9D9] flex overflow-hidden">
      <ConsoleSilencer />
      
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
        <DrawingCanvas showFeedback={showFeedback} />
        {feedbackMessage && (
          <FeedbackStrip
            message={feedbackMessage}
            onClose={() => setFeedbackMessage(null)}
          />
        )}
      </div>

      {/* Layers / Alignment Column */}
      <div className="flex flex-col h-screen flex-shrink-0 bg-[#141514]" style={{ width: '260px', minWidth: '260px', maxWidth: '260px' }}>
        <div className="flex-1 min-h-0 overflow-hidden">
          <LayersPanel />
        </div>
        <AlignmentPanel />
        <AnimationControlsPanel />
      </div>

      {/* Vertical Separator Between Right Columns */}
      <div className="self-stretch border-l" />

      {/* Right Panel Column */}
      <div className="flex flex-col h-screen flex-shrink-0 bg-[#141514]" style={{ width: '260px', minWidth: '260px', maxWidth: '260px' }}>
        <div className="flex-shrink-0">
          <ColorPickerPanel />
        </div>
        <ColorAdjustmentsPanel />
        <div className="flex-1 min-h-0 overflow-hidden">
          <BrushLibraryPanel />
        </div>
        <div className="border-t w-full flex-shrink-0" />
        <div className="flex-[1.2] min-h-0 overflow-hidden">
          <BrushSettingsPanel />
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
