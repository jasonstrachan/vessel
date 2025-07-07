import React from 'react';

const BrushLibrary = () => {
  const brushes = Array.from({ length: 14 }, (_, i) => ({
    id: i + 1,
    name: 'Pixel short round',
    preview: '~~~~~',
    active: false,
    rating: i < 3 ? 'filled' : 'outline', // First 3 get filled stars, rest get outline
  }));

  return (
    <div className="flex-1 border-b border-[#404040] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 bg-[#353535] border-b border-[#404040]">
        <span className="text-base font-medium">Brush Library</span>
        <button className="text-sm bg-[#404040] px-2 py-1 rounded">+</button>
      </div>
      
      <div className="flex-1 p-2 space-y-1 overflow-y-auto">
        {brushes.map((brush) => (
          <div
            key={brush.id}
            className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#404040] cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 bg-[#606060] rounded-sm flex items-center justify-center text-xs">
                {brush.preview}
              </div>
              <span className="text-sm">{brush.name}</span>
            </div>
            <div className="flex items-center space-x-1">
              <span className="text-sm text-gray-400">
                {brush.rating === 'filled' ? '★' : '☆'}
              </span>
              <button className="text-sm text-[#888] hover:text-white">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrushLibrary;