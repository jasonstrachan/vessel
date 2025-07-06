'use client';

import { useAppStore } from '@/stores/useAppStore';
import DragInput from '@/components/ui/DragInput';
import { HSVColorPicker } from '@/components/toolbar/HSVColorPicker';

/**
 * BrushSettings - Exact match to screenshot layout
 * Layout: Color, Pixel toggle, Shape options, Size, Brush sz, Dotted section, Rotate, Pressure
 */
export const BrushSettings = () => {
  const { brushSettings, setBrushSettings } = useAppStore();

  return (
    <div className="w-full bg-[#2a2a2a] space-y-4 p-3">
      
      {/* Color */}
      <div className="space-y-2">
        <label className="text-white text-sm font-medium">Color</label>
        <div className="flex items-center">
          <HSVColorPicker 
            color={brushSettings.color}
            onChange={(color) => setBrushSettings({ color })}
          />
        </div>
      </div>

      {/* Pixel toggle */}
      <div className="flex items-center justify-between">
        <label className="text-white text-sm font-medium">Pixel</label>
        <input
          type="checkbox"
          checked={brushSettings.pixelPerfect}
          onChange={(e) => setBrushSettings({ pixelPerfect: e.target.checked })}
          className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
        />
      </div>

      {/* Shape options */}
      <div className="space-y-2">
        <label className="text-white text-sm font-medium">Shape</label>
        <div className="flex items-center gap-2">
          {/* Square */}
          <button
            onClick={() => setBrushSettings({ brushShape: 'square' })}
            className={`w-6 h-6 border border-[#404040] ${
              brushSettings.brushShape === 'square' 
                ? 'bg-[#60a5fa] border-[#60a5fa]' 
                : 'bg-[#1a1a1a] hover:bg-[#404040]'
            } transition-colors`}
            title="Square brush"
          />
          
          {/* Circle */}
          <button
            onClick={() => setBrushSettings({ brushShape: 'circle' })}
            className={`w-6 h-6 rounded-full border border-[#404040] ${
              brushSettings.brushShape === 'circle' 
                ? 'bg-[#60a5fa] border-[#60a5fa]' 
                : 'bg-[#1a1a1a] hover:bg-[#404040]'
            } transition-colors`}
            title="Circle brush"
          />
          
          {/* Triangle */}
          <button
            onClick={() => setBrushSettings({ brushShape: 'custom' })}
            className={`w-6 h-6 border border-[#404040] ${
              brushSettings.brushShape === 'custom' 
                ? 'bg-[#60a5fa] border-[#60a5fa]' 
                : 'bg-[#1a1a1a] hover:bg-[#404040]'
            } transition-colors flex items-center justify-center`}
            title="Triangle brush"
          >
            <div className={`w-0 h-0 border-l-2 border-r-2 border-b-3 border-transparent ${
              brushSettings.brushShape === 'custom' ? 'border-b-white' : 'border-b-[#666]'
            }`} />
          </button>
        </div>
      </div>

      {/* Size with slider and numeric input */}
      <div className="space-y-2">
        <label className="text-white text-sm font-medium">Size</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="100"
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
            className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-12 text-center">
            {brushSettings.size}
          </div>
        </div>
      </div>

      {/* Spacing controls */}
      <div className="space-y-2">
        <label className="text-white text-sm font-medium">Spacing</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="1"
            max="50"
            value={brushSettings.spacing.value}
            onChange={(e) => setBrushSettings({ 
              spacing: { 
                ...brushSettings.spacing, 
                value: parseInt(e.target.value) 
              } 
            })}
            className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
          />
          <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-12 text-center">
            {brushSettings.spacing.value}
          </div>
        </div>
        
        {/* Dynamic spacing checkbox */}
        <div className="flex items-center justify-between">
          <label className="text-white text-sm font-medium">Dynamic</label>
          <input
            type="checkbox"
            checked={brushSettings.spacing.dynamicEnabled}
            onChange={(e) => setBrushSettings({ 
              spacing: { 
                ...brushSettings.spacing, 
                dynamicEnabled: e.target.checked 
              } 
            })}
            className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
          />
        </div>
      </div>

      {/* Brush sz toggle */}
      <div className="flex items-center justify-between">
        <label className="text-white text-sm font-medium">Brush sz</label>
        <input
          type="checkbox"
          checked={brushSettings.gridSnap}
          onChange={(e) => setBrushSettings({ gridSnap: e.target.checked })}
          className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
        />
      </div>

      {/* Dotted section */}
      <div className="space-y-3 border-t border-[#404040] pt-3">
        {/* Dotted toggle */}
        <div className="flex items-center justify-between">
          <label className="text-white text-sm font-medium">Dotted</label>
          <input
            type="checkbox"
            checked={brushSettings.dottedStyle.enabled}
            onChange={(e) => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, enabled: e.target.checked }
            })}
            className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
          />
        </div>

        {/* Length slider */}
        <div className="space-y-2">
          <label className="text-white text-sm font-medium">Length</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="10"
              value={brushSettings.dottedStyle.dashLength}
              onChange={(e) => setBrushSettings({ 
                dottedStyle: { ...brushSettings.dottedStyle, dashLength: parseInt(e.target.value) }
              })}
              className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
              disabled={!brushSettings.dottedStyle.enabled}
            />
            <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-8 text-center">
              {brushSettings.dottedStyle.dashLength}
            </div>
          </div>
        </div>

        {/* Gap slider */}
        <div className="space-y-2">
          <label className="text-white text-sm font-medium">Gap</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="10"
              value={brushSettings.dottedStyle.gap}
              onChange={(e) => setBrushSettings({ 
                dottedStyle: { ...brushSettings.dottedStyle, gap: parseInt(e.target.value) }
              })}
              className="flex-1 h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
              disabled={!brushSettings.dottedStyle.enabled}
            />
            <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-8 text-center">
              {brushSettings.dottedStyle.gap}
            </div>
          </div>
        </div>
      </div>

      {/* Rotate toggle */}
      <div className="flex items-center justify-between border-t border-[#404040] pt-3">
        <label className="text-white text-sm font-medium">Rotate</label>
        <input
          type="checkbox"
          checked={brushSettings.rotateEnabled}
          onChange={(e) => setBrushSettings({ rotateEnabled: e.target.checked })}
          className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
        />
      </div>

      {/* Pressure section */}
      <div className="space-y-3 border-t border-[#404040] pt-3">
        {/* Pressure toggle and min/max values */}
        <div className="flex items-center gap-3">
          <label className="text-white text-sm font-medium">Pressure</label>
          <input
            type="checkbox"
            checked={brushSettings.pressureSettings.enabled}
            onChange={(e) => setBrushSettings({ 
              pressureSettings: { ...brushSettings.pressureSettings, enabled: e.target.checked }
            })}
            className="w-4 h-4 bg-[#1a1a1a] border border-[#404040] rounded"
          />
          
          {/* Min value */}
          <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-8 text-center">
            {brushSettings.pressureSettings.minValue}
          </div>
          
          <span className="text-[#666] text-sm">-</span>
          
          {/* Max value */}
          <div className="bg-[#1a1a1a] border border-[#404040] px-2 py-1 rounded text-white text-sm w-8 text-center">
            {brushSettings.pressureSettings.maxValue}
          </div>
        </div>

        {/* Pressure sliders */}
        <div className="space-y-2">
          <input
            type="range"
            min="1"
            max="10"
            value={brushSettings.pressureSettings.minValue}
            onChange={(e) => setBrushSettings({ 
              pressureSettings: { 
                ...brushSettings.pressureSettings, 
                minValue: Math.min(parseInt(e.target.value), brushSettings.pressureSettings.maxValue - 1)
              }
            })}
            className="w-full h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
            disabled={!brushSettings.pressureSettings.enabled}
          />
          <input
            type="range"
            min="2"
            max="20"
            value={brushSettings.pressureSettings.maxValue}
            onChange={(e) => setBrushSettings({ 
              pressureSettings: { 
                ...brushSettings.pressureSettings, 
                maxValue: Math.max(parseInt(e.target.value), brushSettings.pressureSettings.minValue + 1)
              }
            })}
            className="w-full h-2 bg-[#1a1a1a] rounded-lg appearance-none cursor-pointer slider"
            disabled={!brushSettings.pressureSettings.enabled}
          />
        </div>
      </div>
    </div>
  );
};