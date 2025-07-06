'use client';

import { BrushLibrary } from './BrushLibrary';
import { BrushSettings } from './BrushSettings';
import { CustomBrushPanel } from './CustomBrushPanel';

/**
 * Main Toolbar - Right column with brush library and settings
 * Matches screenshot layout exactly
 */
export const Toolbar = () => {
  return (
    <div className="flex flex-col h-full w-80 bg-[#2a2a2a] border-l border-[#404040]">
      {/* Brush Library */}
      <BrushLibrary />
      
      {/* Brush Settings */}
      <BrushSettings />
      
      {/* Custom Brush Panel - legacy component for now */}
      <div className="mt-4">
        <CustomBrushPanel />
      </div>
    </div>
  );
};