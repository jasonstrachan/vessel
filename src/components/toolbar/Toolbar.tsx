'use client';

import { useAppStore } from '@/stores/useAppStore';

export const Toolbar = () => {
  const { brushSettings, setBrushSettings } = useAppStore();

  return (
    <div className="w-80 bg-[#2a2a2a] border-l border-[#404040] flex flex-col p-4 space-y-6">
      {/* Color */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Color</span>
        <div className="relative">
          <input
            type="color"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            className="w-8 h-8 rounded-full border-2 border-gray-400 cursor-pointer opacity-0 absolute"
          />
          <div 
            className="w-8 h-8 rounded-full border-2 border-gray-400 cursor-pointer"
            style={{ backgroundColor: brushSettings.color }}
          />
        </div>
      </div>

      {/* Shape */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Shape</span>
        <div className="flex gap-2">
          <div 
            onClick={() => setBrushSettings({ brushShape: 'square' })}
            className={`w-8 h-8 border-2 cursor-pointer transition-colors ${
              brushSettings.brushShape === 'square' 
                ? 'border-white bg-white' 
                : 'border-white bg-transparent hover:bg-gray-700'
            }`}
          />
          <div 
            onClick={() => setBrushSettings({ brushShape: 'circle' })}
            className={`w-8 h-8 rounded-full border-2 border-white cursor-pointer transition-colors ${
              brushSettings.brushShape === 'circle' 
                ? 'bg-white' 
                : 'bg-gray-400 hover:bg-gray-300'
            }`}
          />
        </div>
      </div>

      {/* Size */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Size</span>
        <div className="flex items-center gap-2 flex-1">
          <input 
            type="number"
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) || 1 })}
            className="w-16 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="200"
          />
          <input
            type="range"
            min="1"
            max="200"
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
            className="flex-1 h-1 bg-gray-600 appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-400"
          />
        </div>
      </div>

      <div className="h-px bg-[#404040]" />

      {/* Dotted */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Dotted</span>
        <div 
          onClick={() => setBrushSettings({ 
            dottedStyle: { ...brushSettings.dottedStyle, enabled: !brushSettings.dottedStyle.enabled }
          })}
          className="w-6 h-6 border-2 border-white bg-transparent cursor-pointer flex items-center justify-center"
        >
          {brushSettings.dottedStyle.enabled && <div className="w-3 h-3 bg-white" />}
        </div>
      </div>

      {/* Size aligned */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Size aligned</span>
        <div 
          onClick={() => setBrushSettings({ pixelPerfect: !brushSettings.pixelPerfect })}
          className="w-6 h-6 border-2 border-white bg-transparent cursor-pointer flex items-center justify-center"
        >
          {brushSettings.pixelPerfect && <div className="w-3 h-3 bg-white" />}
        </div>
      </div>

      {/* Spacing */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Spacing</span>
        <div className="flex items-center gap-2 flex-1">
          <input 
            type="number"
            value={brushSettings.dottedStyle.spacing}
            onChange={(e) => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, spacing: parseInt(e.target.value) || 1 }
            })}
            className="w-16 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="50"
          />
          <input
            type="range"
            min="1"
            max="50"
            value={brushSettings.dottedStyle.spacing}
            onChange={(e) => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, spacing: parseInt(e.target.value) }
            })}
            className="flex-1 h-1 bg-gray-600 appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-400"
          />
        </div>
      </div>

      {/* Length */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Length</span>
        <div className="flex items-center gap-2 flex-1">
          <input 
            type="number"
            value={brushSettings.dottedStyle.dashLength}
            onChange={(e) => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, dashLength: parseInt(e.target.value) || 1 }
            })}
            className="w-16 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="30"
          />
          <input
            type="range"
            min="1"
            max="30"
            value={brushSettings.dottedStyle.dashLength}
            onChange={(e) => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, dashLength: parseInt(e.target.value) }
            })}
            className="flex-1 h-1 bg-gray-600 appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 
                       [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-400"
          />
        </div>
      </div>

      <div className="h-px bg-[#404040]" />

      {/* Rotate */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Rotate</span>
        <div 
          onClick={() => setBrushSettings({ followBrush: !brushSettings.followBrush })}
          className="w-6 h-6 border-2 border-white bg-transparent cursor-pointer flex items-center justify-center"
        >
          {brushSettings.followBrush && <div className="w-3 h-3 bg-white" />}
        </div>
      </div>

      {/* Pressure */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Pressure</span>
        <div className="flex items-center gap-2">
          <div 
            onClick={() => setBrushSettings({ 
              pressureSettings: { ...brushSettings.pressureSettings, enabled: !brushSettings.pressureSettings.enabled }
            })}
            className="w-6 h-6 border-2 border-white bg-transparent cursor-pointer flex items-center justify-center"
          >
            {brushSettings.pressureSettings.enabled && <div className="w-3 h-3 bg-white" />}
          </div>
          <input 
            type="number"
            value={brushSettings.pressureSettings.minValue}
            onChange={(e) => setBrushSettings({ 
              pressureSettings: { ...brushSettings.pressureSettings, minValue: parseInt(e.target.value) || 1 }
            })}
            className="w-12 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="10"
          />
          <span className="text-white">-</span>
          <input 
            type="number"
            value={brushSettings.pressureSettings.maxValue}
            onChange={(e) => setBrushSettings({ 
              pressureSettings: { ...brushSettings.pressureSettings, maxValue: parseInt(e.target.value) || 5 }
            })}
            className="w-12 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="10"
          />
        </div>
      </div>
    </div>
  );
};