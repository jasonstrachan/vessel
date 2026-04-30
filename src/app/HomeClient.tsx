'use client';

import { getAppStoreState } from '@/stores/appStoreAccess';
import React, { useEffect, useState, useCallback } from 'react';
import LeftToolbar from '@/components/LeftToolbar';
import ColorPickerPanel from '@/components/panels/ColorPickerPanel';
import LayersPanel from '@/components/panels/LayersPanel';
import AlignmentPanel from '@/components/panels/AlignmentPanel';
import AnimationControlsPanel from '@/components/panels/AnimationControlsPanel';
import GridSettingsPanel from '@/components/panels/GridSettingsPanel';
import BrushLibraryPanel from '@/components/panels/BrushLibraryPanel';
import BrushSettingsPanel from '@/components/panels/BrushSettingsPanel';
import DrawingCanvas from '@/components/canvas/DrawingCanvas';
import ConsoleSilencer from '@/components/dev/ConsoleSilencer';
import FeedbackStrip from '@/components/FeedbackStrip';
import SaveStatusStrip from '@/components/SaveStatusStrip';
import SelectionConstraintStrip from '@/components/SelectionConstraintStrip';
import FPSMeter from '@/components/dev/FPSMeter';
import DevDebugOverlay from '@/components/dev/DevDebugOverlay';
// import RHC1Panel from '../components/panels/RHC1Panel'; // HIDDEN

import { DocumentModal } from '@/components/modals/DocumentModal';
import { ExportModal } from '@/components/modals/ExportModal';
import { SettingsModal } from '@/components/modals/SettingsModal';
import LoadProjectModal from '@/components/modals/LoadProjectModal';
import { useAppStore } from '@/stores/useAppStore';
import { selectLayers } from '@/stores/selectors/layersSelectors';
import { selectModals } from '@/stores/selectors/modalSelectors';
import { selectAutosaveSaveStatus } from '@/stores/selectors/stateSelectors';
import { preloadRisographTexture } from '@/utils/risographTexture';
import { autosaveService } from '@/utils/autosave';
import { devLog } from '@/utils/devLog';
import { readLocalSettings } from '@/utils/localSettings';
import { setAppFeedbackHandler } from '@/utils/appFeedback';
// import TestPluginBrushes from '../components/TestPluginBrushes'; // TEST COMPONENT - Disabled due to render loop

const homeLog = devLog.scope('HOME');
const isDevBuild = process.env.NODE_ENV !== 'production';

export default function Home() {
  // Global mouse tracking removed - now handled directly in canvas
  // Use individual selectors to avoid unstable object references
  const toggleModal = useAppStore((state) => state.toggleModal);
  const modals = useAppStore(selectModals);
  const isDocumentModalOpen = modals.document;
  const isSettingsModalOpen = modals.settings;
  const isExportModalOpen = modals.export;
  const isLoadModalOpen = modals.loadProject;

  const canvasShowRulers = useAppStore((state) => state.canvas.showRulers);
  const showFPSMeter = useAppStore((state) => state.canvas.showFPSMeter);
  const setTransparencyBackgroundMode = useAppStore((state) => state.setTransparencyBackgroundMode);
  const setAutosaveEnabled = useAppStore((state) => state.setAutosaveEnabled);
  const setAutosaveInterval = useAppStore((state) => state.setAutosaveInterval);
  const toggleRulers = useAppStore((state) => state.toggleRulers);
  const setShowFPSMeter = useAppStore((state) => state.setShowFPSMeter);
  const setHistorySize = useAppStore((state) => state.setHistorySize);
  const newProject = useAppStore((state) => state.newProject);
  const ensureCustomBrushHydrated = useAppStore((state) => state.ensureCustomBrushHydrated);
  const layers = useAppStore(selectLayers);
  const isAutosaveEnabled = useAppStore((state) => state.autosave.isEnabled);
  const autosaveIntervalMinutes = useAppStore((state) => state.autosave.interval);
  const saveStatus = useAppStore(selectAutosaveSaveStatus);
  const clearSaveStatus = useAppStore((state) => state.clearSaveStatus);
  
  // Feedback strip state
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isSettingsHydrated, setIsSettingsHydrated] = useState(false);
  const showFeedback = useCallback((message: string) => {
    setFeedbackMessage(message);
  }, []);

  useEffect(() => {
    setAppFeedbackHandler(showFeedback);
    return () => setAppFeedbackHandler(null);
  }, [showFeedback]);

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
    try {
      const settings = readLocalSettings();
      if (Object.keys(settings).length > 0) {

        // Load autosave settings
        if (settings.autosave) {
          if (typeof settings.autosave.isEnabled === 'boolean') {
            setAutosaveEnabled(settings.autosave.isEnabled);
          }
          if (typeof settings.autosave.interval === 'number') {
            setAutosaveInterval(settings.autosave.interval);
          }
        }

        // Load canvas settings
        if (settings.canvas) {
          if (typeof settings.canvas.showRulers === 'boolean' && settings.canvas.showRulers !== canvasShowRulers) {
            toggleRulers();
          }
          if (typeof settings.canvas.showFPSMeter === 'boolean') {
            setShowFPSMeter(settings.canvas.showFPSMeter);
          }
          if (
            settings.canvas.transparencyBackgroundMode === 'checker' ||
            settings.canvas.transparencyBackgroundMode === 'gray'
          ) {
            setTransparencyBackgroundMode(settings.canvas.transparencyBackgroundMode);
          }
        }

        // Load history settings
        if (settings.history) {
          if (settings.history.maxHistorySize) {
            setHistorySize(settings.history.maxHistorySize);
          }
        }
      }
    } catch (error) {
      homeLog.warn('Failed to load persisted settings; clearing stored payload.', { error });
      localStorage.removeItem('vessel-settings');
    } finally {
      setIsSettingsHydrated(true);
    }
  }, [canvasShowRulers, setAutosaveEnabled, setAutosaveInterval, setHistorySize, setShowFPSMeter, setTransparencyBackgroundMode, toggleRulers]);

  useEffect(() => {
    if (!isAutosaveEnabled) {
      autosaveService.stop();
      return;
    }

    autosaveService.setInterval(autosaveIntervalMinutes);

    if (!autosaveService.isRunning()) {
      autosaveService.start();
    }
  }, [autosaveIntervalMinutes, isAutosaveEnabled]);

  useEffect(() => {
    if (saveStatus.phase !== 'saved') {
      return;
    }

    const savedAt = saveStatus.updatedAt?.getTime() ?? Date.now();
    const timer = setTimeout(() => {
      const latest = selectAutosaveSaveStatus(getAppStoreState());
      const latestSavedAt = latest.updatedAt?.getTime() ?? 0;
      if (latest.phase === 'saved' && latestSavedAt === savedAt) {
        clearSaveStatus();
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [clearSaveStatus, saveStatus.phase, saveStatus.updatedAt]);

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
        <SelectionConstraintStrip />
        <SaveStatusStrip phase={saveStatus.phase} message={saveStatus.message} />
      </div>

      {/* Layers / Alignment Column */}
      <div
        className="flex flex-col h-screen flex-shrink-0 bg-[#1A1A1A] border-l"
        style={{ width: '260px', minWidth: '260px', maxWidth: '260px', borderColor: '#242424' }}
      >
        <div className="flex-1 min-h-0 overflow-hidden">
          <LayersPanel />
        </div>
        <GridSettingsPanel />
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
      {isSettingsHydrated && showFPSMeter && <FPSMeter />}
      {isDevBuild && <DevDebugOverlay />}


    </main>
  );
}
