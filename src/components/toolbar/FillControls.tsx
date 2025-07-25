'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import Input from '../ui/Input';
import { Switch } from '../retroui/Switch';
import { Slider } from '../retroui/Slider';
import ColorPicker from './ColorPicker';
import AdvancedColorPicker from './AdvancedColorPicker';

export default function FillControls() {
  const { tools, setFillSettings, setBrushSettings } = useAppStore();
  const { fillSettings, brushSettings } = tools;

  return (
    <div className="bg-[#31313A]">
      {/* Advanced Color Picker - Full Width Section */}
      <div className="mb-3">
        <AdvancedColorPicker
          color={brushSettings.color}
          onChange={(color) => setBrushSettings({ color })}
        />
      </div>

      {/* Rest of controls with padding */}
      <div className="p-4">
        {/* Color */}
        <div className="mb-3">
          <label className="block text-base text-[#D9D9D9] mb-2">Color</label>
          <div className="flex items-start gap-2">
            <ColorPicker
              color={brushSettings.color}
              onChange={(color) => setBrushSettings({ color })}
            />
            <Input
              type="text"
              variant="hex"
              value={brushSettings.color}
              onChange={(e) => setBrushSettings({ color: e.target.value })}
              className="w-22"
              placeholder="#000000"
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>

      {/* Threshold */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Threshold: {fillSettings.threshold}
        </label>
        <Slider
          defaultValue={[fillSettings.threshold]}
          value={[fillSettings.threshold]}
          min={0}
          max={255}
          step={1}
          onValueChange={(value) => setFillSettings({ threshold: value[0] })}
          aria-label="Fill Threshold"
        />
      </div>

      {/* Connected Pixels */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <label htmlFor="connected-pixels" className="text-base text-[#D9D9D9]">Connected Pixels</label>
          <Switch
            id="connected-pixels"
            checked={fillSettings.contiguous}
            onChange={(checked) => setFillSettings({ contiguous: checked })}
          />
        </div>
      </div>
      
      </div>
    </div>
  );
}