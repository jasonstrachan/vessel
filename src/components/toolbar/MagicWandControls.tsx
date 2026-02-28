'use client';

import React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import CustomSwitch from '@/components/ui/CustomSwitch';
import ProgressSlider from '@/components/ui/ProgressSlider';

export default function MagicWandControls() {
  const wandSettings = useAppStore((state) => state.tools.wandSettings);
  const setWandSettings = useAppStore((state) => state.setWandSettings);

  return (
    <div className="p-4">
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Threshold
          </label>
          <ProgressSlider
            value={wandSettings.threshold}
            min={0}
            max={255}
            step={1}
            onChange={(value) => setWandSettings({ threshold: Math.round(value) })}
            aria-label="Magic Wand Threshold"
            className="flex-1"
          />
        </div>
      </div>

      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label htmlFor="magic-wand-connected-pixels" className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Connected
          </label>
          <CustomSwitch
            id="magic-wand-connected-pixels"
            checked={wandSettings.contiguous}
            onChange={(checked) => setWandSettings({ contiguous: checked })}
          />
        </div>
      </div>
    </div>
  );
}
