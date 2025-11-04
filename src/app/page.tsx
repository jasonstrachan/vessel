'use client';

import React, { useEffect, useState, useCallback } from 'react';
import LeftToolbar from '../components/LeftToolbar';
import ColorPickerPanel from '../components/panels/ColorPickerPanel';
import LayersPanel from '../components/panels/LayersPanel';
import AlignmentPanel from '../components/panels/AlignmentPanel';
import AnimationControlsPanel from '../components/panels/AnimationControlsPanel';
import BrushLibraryPanel from '../components/panels/BrushLibraryPanel';
import BrushSettingsPanel from '../components/panels/BrushSettingsPanel';
import DrawingCanvas from '../components/canvas/DrawingCanvas';
import ConsoleSilencer from '../components/dev/ConsoleSilencer';
import FeedbackStrip from '../components/FeedbackStrip';
import FPSMeter from '../components/dev/FPSMeter';
// import RHC1Panel from '../components/panels/RHC1Panel'; // HIDDEN

import { commitLayerHistory } from '@/history/helpers/layerHistory';
import { captureColorCycleBrushState } from '@/history/helpers/colorCycle';
import { enableCCPerfProbe } from '@/utils/perf/ccPerfProbe';
import { DocumentModal } from '../components/modals/DocumentModal';
import { ExportModal } from '../components/modals/ExportModal';
import { SettingsModal } from '../components/modals/SettingsModal';
import LoadProjectModal from '../components/modals/LoadProjectModal';
import { useAppStore } from '../stores/useAppStore';
import { selectLayers } from '@/stores/selectors/layersSelectors';
import { selectModals } from '@/stores/selectors/modalSelectors';
import { autosaveService } from '../utils/autosave';
import { preloadRisographTexture } from '../utils/risographTexture';
import { devLog } from '../utils/devLog';
// import TestPluginBrushes from '../components/TestPluginBrushes'; // TEST COMPONENT - Disabled due to render loop

const homeLog = devLog.scope('HOME');

export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  // Use individual selectors to avoid unstable object references
  const toggleModal = useAppStore((state) => state.toggleModal);
  const modals = useAppStore(selectModals);
  const isDocumentModalOpen = modals.document;
  const isSettingsModalOpen = modals.settings;
  const isExportModalOpen = modals.export;
  const isLoadModalOpen = modals.loadProject;

  const autosaveEnabled = useAppStore((state) => state.autosave.isEnabled);
  const autosaveInterval = useAppStore((state) => state.autosave.interval);
  const canvasShowRulers = useAppStore((state) => state.canvas.showRulers);
  const setAutosaveEnabled = useAppStore((state) => state.setAutosaveEnabled);
  const setAutosaveInterval = useAppStore((state) => state.setAutosaveInterval);
  const toggleRulers = useAppStore((state) => state.toggleRulers);
  const setHistorySize = useAppStore((state) => state.setHistorySize);
  const newProject = useAppStore((state) => state.newProject);
  const ensureCustomBrushHydrated = useAppStore((state) => state.ensureCustomBrushHydrated);
  const layers = useAppStore(selectLayers);
  
  // Feedback strip state
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  
  const showFeedback = useCallback((message: string) => {
    setFeedbackMessage(message);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }
    enableCCPerfProbe({
      captureColorCycleBrushState,
      commitLayerHistory,
    });
  }, []);

  // Create default project on initial load if no layers exist
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (ensureCustomBrushHydrated) {
        await ensureCustomBrushHydrated();
      }

      if (cancelled) {
        return;
      }

      if (layers.length === 0) {
        newProject(2000, 2000, 'Untitled');
      }

      // Preload risograph texture to avoid lag on first use
      preloadRisographTexture();
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [ensureCustomBrushHydrated, layers.length, newProject]);

  // Load settings from localStorage on initial mount only
  useEffect(() => {
    const savedSettings = localStorage.getItem('vessel-settings');
    if (savedSettings) {
      try {
        const settings = JSON.parse(savedSettings);

        // Load autosave settings
        if (settings.autosave) {
          setAutosaveEnabled(settings.autosave.isEnabled);
          setAutosaveInterval(settings.autosave.interval);
        }

        // Load canvas settings
        if (settings.canvas) {
          if (typeof settings.canvas.showRulers === 'boolean' && settings.canvas.showRulers !== canvasShowRulers) {
            toggleRulers();
          }
        }

        // Load history settings
        if (settings.history) {
          if (settings.history.maxHistorySize) {
            setHistorySize(settings.history.maxHistorySize);
          }
        }
      } catch (error) {
        homeLog.warn('Failed to load persisted settings; clearing stored payload.', { error });
        localStorage.removeItem('vessel-settings');
      }
    }
  }, [canvasShowRulers, setAutosaveEnabled, setAutosaveInterval, setHistorySize, toggleRulers]);

  // Initialize/manage autosave service
  useEffect(() => {
    // Cleanup on unmount
    return () => {
      autosaveService.stop();
    };
  }, []);

  // Watch for autosave settings changes
  useEffect(() => {
    const isCurrentlyRunning = autosaveService.isRunning();

    if (!autosaveEnabled) {
      if (isCurrentlyRunning) {
        autosaveService.stop();
      }
      return;
    }

    autosaveService.setInterval(autosaveInterval);

    if (!isCurrentlyRunning) {
      autosaveService.start();
    }
  }, [autosaveEnabled, autosaveInterval]);

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
      <div
        className="flex flex-col h-screen flex-shrink-0 bg-[#1A1A1A] border-l"
        style={{ width: '260px', minWidth: '260px', maxWidth: '260px', borderColor: '#242424' }}
      >
        <div className="flex-1 min-h-0 overflow-hidden">
          <LayersPanel />
        </div>
        <AlignmentPanel />
        <AnimationControlsPanel />
      </div>

      {/* Vertical Separator Between Right Columns */}
      <div className="self-stretch border-l" style={{ borderColor: '#242424' }} />

      {/* Right Panel Column */}
      <div className="flex flex-col h-screen flex-shrink-0 bg-[#1A1A1A]" style={{ width: '260px', minWidth: '260px', maxWidth: '260px' }}>
        <div className="flex-shrink-0">
          <ColorPickerPanel />
        </div>
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
        isOpen={isDocumentModalOpen}
        onClose={() => toggleModal('document')}
      />
      
      {/* Settings Modal */}
      <SettingsModal 
        isOpen={isSettingsModalOpen}
        onClose={() => toggleModal('settings')}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => toggleModal('export')}
      />

      {/* Load Project Modal */}
      <LoadProjectModal
        isOpen={isLoadModalOpen}
        onClose={() => toggleModal('loadProject')}
      />
      
      {/* Brush Editor UI Modal */}

      {/* TEST: Plugin Brush Test Panel - Disabled due to render loop */}
      {/* <TestPluginBrushes /> */}

      {/* Simple FPS overlay */}
      <FPSMeter />


    </main>
  );
}
