'use client';

import React from 'react';
import BrushLibrary from '@/components/BrushLibrary';

const BrushLibraryPanel: React.FC = () => {
  return (
    <div className="bg-[#2C2C2C] h-full overflow-y-auto">
      <BrushLibrary />
    </div>
  );
};

export default React.memo(BrushLibraryPanel);
