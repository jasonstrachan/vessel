import React, { useState, useEffect } from 'react';

import { useKeyboardScope } from '@/hooks/useKeyboardScope';
import { useAppStore } from '@/stores/useAppStore';
import { estimateDocumentMemoryUsage } from '@/utils/documentMemoryEstimate';

import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CanvasPresetSize {
  width: number;
  height: number;
}

interface CanvasPresetGroup {
  ratio: string;
  name: string;
  description: string;
  sizes: CanvasPresetSize[];
}

// Canvas presets grouped by aspect ratio, from smallest to largest.
const CANVAS_PRESET_GROUPS: CanvasPresetGroup[] = [
  {
    ratio: '1:1',
    name: 'Square',
    description: 'Standard for Procreate "Square" preset.',
    sizes: [
      { width: 256, height: 256 },
      { width: 512, height: 512 },
      { width: 1024, height: 1024 },
      { width: 2048, height: 2048 },
      { width: 4096, height: 4096 },
    ],
  },
  {
    ratio: '3:4',
    name: 'Tablet / Portrait',
    description: 'Slightly lower 3:4 tablet portrait preset.',
    sizes: [
      { width: 384, height: 512 },
      { width: 768, height: 1024 },
      { width: 1536, height: 2048 },
      { width: 1920, height: 2560 },
      { width: 3072, height: 4096 },
    ],
  },
  {
    ratio: '4:5',
    name: 'Portrait',
    description: 'Portrait document preset with a 4:5 aspect ratio.',
    sizes: [
      { width: 256, height: 320 },
      { width: 512, height: 640 },
      { width: 1024, height: 1280 },
      { width: 2048, height: 2560 },
      { width: 3072, height: 3840 },
    ],
  },
  {
    ratio: '2:3',
    name: 'Vertical Art',
    description: 'Great for high-res mobile wallpapers.',
    sizes: [
      { width: 256, height: 384 },
      { width: 512, height: 768 },
      { width: 1000, height: 1500 },
      { width: 2000, height: 3000 },
      { width: 3000, height: 4500 },
    ],
  },
  {
    ratio: '9:16',
    name: 'Mobile',
    description: 'Portrait display and social video format.',
    sizes: [
      { width: 180, height: 320 },
      { width: 360, height: 640 },
      { width: 720, height: 1280 },
      { width: 1080, height: 1920 },
      { width: 2160, height: 3840 },
    ],
  },
  {
    ratio: '1:√2',
    name: 'Print Portrait',
    description: 'ISO A-series paper proportion in portrait orientation.',
    sizes: [
      { width: 256, height: 362 },
      { width: 512, height: 724 },
      { width: 1240, height: 1754 },
      { width: 2000, height: 2828 },
      { width: 2480, height: 3508 },
    ],
  },
  {
    ratio: '4:3',
    name: 'Landscape',
    description: 'Landscape document preset with a 4:3 aspect ratio.',
    sizes: [
      { width: 512, height: 384 },
      { width: 1024, height: 768 },
      { width: 1920, height: 1440 },
      { width: 2560, height: 1920 },
      { width: 3840, height: 2880 },
    ],
  },
  {
    ratio: '5:4',
    name: 'Landscape',
    description: 'Landscape document preset with a 5:4 aspect ratio.',
    sizes: [
      { width: 320, height: 256 },
      { width: 640, height: 512 },
      { width: 1280, height: 1024 },
      { width: 2560, height: 2048 },
      { width: 3840, height: 3072 },
    ],
  },
  {
    ratio: '3:2',
    name: 'Landscape',
    description: 'Classic landscape art and print ratio.',
    sizes: [
      { width: 384, height: 256 },
      { width: 768, height: 512 },
      { width: 1500, height: 1000 },
      { width: 3000, height: 2000 },
      { width: 4500, height: 3000 },
    ],
  },
  {
    ratio: '2:1',
    name: 'Wide Landscape',
    description: 'Wide landscape canvas for panoramic compositions.',
    sizes: [
      { width: 512, height: 256 },
      { width: 1024, height: 512 },
      { width: 1500, height: 750 },
      { width: 3000, height: 1500 },
      { width: 4000, height: 2000 },
    ],
  },
  {
    ratio: '16:9',
    name: 'Cinematic',
    description: 'Standard 16:9 display resolutions from low-res to 4K.',
    sizes: [
      { width: 320, height: 180 },
      { width: 640, height: 360 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 3840, height: 2160 },
    ],
  },
  {
    ratio: '16:10',
    name: 'Display',
    description: 'Common widescreen computer display proportion.',
    sizes: [
      { width: 320, height: 200 },
      { width: 640, height: 400 },
      { width: 1280, height: 800 },
      { width: 1920, height: 1200 },
      { width: 2560, height: 1600 },
    ],
  },
  {
    ratio: '√2:1',
    name: 'Print Landscape',
    description: 'ISO A-series paper proportion in landscape orientation.',
    sizes: [
      { width: 362, height: 256 },
      { width: 724, height: 512 },
      { width: 1754, height: 1240 },
      { width: 2828, height: 2000 },
      { width: 3508, height: 2480 },
    ],
  },
];

const DOCUMENT_MEMORY_WARNING_MIB = 400;

const DocumentMemoryWarning: React.FC<{ width: number; height: number }> = ({ width, height }) => {
  const estimate = estimateDocumentMemoryUsage(width, height);
  if (estimate.totalMiB <= DOCUMENT_MEMORY_WARNING_MIB) {
    return null;
  }

  return (
    <div
      className="mb-3 p-2 bg-yellow-900/20 border border-yellow-600/30 rounded text-yellow-500 text-sm"
    >
      <div>⚠️ Large document (~{estimate.totalMiB} MiB estimated memory)</div>
      <div className="mt-1 text-[11px] text-yellow-500/80">
        Editing may slow down or exceed the browser&apos;s memory limit.
      </div>
    </div>
  );
};

export const DocumentModal: React.FC<DocumentModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);
  const { project, newProject, resizeCanvas, beginCanvasShapeEdit } = useAppStore();
  
  const [resizeWidth, setResizeWidth] = useState<number | string>(project?.width || 2000);
  const [resizeHeight, setResizeHeight] = useState<number | string>(project?.height || 2000);
  const [newWidth, setNewWidth] = useState(2000);
  const [newHeight, setNewHeight] = useState(2000);
  const [isResizing, setIsResizing] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const modalWidth = Math.min(768, window.innerWidth - 32);
      const x = Math.max(16, Math.round((window.innerWidth - modalWidth) / 2));
      const y = 24;
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

  const handleResize = async () => {
    if (!project || isResizing) {
      return;
    }

    setIsResizing(true);
    try {
      const width = resizeWidth === '' ? 1 : Number(resizeWidth);
      const height = resizeHeight === '' ? 1 : Number(resizeHeight);
      await resizeCanvas(width, height);
      onClose();
    } finally {
      setIsResizing(false);
    }
  };

  const handleNewDocument = () => {
    newProject(newWidth, newHeight);
    onClose();
  };

  const handleCanvasShapeTool = (tool: 'rectangle' | 'circle' | 'freehand') => {
    beginCanvasShapeEdit(tool);
    onClose();
  };

  if (!shouldRender) return null;

  return (
    <div 
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={onClose}
    >
      <div 
        className="bg-[#2C2C2C] rounded-lg w-[48rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-3rem)] flex flex-col shadow-xl"
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

        <div className="space-y-6 p-6 pt-4 overflow-y-auto">
          {/* New Document Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">New Document</h3>
            
            {/* Preset buttons */}
            <div className="mb-3 overflow-x-auto">
              <div className="w-fit min-w-[38.5rem] space-y-1">
                <div className="grid grid-cols-[11rem_repeat(5,5.25rem)] gap-1 px-1 text-[10px] uppercase tracking-wide text-[#888]">
                  <span>Format</span>
                  <span className="text-center">Tiny</span>
                  <span className="text-center">Small</span>
                  <span className="text-center">Medium</span>
                  <span className="text-center">Large</span>
                  <span className="text-center">Max</span>
                </div>
                {CANVAS_PRESET_GROUPS.map((group) => (
                  <div
                    key={`${group.ratio}-${group.name}`}
                    className="grid grid-cols-[11rem_repeat(5,5.25rem)] gap-1"
                  >
                    <div
                      className="flex min-w-0 items-center px-2 text-xs text-[#D9D9D9]"
                      title={group.description}
                    >
                      <span className="mr-2 shrink-0 text-[#AFAFAF]">{group.ratio}</span>
                      <span className="truncate">{group.name}</span>
                    </div>
                    {group.sizes.map((preset) => {
                      const isSelected = newWidth === preset.width && newHeight === preset.height;
                      const dimensions = `${preset.width}×${preset.height}`;
                      return (
                        <button
                          key={dimensions}
                          type="button"
                          onClick={() => {
                            setNewWidth(preset.width);
                            setNewHeight(preset.height);
                          }}
                          className={`min-w-0 px-1 py-1 text-[11px] transition-colors ${
                            isSelected
                              ? 'bg-[#D9D9D9] text-[#2C2C2C]'
                              : 'bg-[#444] text-[#D9D9D9] hover:bg-[#555]'
                          }`}
                          aria-label={`Set ${group.ratio} ${group.name} to ${dimensions}`}
                          aria-pressed={isSelected}
                        >
                          {dimensions}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Memory warning for new document */}
            <DocumentMemoryWarning width={newWidth} height={newHeight} />

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

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* Resize Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Resize Canvas</h3>
            
            {/* Memory warning for resize */}
            <DocumentMemoryWarning
              width={typeof resizeWidth === 'string' ? parseInt(resizeWidth) || 1 : resizeWidth}
              height={typeof resizeHeight === 'string' ? parseInt(resizeHeight) || 1 : resizeHeight}
            />
            
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
                  disabled={isResizing}
                >
                  {isResizing ? 'Resizing...' : 'Resize'}
                </Button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* Canvas Shape Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Canvas Shape</h3>
            <p className="text-xs text-[#9AA0A6] mb-3">
              Pick a shape tool, then draw the new canvas bounds directly on the canvas.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => handleCanvasShapeTool('rectangle')}
                variant="secondary"
                size="sm"
              >
                Rectangular
              </Button>
              <Button
                onClick={() => handleCanvasShapeTool('circle')}
                variant="secondary"
                size="sm"
              >
                Circle
              </Button>
              <Button
                onClick={() => handleCanvasShapeTool('freehand')}
                variant="secondary"
                size="sm"
              >
                Freehand
              </Button>
            </div>
            <p className="text-[11px] text-[#8B8B8B] mt-2">
              Press Enter to confirm, Esc to cancel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
