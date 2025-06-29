'use client';

import { useAppStore } from '@/stores/useAppStore';

export const BrushSettings = () => {
  const { brushSettings, setBrushSettings } = useAppStore();

  return (
    <div className="p-4 space-y-6">
      <h3 className="text-slate-100 font-semibold text-sm tracking-wide">BRUSH SETTINGS</h3>
      
      {/* Brush Size */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-slate-300 text-xs font-medium">Size</label>
          <span className="text-slate-100 text-xs font-mono bg-slate-800 px-2 py-1 rounded">
            {brushSettings.size}px
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          value={brushSettings.size}
          onChange={(e) => setBrushSettings({ size: parseInt(e.target.value) })}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-slate-100 [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-600"
        />
      </div>

      {/* Opacity */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-slate-300 text-xs font-medium">Opacity</label>
          <span className="text-slate-100 text-xs font-mono bg-slate-800 px-2 py-1 rounded">
            {Math.round(brushSettings.opacity * 100)}%
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={brushSettings.opacity}
          onChange={(e) => setBrushSettings({ opacity: parseFloat(e.target.value) })}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 
                     [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-slate-100 [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-slate-600"
        />
      </div>

      {/* Pixel Perfect Toggle */}
      <div className="flex items-center justify-between">
        <label htmlFor="pixelPerfect" className="text-slate-300 text-xs font-medium">
          Pixel Perfect
        </label>
        <button
          onClick={() => setBrushSettings({ pixelPerfect: !brushSettings.pixelPerfect })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
            brushSettings.pixelPerfect ? 'bg-slate-500' : 'bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${
              brushSettings.pixelPerfect ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Follow Brush Toggle */}
      <div className="flex items-center justify-between">
        <label htmlFor="followBrush" className="text-slate-300 text-xs font-medium">
          Follow Direction
        </label>
        <button
          onClick={() => setBrushSettings({ followBrush: !brushSettings.followBrush })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
            brushSettings.followBrush ? 'bg-slate-500' : 'bg-slate-700'
          }`}
        >
          <span
            className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${
              brushSettings.followBrush ? 'translate-x-5' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Dotted Style */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="dottedStyle" className="text-slate-300 text-xs font-medium">
            Dotted Style
          </label>
          <button
            onClick={() => setBrushSettings({ 
              dottedStyle: { ...brushSettings.dottedStyle, enabled: !brushSettings.dottedStyle.enabled }
            })}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
              brushSettings.dottedStyle.enabled ? 'bg-slate-500' : 'bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform duration-200 ${
                brushSettings.dottedStyle.enabled ? 'translate-x-5' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {brushSettings.dottedStyle.enabled && (
          <div className="space-y-2 pl-4 border-l border-slate-600">
            {/* Spacing */}
            <div>
              <label className="text-slate-400 text-xs">
                Spacing: {brushSettings.dottedStyle.spacing}px
              </label>
              <input
                type="range"
                min="1"
                max="50"
                value={brushSettings.dottedStyle.spacing}
                onChange={(e) => setBrushSettings({
                  dottedStyle: { 
                    ...brushSettings.dottedStyle, 
                    spacing: parseInt(e.target.value) 
                  }
                })}
                className="w-full accent-slate-500"
              />
            </div>

            {/* Dash Length */}
            <div>
              <label className="text-slate-400 text-xs">
                Dash Length: {brushSettings.dottedStyle.dashLength}px
              </label>
              <input
                type="range"
                min="1"
                max="30"
                value={brushSettings.dottedStyle.dashLength}
                onChange={(e) => setBrushSettings({
                  dottedStyle: { 
                    ...brushSettings.dottedStyle, 
                    dashLength: parseInt(e.target.value) 
                  }
                })}
                className="w-full accent-slate-500"
              />
            </div>

            {/* Dash Spacing */}
            <div>
              <label className="text-slate-400 text-xs">
                Dash Spacing: {brushSettings.dottedStyle.dashSpacing}px
              </label>
              <input
                type="range"
                min="1"
                max="20"
                value={brushSettings.dottedStyle.dashSpacing}
                onChange={(e) => setBrushSettings({
                  dottedStyle: { 
                    ...brushSettings.dottedStyle, 
                    dashSpacing: parseInt(e.target.value) 
                  }
                })}
                className="w-full accent-slate-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};