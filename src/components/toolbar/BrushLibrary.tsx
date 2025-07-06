'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import { BrushPreset } from '@/types/brush';
import { BrushThumbnailGenerator } from '@/utils/BrushThumbnailGenerator';

/**
 * BrushLibrary - Exact match to screenshot UI
 * Features: Header with +, favorites section, scrollable list, star icons
 */
export const BrushLibrary = () => {
  const { 
    brushLibrary, 
    selectedBrushPreset,
    selectBrushPreset,
    toggleBrushFavorite 
  } = useAppStore();
  
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  
  // Get brushes and favorites from store
  const brushes = brushLibrary.brushes;
  const favorites = brushLibrary.favorites;

  // Preload thumbnails when component mounts
  useEffect(() => {
    const generateThumbnails = async () => {
      const thumbnailMap = new Map<string, string>();
      
      // Generate thumbnails for all brushes
      brushes.forEach(brush => {
        const thumbnail = BrushThumbnailGenerator.generateThumbnail(brush);
        thumbnailMap.set(brush.id, thumbnail);
      });
      
      setThumbnails(thumbnailMap);
    };

    // Small delay to ensure DOM is ready
    setTimeout(generateThumbnails, 100);
  }, [brushes]);

  // Get favorite brushes (appear at top)
  const favoriteBrushes = brushes.filter(brush => favorites.includes(brush.id));
  
  // Get regular brushes (appear below favorites)  
  const regularBrushes = brushes.filter(brush => !favorites.includes(brush.id));

  const toggleFavorite = (brushId: string) => {
    toggleBrushFavorite(brushId);
  };
  
  const handleBrushSelect = (brushId: string) => {
    selectBrushPreset(brushId);
  };

  const BrushItem = ({ brush }: { brush: BrushPreset }) => {
    const isSelected = selectedBrushPreset === brush.id;
    
    return (
      <div 
        className={`flex items-center justify-between px-3 py-2 hover:bg-[#404040] cursor-pointer group ${
          isSelected ? 'bg-[#60a5fa] hover:bg-[#60a5fa]' : ''
        }`}
        onClick={() => handleBrushSelect(brush.id)}
      >
      {/* Brush thumbnail and name */}
      <div className="flex items-center gap-3">
        {/* Thumbnail - actual brush stroke preview */}
        <div className="w-8 h-6 bg-[#1a1a1a] border border-[#404040] rounded flex items-center justify-center overflow-hidden">
          {thumbnails.has(brush.id) ? (
            <img 
              src={thumbnails.get(brush.id)} 
              alt={`${brush.name} preview`}
              className="w-5 h-3 object-contain"
            />
          ) : (
            // Fallback while thumbnail loads
            <div className="w-4 h-2 bg-[#666] rounded-sm opacity-50" />
          )}
        </div>
        
        {/* Brush name */}
        <span className="text-white text-sm font-medium">{brush.name}</span>
      </div>

      {/* Star icon for favorites */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleFavorite(brush.id);
        }}
        className="text-[#666] hover:text-[#60a5fa] transition-colors"
      >
        {favorites.includes(brush.id) ? (
          <span className="text-[#60a5fa]">★</span>
        ) : (
          <span>☆</span>
        )}
      </button>
    </div>
    );
  };

  return (
    <div className="w-full bg-[#2a2a2a] border-l border-[#404040]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-[#404040]">
        <h3 className="text-white text-sm font-medium">Brush library</h3>
        <button 
          className="w-6 h-6 bg-[#404040] hover:bg-[#60a5fa] text-white rounded flex items-center justify-center text-sm transition-colors"
          title="Add new brush"
        >
          +
        </button>
      </div>

      {/* Scrollable brush list */}
      <div className="h-64 overflow-y-auto">
        {/* Favorites section */}
        {favoriteBrushes.length > 0 && (
          <>
            {favoriteBrushes.map(brush => (
              <BrushItem key={brush.id} brush={brush} />
            ))}
            
            {/* Separator line between favorites and regular brushes */}
            {regularBrushes.length > 0 && (
              <div className="border-b border-[#404040] mx-3 my-2" />
            )}
          </>
        )}

        {/* Regular brushes */}
        {regularBrushes.map(brush => (
          <BrushItem key={brush.id} brush={brush} />
        ))}
      </div>
    </div>
  );
};