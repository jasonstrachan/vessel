import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Canvas size presets
const CANVAS_PRESETS = [
  { name: 'HD (1920×1080)', width: 1920, height: 1080 },
  { name: 'Full HD (1920×1200)', width: 1920, height: 1200 },
  { name: '4K (3840×2160)', width: 3840, height: 2160 },
  { name: 'Square (1024×1024)', width: 1024, height: 1024 },
  { name: 'Square (2048×2048)', width: 2048, height: 2048 },
  { name: 'A4 Portrait (2480×3508)', width: 2480, height: 3508 },
  { name: 'A4 Landscape (3508×2480)', width: 3508, height: 2480 },
  { name: 'Mobile (1080×1920)', width: 1080, height: 1920 },
  { name: 'Tablet (1536×2048)', width: 1536, height: 2048 },
];

// Calculate memory usage estimate in MB
const calculateMemoryUsage = (width: number, height: number): number => {
  // Each pixel uses 4 bytes (RGBA), estimate 3 layers average
  const bytesPerLayer = width * height * 4;
  const estimatedLayers = 3;
  const totalBytes = bytesPerLayer * estimatedLayers;
  return Math.round(totalBytes / (1024 * 1024)); // Convert to MB
};

export const DocumentModal: React.FC<DocumentModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);
  const { project, newProject, resizeCanvas } = useAppStore();
  
  const [resizeWidth, setResizeWidth] = useState<number | string>(project?.width || 1000);
  const [resizeHeight, setResizeHeight] = useState<number | string>(project?.height || 1000);
  const [newWidth, setNewWidth] = useState(1000);
  const [newHeight, setNewHeight] = useState(1000);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
    if (isOpen && project) {
      setResizeWidth(project.width);
      setResizeHeight(project.height);
    }
  }, [isOpen, project]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  useEffect(() => {
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

  const handleResize = () => {
    if (project) {
      const width = resizeWidth === '' ? 1 : Number(resizeWidth);
      const height = resizeHeight === '' ? 1 : Number(resizeHeight);
      resizeCanvas(width, height);
    }
    onClose();
  };

  const handleNewDocument = () => {
    newProject(newWidth, newHeight);
    onClose();
  };

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={onClose}
    >
      <div 
        className="bg-[#2C2C2C] rounded-lg w-96 max-w-full mx-4 shadow-xl"
        style={{ position: 'fixed', left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-[#555] cursor-move" onMouseDown={onDragStart}>
          <h2 className="text-[#D9D9D9] text-base font-semibold">Document</h2>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white transition-colors p-1"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 p-6 pt-4">
          {/* Resize Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Resize Canvas</h3>
            
            {/* Memory warning for resize */}
            {(() => {
              const memUsage = calculateMemoryUsage(
                typeof resizeWidth === 'string' ? parseInt(resizeWidth) || 1 : resizeWidth,
                typeof resizeHeight === 'string' ? parseInt(resizeHeight) || 1 : resizeHeight
              );
              return memUsage > 500 ? (
                <div className="mb-3 p-2 bg-yellow-900/20 border border-yellow-600/30 rounded text-yellow-500 text-sm">
                  ⚠️ Large canvas size (~{memUsage}MB memory usage)
                </div>
              ) : null;
            })()}
            
            <div className="flex gap-3">
              <div className="w-20">
                <label className="block text-base text-[#888] mb-1">Width</label>
                <Input
                  type="number"
                  value={resizeWidth}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setResizeWidth('');
                      return;
                    }
                    const num = parseInt(value);
                    setResizeWidth(isNaN(num) ? 1 : Math.max(1, num));
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setResizeWidth(1);
                    }
                  }}
                  className="w-full px-3 py-2 bg-transparent text-base"
                  min="1"
                  fullWidth
                />
              </div>
              <div className="w-20">
                <label className="block text-base text-[#888] mb-1">Height</label>
                <Input
                  type="number"
                  value={resizeHeight}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setResizeHeight('');
                      return;
                    }
                    const num = parseInt(value);
                    setResizeHeight(isNaN(num) ? 1 : Math.max(1, num));
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setResizeHeight(1);
                    }
                  }}
                  className="w-full px-3 py-2 bg-transparent text-base"
                  min="1"
                  fullWidth
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleResize}
                  variant="primary"
                  size="md"
                  className="w-36"
                >
                  Resize
                </Button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* New Document Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">New Document</h3>
            
            {/* Preset buttons */}
            <div className="mb-3 flex flex-wrap gap-2">
              {CANVAS_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => {
                    setNewWidth(preset.width);
                    setNewHeight(preset.height);
                  }}
                  className="px-2 py-1 text-xs bg-[#444] hover:bg-[#555] text-[#D9D9D9] rounded transition-colors"
                  title={`${preset.width}×${preset.height} (${calculateMemoryUsage(preset.width, preset.height)}MB)`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
            
            {/* Memory warning for new document */}
            {(() => {
              const memUsage = calculateMemoryUsage(newWidth, newHeight);
              return memUsage > 500 ? (
                <div className="mb-3 p-2 bg-yellow-900/20 border border-yellow-600/30 rounded text-yellow-500 text-sm">
                  ⚠️ Large canvas size (~{memUsage}MB memory usage)
                </div>
              ) : null;
            })()}
            
            <div className="flex gap-3">
              <div className="w-20">
                <label className="block text-base text-[#888] mb-1">Width</label>
                <Input
                  type="number"
                  value={newWidth}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      return; // Don't update state for empty values
                    }
                    const num = parseInt(value);
                    setNewWidth(isNaN(num) ? 1 : Math.max(1, num));
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setNewWidth(1);
                    }
                  }}
                  className="w-full px-3 py-2 bg-transparent text-base"
                  min="1"
                  fullWidth
                />
              </div>
              <div className="w-20">
                <label className="block text-base text-[#888] mb-1">Height</label>
                <Input
                  type="number"
                  value={newHeight}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      return; // Don't update state for empty values
                    }
                    const num = parseInt(value);
                    setNewHeight(isNaN(num) ? 1 : Math.max(1, num));
                  }}
                  onBlur={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      setNewHeight(1);
                    }
                  }}
                  className="w-full px-3 py-2 bg-transparent text-base"
                  min="1"
                  fullWidth
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleNewDocument}
                  variant="primary"
                  size="md"
                  className="w-36"
                >
                  New Document
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
