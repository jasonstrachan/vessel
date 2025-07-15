'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import Input from '../ui/Input';

export default function FillControls() {
  const { tools, setFillSettings, setBrushSettings } = useAppStore();
  const { fillSettings, brushSettings } = tools;

  return (
    <div className="p-4 bg-[#31313A]">
      
      {/* Fill Color */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">Fill Color</label>
        <div className="flex items-center gap-2">
          <Input
            type="color"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
          />
          <Input
            type="text"
            value={brushSettings.color}
            onChange={(e) => setBrushSettings({ color: e.target.value })}
            variant="hex"
            placeholder="#000000"
            fullWidth
          />
        </div>
      </div>

      {/* Threshold */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Threshold: {fillSettings.threshold}
        </label>
        <Input
          type="range"
          min="0"
          max="255"
          step="1"
          value={fillSettings.threshold}
          onChange={(e) => setFillSettings({ threshold: Math.min(255, Math.max(0, parseInt(e.target.value))) })}
          fullWidth
        />
      </div>

      {/* Connected Pixels */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">Connected Pixels</label>
        <div className="flex items-center gap-2">
          <Input
            type="checkbox"
            checked={fillSettings.contiguous}
            onChange={(e) => setFillSettings({ contiguous: e.target.checked })}
          />
          <span className="text-base text-[#D9D9D9]">
            {fillSettings.contiguous ? 'On' : 'Off'}
          </span>
        </div>
      </div>

    </div>
  );
}