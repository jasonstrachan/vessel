import React, { useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-[#31313A] rounded-lg p-6 w-96 max-w-full mx-4 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#D9D9D9] text-lg font-semibold">Document</h2>
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
            <h3 className="text-[#D9D9D9] text-sm font-medium mb-3">Resize Canvas</h3>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-[#888] mb-1">Width</label>
                <input
                  type="number"
                  value={resizeWidth}
                  onChange={(e) => setResizeWidth(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[#404040] border border-[#555] text-[#D9D9D9] text-sm focus:outline-none focus:border-blue-500"
                  min="1"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-[#888] mb-1">Height</label>
                <input
                  type="number"
                  value={resizeHeight}
                  onChange={(e) => setResizeHeight(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[#404040] border border-[#555] text-[#D9D9D9] text-sm focus:outline-none focus:border-blue-500"
                  min="1"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleResize}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors whitespace-nowrap"
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
            <h3 className="text-[#D9D9D9] text-sm font-medium mb-3">New Document</h3>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-[#888] mb-1">Width</label>
                <input
                  type="number"
                  value={newWidth}
                  onChange={(e) => setNewWidth(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[#404040] border border-[#555] rounded text-white text-sm focus:outline-none focus:border-green-500"
                  min="1"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-[#888] mb-1">Height</label>
                <input
                  type="number"
                  value={newHeight}
                  onChange={(e) => setNewHeight(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-[#404040] border border-[#555] rounded text-white text-sm focus:outline-none focus:border-green-500"
                  min="1"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleNewDocument}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm transition-colors whitespace-nowrap"
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