'use client';

import React from 'react';
import { useAppStore } from '../../stores/useAppStore';
import CustomSwitch from '../ui/CustomSwitch';
import ProgressSlider from '../ui/ProgressSlider';

export default function FillControls() {
  const fillSettings = useAppStore((state) => state.tools.fillSettings);
  const setFillSettings = useAppStore((state) => state.setFillSettings);

  return (
    <div className="p-4">
      {/* Threshold */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Threshold
          </label>
          <ProgressSlider
            value={fillSettings.threshold}
            min={0}
            max={255}
            step={1}
            onChange={(value) => setFillSettings({ threshold: Math.round(value) })}
            aria-label="Fill Threshold"
            className="flex-1"
          />
        </div>
      </div>

      {/* Connected Pixels */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="connected-pixels" className="text-[#D9D9D9] w-16" style={{ fontSize: "14px" }}>
            Connected
          </label>
          <CustomSwitch
            id="connected-pixels"
            checked={fillSettings.contiguous}
            onChange={(checked) => setFillSettings({ contiguous: checked })}
          />
        </div>
      </div>
    </div>
  );
}
