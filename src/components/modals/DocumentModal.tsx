import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';

interface DocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocumentModal: React.FC<DocumentModalProps> = ({ isOpen, onClose }) => {
  const { project, newProject, resizeCanvas } = useAppStore();
  
  const [resizeWidth, setResizeWidth] = useState(project?.width || 800);
  const [resizeHeight, setResizeHeight] = useState(project?.height || 600);
  const [newWidth, setNewWidth] = useState(800);
  const [newHeight, setNewHeight] = useState(600);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // Small delay to ensure the modal is rendered before fading in
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

  const handleResize = () => {
    if (project) {
      resizeCanvas(resizeWidth, resizeHeight);
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
      className={`fixed inset-0 flex items-center justify-center z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div 
        className={`bg-[#31313A] rounded-lg p-6 w-96 max-w-full mx-4 shadow-xl transition-all duration-300 ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#D9D9D9] text-base font-semibold">Document</h2>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white transition-colors p-1"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Resize Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">Resize Canvas</h3>
            <div className="flex gap-3">
              <div className="w-20">
                <label className="block text-base text-[#888] mb-1">Width</label>
                <Input
                  type="number"
                  value={resizeWidth}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      return; // Don't update state for empty values
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
                      return; // Don't update state for empty values
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
                <button
                  onClick={handleResize}
                  className="w-36 px-4 h-[25px] bg-[#D9D9D9] border-2 border-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] hover:text-[#31313A]  text-base transition-all duration-300 whitespace-nowrap text-center"
                >
                  Resize
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-[#555]"></div>

          {/* New Document Section */}
          <div>
            <h3 className="text-[#D9D9D9] text-base font-medium mb-3">New Document</h3>
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
                <button
                  onClick={handleNewDocument}
                  className="w-36 px-4 h-[25px] bg-[#D9D9D9] border-2 border-[#D9D9D9] text-[#31313A] hover:bg-[#C4C4C4] hover:text-[#31313A]  text-base transition-all duration-300 whitespace-nowrap text-center"
                >
                  New Document
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};