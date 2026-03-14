import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import { Switch } from '../retroui/Switch';
import { FeatureFlagToggle } from '../ui/FeatureFlagToggle';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { devLog } from '../../utils/devLog';
import { getProjectSaveSizeReport, type ProjectSaveSizeReport } from '@/utils/projectIO';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const settingsLog = devLog.scope('SETTINGS');

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  const fractionDigits = value >= 100 || idx === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[idx]}`;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);
  const showRulers = useAppStore(state => state.canvas.showRulers);
  const showFPSMeter = useAppStore(state => state.canvas.showFPSMeter);
  const transparencyBackgroundMode = useAppStore(state => state.canvas.transparencyBackgroundMode);
  const isAutosaveEnabled = useAppStore(state => state.autosave.isEnabled);
  const autosaveInterval = useAppStore(state => state.autosave.interval);
  const historySize = useAppStore(state => state.history.maxHistorySize);
  const setAutosaveEnabled = useAppStore(state => state.setAutosaveEnabled);
  const setAutosaveInterval = useAppStore(state => state.setAutosaveInterval);
  const setHistorySize = useAppStore(state => state.setHistorySize);
  const toggleRulers = useAppStore(state => state.toggleRulers);
  const setShowFPSMeter = useAppStore(state => state.setShowFPSMeter);
  const setTransparencyBackgroundMode = useAppStore(state => state.setTransparencyBackgroundMode);
  const project = useAppStore(state => state.project);
  const layers = useAppStore(state => state.layers);
  
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnalyzingSize, setIsAnalyzingSize] = useState(false);
  const [sizeReport, setSizeReport] = useState<ProjectSaveSizeReport | null>(null);
  const [sizeReportError, setSizeReportError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const saveSettings = React.useCallback(() => {
    // Get fresh state from store to ensure we have the latest values
    const currentState = useAppStore.getState();
    const settings = {
      autosave: {
        isEnabled: currentState.autosave.isEnabled,
        interval: currentState.autosave.interval,
      },
      canvas: {
        showRulers: currentState.canvas.showRulers,
        showFPSMeter: currentState.canvas.showFPSMeter,
        transparencyBackgroundMode: currentState.canvas.transparencyBackgroundMode,
      },
      history: {
        maxHistorySize: currentState.history.maxHistorySize,
      },
    };
    try {
      localStorage.setItem('vessel-settings', JSON.stringify(settings));
    } catch (error) {
      settingsLog.warn('Failed to persist settings to localStorage; keeping in-memory values only.', { error });
      currentState.addNotification?.({
        type: 'warning',
        title: 'Settings Not Saved',
        message: 'Settings were applied for this session, but could not be stored locally. Check browser storage permissions.',
        timestamp: new Date(),
        duration: 4000
      });
    }
  }, []);

  const handleClose = React.useCallback(() => {
    saveSettings();
    onClose();
  }, [onClose, saveSettings]);

  const handleAutosaveToggle = (enabled: boolean) => {
    setAutosaveEnabled(enabled);
  };

  const handleIntervalChange = (interval: number) => {
    setAutosaveInterval(interval);
  };

  const handleHistorySizeChange = (size: number) => {
    setHistorySize(size);
  };

  const handleAnalyzeSaveSize = React.useCallback(async () => {
    if (!project) {
      setSizeReport(null);
      setSizeReportError('No active project to analyze.');
      return;
    }
    setIsAnalyzingSize(true);
    setSizeReportError(null);
    try {
      const report = await getProjectSaveSizeReport(project, layers);
      setSizeReport(report);
    } catch (error) {
      setSizeReport(null);
      setSizeReportError(error instanceof Error ? error.message : 'Failed to analyze save size');
    } finally {
      setIsAnalyzingSize(false);
    }
  }, [layers, project]);


  const handleRulersToggle = (enabled: boolean) => {
    if (showRulers !== enabled) {
      toggleRulers();
    }
  };

  const handleFPSMeterToggle = (enabled: boolean) => {
    setShowFPSMeter(enabled);
  };

  const handleTransparencyBackgroundModeChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const mode = event.target.value;
    if (mode === 'checker' || mode === 'gray') {
      setTransparencyBackgroundMode(mode);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const modalWidth = 384; // w-96
      const x = Math.max(16, Math.round((window.innerWidth - modalWidth) / 2));
      const y = Math.max(24, Math.round(window.innerHeight * 0.12));
      setPos({ x, y });
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      // Keep modal rendered during fade out, then remove it
      setTimeout(() => setShouldRender(false), 300);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleClose]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  React.useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = Math.min(window.innerWidth - 60, Math.max(8, e.clientX - dragOffset.current.x));
      const ny = Math.min(window.innerHeight - 60, Math.max(8, e.clientY - dragOffset.current.y));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, pos.x, pos.y]);

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={handleClose}
    >
      <div 
        className="bg-[#2C2C2C] rounded-lg w-96 max-w-full mx-4 shadow-xl"
        style={{ position: 'fixed', left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-[#555] cursor-move" onMouseDown={onDragStart}>
          <h2 className="text-[#D9D9D9] text-base font-semibold">Settings</h2>
          <button
            onClick={handleClose}
            className="text-[#888] hover:text-white transition-colors p-1"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 p-6 pt-4">
          {/* Display Settings */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Display</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="show-rulers" className="text-base text-[#888]">Show Rulers</label>
                <Switch
                  id="show-rulers"
                  checked={showRulers}
                  onChange={handleRulersToggle}
                />
              </div>
              <div className="flex items-center justify-between">
                <label htmlFor="show-fps-meter" className="text-base text-[#888]">Show FPS Meter</label>
                <Switch
                  id="show-fps-meter"
                  checked={showFPSMeter}
                  onChange={handleFPSMeterToggle}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <label htmlFor="transparency-background-mode" className="text-base text-[#888]">
                  Transparent Background
                </label>
                <select
                  id="transparency-background-mode"
                  value={transparencyBackgroundMode}
                  onChange={handleTransparencyBackgroundModeChange}
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                >
                  <option value="checker">Checkered</option>
                  <option value="gray">Grey</option>
                </select>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* Autosave Settings */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Autosave</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label htmlFor="enable-autosave" className="text-base text-[#888]">Enable Autosave</label>
                <Switch
                  id="enable-autosave"
                  checked={isAutosaveEnabled}
                  onChange={handleAutosaveToggle}
                />
              </div>
              {isAutosaveEnabled && (
                <div className="flex items-center justify-between">
                  <label className="text-base text-[#888]">Save Interval</label>
                  <select 
                    value={autosaveInterval}
                    onChange={(e) => handleIntervalChange(Number(e.target.value))}
                    className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  >
                    <option value={1}>1 minute</option>
                    <option value={2}>2 minutes</option>
                    <option value={5}>5 minutes</option>
                    <option value={10}>10 minutes</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* Implementation Settings */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Implementation</h3>
            <FeatureFlagToggle className="mb-4" />
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* Performance Settings */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Performance</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Undo History Size</label>
                <select 
                  value={historySize}
                  onChange={(e) => handleHistorySizeChange(Number(e.target.value))}
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                >
                  <option value={10}>10 actions</option>
                  <option value={25}>25 actions</option>
                  <option value={50}>50 actions</option>
                  <option value={100}>100 actions</option>
                </select>
              </div>

              <div className="border-t border-[#555] pt-3 mt-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-base text-[#888]">Save Size Inspector</label>
                  <button
                    type="button"
                    onClick={handleAnalyzeSaveSize}
                    disabled={isAnalyzingSize || !project}
                    className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base disabled:opacity-50"
                  >
                    {isAnalyzingSize ? 'Analyzing…' : 'Analyze'}
                  </button>
                </div>
                {!project && (
                  <p className="text-sm text-[#777] mt-2">Open or create a project to analyze save size.</p>
                )}
                {sizeReportError && (
                  <p className="text-sm text-[#D77] mt-2">{sizeReportError}</p>
                )}
                {sizeReport && (
                  <div className="mt-2 text-sm text-[#B5B5B5] space-y-1">
                    <div>Archive: {formatBytes(sizeReport.archiveBytes)}</div>
                    <div>Manifest (unzipped): {formatBytes(sizeReport.combinedManifestBytes)}</div>
                    <div>Compression Ratio: {(sizeReport.compressionRatio * 100).toFixed(1)}%</div>
                    <div>
                      Top Section: {sizeReport.sectionBreakdown[0]?.name ?? 'n/a'} ({formatBytes(sizeReport.sectionBreakdown[0]?.bytes ?? 0)})
                    </div>
                    <div>
                      Largest Layer: {sizeReport.largestLayers[0]?.layerName ?? 'n/a'} ({formatBytes(sizeReport.largestLayers[0]?.bytes ?? 0)})
                    </div>
                    {sizeReport.recommendations[0] && (
                      <div className="text-[#9FAF9F]">Tip: {sizeReport.recommendations[0]}</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
