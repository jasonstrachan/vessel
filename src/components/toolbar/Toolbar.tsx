'use client';

import { useAppStore } from '@/stores/useAppStore';
import { CustomBrushPanel } from './CustomBrushPanel';

export const Toolbar = () => {
  const { brushSettings, setBrushSettings } = useAppStore();

  return (
    <div className="w-72 bg-[#2a2a2a] border-l border-[#404040] flex flex-col p-3 space-y-4 overflow-y-auto max-h-full">
      {/* Color */}
      <div className="flex items-center gap-3">
        <span className="text-white text-base font-light w-14">Color</span>
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

      {/* Pixel */}
      <div className="flex items-center gap-3">
        <span className="text-white text-base font-light w-14">Pixel</span>
        <div 
          onClick={() => {
            console.log('🔄 Pixel toggle clicked. Current:', brushSettings.pixelPerfect, '-> New:', !brushSettings.pixelPerfect);
            setBrushSettings({ pixelPerfect: !brushSettings.pixelPerfect });
          }}
          className="w-12 h-6 border-2 border-white cursor-pointer relative bg-gray-800"
        >
          <div 
            className={`w-5 h-4 bg-white absolute top-0.5 transition-transform ${
              brushSettings.pixelPerfect ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
        </div>
      </div>

      {/* Shape */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Shape</span>
        <div className="flex gap-2">
          <div 
            onClick={() => setBrushSettings({ brushShape: 'square', selectedCustomBrush: null })}
            className={`w-8 h-8 border-2 cursor-pointer transition-colors ${
              brushSettings.brushShape === 'square' 
                ? 'border-white bg-white' 
                : 'border-white bg-transparent hover:bg-gray-700'
            }`}
          />
          <div 
            onClick={() => setBrushSettings({ brushShape: 'circle', selectedCustomBrush: null })}
            className={`w-8 h-8 rounded-full border-2 border-white cursor-pointer transition-colors ${
              brushSettings.brushShape === 'circle' 
                ? 'bg-white' 
                : 'bg-gray-400 hover:bg-gray-300'
            }`}
          />
          <div 
            onClick={() => {}}
            className={`w-8 h-8 border-2 cursor-pointer transition-colors flex items-center justify-center text-white text-xs ${
              brushSettings.brushShape === 'custom' 
                ? 'border-white bg-[#60a5fa]' 
                : 'border-white bg-transparent hover:bg-gray-700'
            }`}
            title="Custom brush (select from panel below)"
          >
            ⚏
          </div>
        </div>
      </div>

      {/* Size */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Size</span>
        <div className="flex items-center gap-3 flex-1">
          <input 
            type="number"
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) || 1 })}
            className="w-20 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="50"
          />
          <div className="flex-1 bg-[#3a3a3a] border-2 border-white h-8 relative">
            <input
              type="range"
              min="1"
              max="50"
              value={brushSettings.size}
              onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
              className="w-full h-full appearance-none bg-transparent cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Spacing */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Spacing</span>
        <div className="flex items-center gap-3 flex-1">
          <input 
            type="number"
            value={brushSettings.spacing}
            onChange={(e) => setBrushSettings({ spacing: parseInt(e.target.value) || 1 })}
            className="w-20 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
            min="1"
            max="50"
          />
          <div className="flex-1 bg-[#3a3a3a] border-2 border-white h-8 relative">
            <input
              type="range"
              min="1"
              max="50"
              value={brushSettings.spacing}
              onChange={(e) => setBrushSettings({ spacing: parseInt(e.target.value) })}
              className="w-full h-full appearance-none bg-transparent cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                         [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Brush sz */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-16">Brush sz</span>
        <div 
          onClick={() => setBrushSettings({ followBrush: !brushSettings.followBrush })}
          className="w-12 h-6 border-2 border-white cursor-pointer relative bg-gray-800"
        >
          <div 
            className={`w-5 h-4 bg-white absolute top-0.5 transition-transform ${
              brushSettings.followBrush ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
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
          className="w-12 h-6 border-2 border-white cursor-pointer relative bg-gray-800"
        >
          <div 
            className={`w-5 h-4 bg-white absolute top-0.5 transition-transform ${
              brushSettings.dottedStyle.enabled ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
        </div>
      </div>

      {/* Expandable Dotted Settings with Smooth Animation */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          brushSettings.dottedStyle.enabled ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="space-y-4">
          <div className="h-px bg-[#404040]" />
          
          {/* Length - in brush size units */}
          <div className="flex items-center gap-4">
            <span className="text-white text-lg font-light w-20">Length</span>
            <div className="flex items-center gap-3 flex-1">
              <input 
                type="number"
                value={brushSettings.dottedStyle.dashLength}
                onChange={(e) => setBrushSettings({ 
                  dottedStyle: { ...brushSettings.dottedStyle, dashLength: parseInt(e.target.value) || 1 }
                })}
                className="w-16 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
                min="1"
                max="10"
              />
              <div className="flex-1 bg-[#3a3a3a] border-2 border-white h-8 relative">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={brushSettings.dottedStyle.dashLength}
                  onChange={(e) => setBrushSettings({ 
                    dottedStyle: { ...brushSettings.dottedStyle, dashLength: parseInt(e.target.value) }
                  })}
                  className="w-full h-full appearance-none bg-transparent cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                             [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Gap - in brush size units */}
          <div className="flex items-center gap-4">
            <span className="text-white text-lg font-light w-20">Gap</span>
            <div className="flex items-center gap-3 flex-1">
              <input 
                type="number"
                value={brushSettings.dottedStyle.gap}
                onChange={(e) => setBrushSettings({ 
                  dottedStyle: { ...brushSettings.dottedStyle, gap: parseInt(e.target.value) || 1 }
                })}
                className="w-16 h-8 bg-transparent border-2 border-white text-white text-center text-sm"
                min="1"
                max="10"
              />
              <div className="flex-1 bg-[#3a3a3a] border-2 border-white h-8 relative">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={brushSettings.dottedStyle.gap}
                  onChange={(e) => setBrushSettings({ 
                    dottedStyle: { ...brushSettings.dottedStyle, gap: parseInt(e.target.value) }
                  })}
                  className="w-full h-full appearance-none bg-transparent cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                             [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-none [&::-webkit-slider-thumb]:cursor-pointer"
                />
              </div>
            </div>
          </div>
          
          {/* Bottom grey line for dotted section */}
          <div className="h-px bg-[#404040]" />
        </div>
      </div>

      {/* Rotate */}
      <div className="flex items-center gap-4">
        <span className="text-white text-lg font-light w-20">Rotate</span>
        <div 
          onClick={() => setBrushSettings({ rotateEnabled: !brushSettings.rotateEnabled })}
          className="w-12 h-6 border-2 border-white cursor-pointer relative bg-gray-800"
        >
          <div 
            className={`w-5 h-4 bg-white absolute top-0.5 transition-transform ${
              brushSettings.rotateEnabled ? 'translate-x-5.5' : 'translate-x-0.5'
            }`}
          />
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
            className="w-12 h-6 border-2 border-white cursor-pointer relative bg-gray-800"
          >
            <div 
              className={`w-5 h-4 bg-white absolute top-0.5 transition-transform ${
                brushSettings.pressureSettings.enabled ? 'translate-x-5.5' : 'translate-x-0.5'
              }`}
            />
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

      {/* Custom Brush Panel */}
      <CustomBrushPanel />
    </div>
  );
};