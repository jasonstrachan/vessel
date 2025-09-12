import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import { Switch } from '../retroui/Switch';
import { FeatureFlagToggle } from '../ui/FeatureFlagToggle';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);
  const { canvas, autosave, history, setAutosaveEnabled, setAutosaveInterval, setHistorySize } = useAppStore();
  
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const saveSettings = () => {
    // Get fresh state from store to ensure we have the latest values
    const currentState = useAppStore.getState();
    const settings = {
      autosave: {
        isEnabled: currentState.autosave.isEnabled,
        interval: currentState.autosave.interval,
      },
      canvas: {
        showRulers: currentState.canvas.showRulers,
      },
      history: {
        maxHistorySize: currentState.history.maxHistorySize,
      },
    };
    localStorage.setItem('tinybrush-settings', JSON.stringify(settings));
  };

  const handleClose = () => {
    saveSettings();
    onClose();
  };

  const handleAutosaveToggle = (enabled: boolean) => {
    setAutosaveEnabled(enabled);
  };

  const handleIntervalChange = (interval: number) => {
    setAutosaveInterval(interval);
  };

  const handleHistorySizeChange = (size: number) => {
    setHistorySize(size);
  };


  const handleRulersToggle = (enabled: boolean) => {
    const { toggleRulers } = useAppStore.getState();
    if (canvas.showRulers !== enabled) {
      toggleRulers();
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
        className="bg-[#31313A] rounded-lg w-96 max-w-full mx-4 shadow-xl"
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
                  checked={canvas.showRulers}
                  onChange={handleRulersToggle}
                />
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
                  checked={autosave.isEnabled}
                  onChange={handleAutosaveToggle}
                />
              </div>
              {autosave.isEnabled && (
                <div className="flex items-center justify-between">
                  <label className="text-base text-[#888]">Save Interval</label>
                  <select 
                    value={autosave.interval}
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
                  value={history.maxHistorySize}
                  onChange={(e) => handleHistorySizeChange(Number(e.target.value))}
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                >
                  <option value={10}>10 actions</option>
                  <option value={25}>25 actions</option>
                  <option value={50}>50 actions</option>
                  <option value={100}>100 actions</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
