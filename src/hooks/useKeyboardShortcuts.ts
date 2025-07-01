import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { Tool } from '@/types';

export const useKeyboardShortcuts = () => {
  const {
    setCurrentTool,
    togglePlay,
    undo,
    redo,
    setCurrentFrame,
    project,
    setBrushSettings,
    brushSettings,
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent shortcuts when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const { key, code, ctrlKey, metaKey, shiftKey } = event;
      const cmdOrCtrl = ctrlKey || metaKey;
      
      // Debug logging for bracket keys
      if (key === '[' || key === ']' || code === 'BracketLeft' || code === 'BracketRight') {
        console.log('🔍 Bracket key detected:', { key, code, ctrlKey, metaKey, shiftKey });
      }

      // Prevent default for our shortcuts
      const shouldPreventDefault = () => {
        event.preventDefault();
        event.stopPropagation();
      };

      // Handle bracket shortcuts by code for reliability
      if (code === 'BracketLeft') {
        console.log('🎯 Decrease brush size shortcut triggered (code), current:', brushSettings.size);
        shouldPreventDefault();
        setBrushSettings({ 
          size: Math.max(1, brushSettings.size - 1) 
        });
        return;
      }
      
      if (code === 'BracketRight') {
        console.log('🎯 Increase brush size shortcut triggered (code), current:', brushSettings.size);
        shouldPreventDefault();
        setBrushSettings({ 
          size: Math.min(50, brushSettings.size + 1) 
        });
        return;
      }

      switch (key.toLowerCase()) {
        // Tool shortcuts
        case 'b':
          shouldPreventDefault();
          setCurrentTool(Tool.BRUSH);
          break;
        case 'p':
          shouldPreventDefault();
          setCurrentTool(Tool.BRUSH);
          break;
        case 'e':
          shouldPreventDefault();
          setCurrentTool(Tool.ERASER);
          break;
        case 'g':
          shouldPreventDefault();
          setCurrentTool(Tool.FILL);
          break;
        case 's':
          if (!cmdOrCtrl) {
            shouldPreventDefault();
            setCurrentTool(Tool.SELECT);
          }
          break;
        case 'c':
          if (!cmdOrCtrl) {
            shouldPreventDefault();
            setCurrentTool(Tool.CLEAR);
          }
          break;

        // Animation controls
        case 'enter':
          shouldPreventDefault();
          togglePlay();
          break;
        case 'arrowleft':
          shouldPreventDefault();
          const prevFrame = project.currentFrame > 0 
            ? project.currentFrame - 1 
            : Math.max(...project.layers.map(l => l.frames.length)) - 1;
          setCurrentFrame(prevFrame);
          break;
        case 'arrowright':
          shouldPreventDefault();
          const maxFrames = Math.max(...project.layers.map(l => l.frames.length));
          const nextFrame = (project.currentFrame + 1) % maxFrames;
          setCurrentFrame(nextFrame);
          break;

        // Brush size shortcuts - handle multiple key representations
        case '[':
        case 'bracketleft':
        case 'BracketLeft':
          console.log('🎯 Decrease brush size shortcut triggered, current:', brushSettings.size);
          shouldPreventDefault();
          setBrushSettings({ 
            size: Math.max(1, brushSettings.size - 1) 
          });
          break;
        case ']':
        case 'bracketright':
        case 'BracketRight':
          console.log('🎯 Increase brush size shortcut triggered, current:', brushSettings.size);
          shouldPreventDefault();
          setBrushSettings({ 
            size: Math.min(50, brushSettings.size + 1) 
          });
          break;

        // Undo/Redo
        case 'z':
          if (cmdOrCtrl) {
            shouldPreventDefault();
            if (shiftKey) {
              redo();
            } else {
              undo();
            }
          }
          break;
        case 'y':
          if (cmdOrCtrl) {
            shouldPreventDefault();
            redo();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCurrentTool, togglePlay, undo, redo, setCurrentFrame, project, setBrushSettings, brushSettings]);
};