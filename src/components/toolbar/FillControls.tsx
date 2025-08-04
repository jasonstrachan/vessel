'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { Switch } from '../retroui/Switch';

export default function FillControls() {
  const { tools, setFillSettings } = useAppStore();
  const { fillSettings } = tools;

  return (
    <div className="bg-[#31313A] p-4">
      {/* Threshold */}
      <div className="mb-4">
        <label className="block text-base text-[#D9D9D9] mb-2">
          Threshold: {fillSettings.threshold}
        </label>
        <input
          type="range"
          className="slider w-full"
          value={fillSettings.threshold}
          min={0}
          max={255}
          step={1}
          onChange={(e) => setFillSettings({ threshold: parseInt(e.target.value) })}
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
  );
}