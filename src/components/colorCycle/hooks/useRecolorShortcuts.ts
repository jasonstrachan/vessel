/**
 * useRecolorShortcuts - Keyboard shortcuts for recolor panel
 * 
 * Clean keyboard event handling with customizable shortcuts
 * for common recolor operations.
 */

import { useEffect, useCallback } from 'react';
import { Layer } from '../../../types';

export interface ShortcutHandlers {
  toggleAnimation: () => void;
  toggleMode: () => void;
  extractColors: () => void;
  speedUp: () => void;
  slowDown: () => void;
  nextPreset: () => void;
  prevPreset: () => void;
  resetSpeed: () => void;
  toggleAdvanced: () => void;
}

export interface UseRecolorShortcutsOptions {
  enabled?: boolean;
  activeLayer?: Layer | null;
  isRecolorMode?: boolean;
}

const DEFAULT_SHORTCUTS = {
  toggleAnimation: 'Space',
  toggleMode: 'KeyM',
  extractColors: 'KeyE',
  speedUp: 'Equal', // Plus key
  slowDown: 'Minus',
  nextPreset: 'BracketRight',
  prevPreset: 'BracketLeft',
  resetSpeed: 'Digit1',
  toggleAdvanced: 'KeyA'
};

export function useRecolorShortcuts(
  handlers: ShortcutHandlers,
  options: UseRecolorShortcutsOptions = {}
) {
  const { enabled = true, activeLayer, isRecolorMode = false } = options;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't handle shortcuts if:
    // - Disabled
    // - In an input field
    // - Modal is open
    // - Ctrl/Cmd/Alt is pressed (for browser shortcuts)
    if (!enabled ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('[role="dialog"]')) {
      return;
    }

    const { code } = event;

    switch (code) {
      case DEFAULT_SHORTCUTS.toggleAnimation:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.toggleAnimation();
        }
        break;

      case DEFAULT_SHORTCUTS.toggleMode:
        if (activeLayer) {
          event.preventDefault();
          handlers.toggleMode();
        }
        break;

      case DEFAULT_SHORTCUTS.extractColors:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.extractColors();
        }
        break;

      case DEFAULT_SHORTCUTS.speedUp:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.speedUp();
        }
        break;

      case DEFAULT_SHORTCUTS.slowDown:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.slowDown();
        }
        break;

      case DEFAULT_SHORTCUTS.nextPreset:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.nextPreset();
        }
        break;

      case DEFAULT_SHORTCUTS.prevPreset:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.prevPreset();
        }
        break;

      case DEFAULT_SHORTCUTS.resetSpeed:
        if (activeLayer && isRecolorMode) {
          event.preventDefault();
          handlers.resetSpeed();
        }
        break;

      case DEFAULT_SHORTCUTS.toggleAdvanced:
        if (isRecolorMode) {
          event.preventDefault();
          handlers.toggleAdvanced();
        }
        break;

      default:
        // No shortcut matched
        break;
    }
  }, [enabled, activeLayer, isRecolorMode, handlers]);

  // Setup keyboard event listeners
  useEffect(() => {
    if (enabled) {
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [enabled, handleKeyDown]);

  // Return shortcut info for UI display
  return {
    shortcuts: {
      'Toggle Animation': 'Space',
      'Toggle Mode': 'M',
      'Extract Colors': 'E',
      'Speed Up': '+',
      'Speed Down': '-',
      'Next Preset': ']',
      'Previous Preset': '[',
      'Reset Speed': '1',
      'Toggle Advanced': 'A'
    }
  };
}