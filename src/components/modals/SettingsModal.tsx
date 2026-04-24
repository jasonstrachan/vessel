import { getAppStoreState } from '@/stores/appStoreAccess';
import React, { useEffect, useState } from 'react';
import { CC_DEBUG } from '@/debug/ccDebug';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import { Switch } from '../retroui/Switch';
import { FeatureFlagToggle } from '../ui/FeatureFlagToggle';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { devLog } from '../../utils/devLog';
import { getProjectSaveSizeReport, type ProjectHealthReport } from '@/utils/projectIO';
import type { SettingsSectionId } from '@/types';
import { writeLocalSettings } from '@/utils/localSettings';
import {
  DEV_DEBUG_OVERLAY_EVENT,
  isDevDebugOverlayEnabled,
  setDevDebugOverlayEnabled,
} from '@/utils/dev/debugOverlayStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const settingsLog = devLog.scope('SETTINGS');
const isDevBuild = process.env.NODE_ENV !== 'production';

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'display', label: 'Display' },
  { id: 'autosave', label: 'Autosave' },
  { id: 'implementation', label: 'Impl' },
  { id: 'performance', label: 'Perf' },
];

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
  useKeyboardScope('modal', isOpen);

  const showRulers = useAppStore((state) => state.canvas.showRulers);
  const showFPSMeter = useAppStore((state) => state.canvas.showFPSMeter);
  const transparencyBackgroundMode = useAppStore((state) => state.canvas.transparencyBackgroundMode);
  const isAutosaveEnabled = useAppStore((state) => state.autosave.isEnabled);
  const autosaveInterval = useAppStore((state) => state.autosave.interval);
  const historySize = useAppStore((state) => state.history.maxHistorySize);
  const settingsSection = useAppStore((state) => state.ui.settingsSection);
  const setAutosaveEnabled = useAppStore((state) => state.setAutosaveEnabled);
  const setAutosaveInterval = useAppStore((state) => state.setAutosaveInterval);
  const setHistorySize = useAppStore((state) => state.setHistorySize);
  const toggleRulers = useAppStore((state) => state.toggleRulers);
  const setShowFPSMeter = useAppStore((state) => state.setShowFPSMeter);
  const setTransparencyBackgroundMode = useAppStore((state) => state.setTransparencyBackgroundMode);
  const setSettingsSection = useAppStore((state) => state.setSettingsSection);
  const project = useAppStore((state) => state.project);
  const layers = useAppStore((state) => state.layers);

  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [isAnalyzingSize, setIsAnalyzingSize] = useState(false);
  const [sizeReport, setSizeReport] = useState<ProjectHealthReport | null>(null);
  const [sizeReportError, setSizeReportError] = useState<string | null>(null);
  const [isDevDebugOverlayOn, setIsDevDebugOverlayOn] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const saveSettings = React.useCallback(() => {
    const currentState = getAppStoreState();
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
    const saved = writeLocalSettings(settings);
    if (!saved) {
      settingsLog.warn('Failed to persist settings to localStorage; keeping in-memory values only.');
      currentState.addNotification?.({
        type: 'warning',
        title: 'Settings Not Saved',
        message: 'Settings were applied for this session, but could not be stored locally. Check browser storage permissions.',
        timestamp: new Date(),
        duration: 4000,
      });
    }
  }, []);

  const handleClose = React.useCallback(() => {
    saveSettings();
    onClose();
  }, [onClose, saveSettings]);

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

  const handleDevDebugOverlayToggle = (enabled: boolean) => {
    if (!enabled) {
      CC_DEBUG.on = false;
      if (typeof window !== 'undefined') {
        window.__CC_DEBUG__ = false;
      }
    }
    setDevDebugOverlayEnabled(enabled);
  };

  useEffect(() => {
    if (!isDevBuild) {
      return;
    }

    const syncDevDebugOverlay = () => {
      setIsDevDebugOverlayOn(isDevDebugOverlayEnabled());
    };

    syncDevDebugOverlay();
    window.addEventListener(DEV_DEBUG_OVERLAY_EVENT, syncDevDebugOverlay);
    return () => {
      window.removeEventListener(DEV_DEBUG_OVERLAY_EVENT, syncDevDebugOverlay);
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const modalWidth = 448;
      const x = Math.max(16, Math.round((window.innerWidth - modalWidth) / 2));
      const y = Math.max(24, Math.round(window.innerHeight * 0.12));
      setPos({ x, y });
      window.setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      window.setTimeout(() => setShouldRender(false), 300);
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

  const onDragStart = (event: React.MouseEvent) => {
    event.preventDefault();
    setDragging(true);
    dragOffset.current = { x: event.clientX - pos.x, y: event.clientY - pos.y };
  };

  useEffect(() => {
    if (!dragging) {
      return;
    }

    const onMove = (event: MouseEvent) => {
      const nextX = Math.min(window.innerWidth - 60, Math.max(8, event.clientX - dragOffset.current.x));
      const nextY = Math.min(window.innerHeight - 60, Math.max(8, event.clientY - dragOffset.current.y));
      setPos({ x: nextX, y: nextY });
    };
    const onUp = () => setDragging(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={handleClose}
    >
      <div
        className="bg-[#2C2C2C] rounded-lg w-[28rem] max-w-[calc(100vw-2rem)] shadow-xl"
        style={{ position: 'fixed', left: pos.x, top: pos.y }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b border-[#555] px-6 pb-3 pt-4 cursor-move"
          onMouseDown={onDragStart}
        >
          <h2 className="text-base font-semibold text-[#D9D9D9]">Settings</h2>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 text-[#888] transition-colors hover:text-white"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[min(75vh,760px)] overflow-y-auto p-6 pt-4">
          <div className="mb-5 flex flex-wrap gap-2">
            {SETTINGS_SECTIONS.map((section) => {
              const isActive = settingsSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setSettingsSection(section.id)}
                  className="rounded border px-2 py-1 text-[11px] uppercase tracking-[0.08em] transition-colors"
                  style={{
                    borderColor: isActive ? '#D9D9D9' : '#555',
                    backgroundColor: isActive ? '#D9D9D9' : 'transparent',
                    color: isActive ? '#1A1A1A' : '#A5A5A5',
                  }}
                >
                  {section.label}
                </button>
              );
            })}
          </div>

          {settingsSection === 'display' && (
            <div>
              <h3 className="mb-3 text-base font-medium text-[#D9D9D9]">Display</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="show-rulers" className="text-base text-[#888]">Show Rulers</label>
                  <Switch id="show-rulers" checked={showRulers} onChange={handleRulersToggle} />
                </div>
                <div className="flex items-center justify-between">
                  <label htmlFor="show-fps-meter" className="text-base text-[#888]">Show FPS Meter</label>
                  <Switch
                    id="show-fps-meter"
                    checked={showFPSMeter}
                    onChange={(enabled) => setShowFPSMeter(enabled)}
                  />
                </div>
                {isDevBuild && (
                  <div className="flex items-center justify-between">
                    <label htmlFor="show-dev-debug-overlay" className="text-base text-[#888]">
                      Show Debug Overlay
                    </label>
                    <Switch
                      id="show-dev-debug-overlay"
                      checked={isDevDebugOverlayOn}
                      onChange={handleDevDebugOverlayToggle}
                    />
                  </div>
                )}
                <div className="flex items-center justify-between gap-4">
                  <label htmlFor="transparency-background-mode" className="text-base text-[#888]">
                    Transparent Background
                  </label>
                  <select
                    id="transparency-background-mode"
                    value={transparencyBackgroundMode}
                    onChange={(event) => {
                      const mode = event.target.value;
                      if (mode === 'checker' || mode === 'gray') {
                        setTransparencyBackgroundMode(mode);
                      }
                    }}
                    className="rounded border border-[#555] bg-[#444] px-3 py-1 text-base text-[#D9D9D9]"
                  >
                    <option value="checker">Checkered</option>
                    <option value="gray">Grey</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {settingsSection === 'autosave' && (
            <div>
              <h3 className="mb-3 text-base font-medium text-[#D9D9D9]">Autosave</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="enable-autosave" className="text-base text-[#888]">Enable Autosave</label>
                  <Switch
                    id="enable-autosave"
                    checked={isAutosaveEnabled}
                    onChange={(enabled) => setAutosaveEnabled(enabled)}
                  />
                </div>
                {isAutosaveEnabled && (
                  <div className="flex items-center justify-between">
                    <label className="text-base text-[#888]">Save Interval</label>
                    <select
                      value={autosaveInterval}
                      onChange={(event) => setAutosaveInterval(Number(event.target.value))}
                      className="rounded border border-[#555] bg-[#444] px-3 py-1 text-base text-[#D9D9D9]"
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
          )}

          {settingsSection === 'implementation' && (
            <div>
              <h3 className="mb-3 text-base font-medium text-[#D9D9D9]">Implementation</h3>
              <FeatureFlagToggle className="mb-4" />
            </div>
          )}

          {settingsSection === 'performance' && (
            <div>
              <h3 className="mb-3 text-base font-medium text-[#D9D9D9]">Performance</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-base text-[#888]">Undo History Size</label>
                  <select
                    value={historySize}
                    onChange={(event) => setHistorySize(Number(event.target.value))}
                    className="rounded border border-[#555] bg-[#444] px-3 py-1 text-base text-[#D9D9D9]"
                  >
                    <option value={10}>10 actions</option>
                    <option value={25}>25 actions</option>
                    <option value={50}>50 actions</option>
                    <option value={100}>100 actions</option>
                  </select>
                </div>

                <div className="mt-2 border-t border-[#555] pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-base text-[#888]">Save Size Inspector</label>
                    <button
                      type="button"
                      onClick={handleAnalyzeSaveSize}
                      disabled={isAnalyzingSize || !project}
                      className="rounded border border-[#555] bg-[#444] px-3 py-1 text-base text-[#D9D9D9] disabled:opacity-50"
                    >
                      {isAnalyzingSize ? 'Analyzing…' : 'Analyze'}
                    </button>
                  </div>
                  {!project && (
                    <p className="mt-2 text-sm text-[#777]">Open or create a project to analyze save size.</p>
                  )}
                  {sizeReportError && (
                    <p className="mt-2 text-sm text-[#D77]">{sizeReportError}</p>
                  )}
                  {sizeReport && (
                    <div className="mt-2 space-y-1 text-sm text-[#B5B5B5]">
                      <div>Archive: {formatBytes(sizeReport.archiveBytes)}</div>
                      <div>Manifest (unzipped): {formatBytes(sizeReport.combinedManifestBytes)}</div>
                      <div>Compression Ratio: {(sizeReport.compressionRatio * 100).toFixed(1)}%</div>
                      <div>
                        Top Section: {sizeReport.sectionBreakdown[0]?.name ?? 'n/a'} ({formatBytes(sizeReport.sectionBreakdown[0]?.bytes ?? 0)})
                      </div>
                      <div>
                        Largest Layer: {sizeReport.largestLayers[0]?.layerName ?? 'n/a'} ({formatBytes(sizeReport.largestLayers[0]?.bytes ?? 0)})
                      </div>
                      {sizeReport.warnings.length > 0 && (
                        <div className="mt-2 rounded border border-amber-700/40 bg-amber-950/30 p-2">
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-amber-200">Warnings</div>
                          <div className="space-y-1">
                            {sizeReport.warnings.slice(0, 3).map((warningEntry) => (
                              <div key={warningEntry} className="text-xs text-amber-100">{warningEntry}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {sizeReport.recommendations.length > 0 && (
                        <div className="mt-2 rounded border border-[#273127] bg-[#182018] p-2">
                          <div className="mb-1 text-[11px] uppercase tracking-wide text-[#B7D0B7]">Recommendations</div>
                          <div className="space-y-1">
                            {sizeReport.recommendations.slice(0, 3).map((recommendation) => (
                              <div key={recommendation} className="text-xs text-[#9FAF9F]">{recommendation}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
