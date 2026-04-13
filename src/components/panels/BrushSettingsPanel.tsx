'use client';

import React from 'react';
import BrushControls from '@/components/toolbar/BrushControls';
import FillControls from '@/components/toolbar/FillControls';
import { CustomBrushPanel } from '@/components/toolbar/CustomBrushPanel';
import { ColorCycleUI } from '@/components/colorCycle/integration/ColorCycleUI';
import BrushEditorUI from '@/components/BrushEditorUI';
import ColorSlidersPanel from '@/components/panels/ColorSlidersPanel';
import CropOptionsPanel from '@/components/panels/CropOptionsPanel';
import ColorPickerToolPanel from '@/components/panels/ColorPickerToolPanel';
import SelectionOptionsPanel from '@/components/panels/SelectionOptionsPanel';
import { DisplayFiltersSection } from '@/components/panels/DisplayFiltersSection';
import { useAppStore } from '@/stores/useAppStore';
import ColorAdjustToolPanel from '@/components/panels/ColorAdjustToolPanel';
import { brushCache } from '@/utils/brushCache';
import { scaledBrushCache } from '@/utils/scaledBrushCache';
import { BrushShape } from '@/types';
import {
  selectBrushEditor,
  selectBrushSettings,
  selectCurrentTool,
} from '@/stores/selectors/toolsSelectors';

const BrushSettingsPanel: React.FC = () => {
  const currentTool = useAppStore(selectCurrentTool);
  const brushEditorStatus = useAppStore(selectBrushEditor).status;
  const brushSettings = useAppStore(selectBrushSettings);
  const brushPanelSection = useAppStore((state) => state.ui.brushPanelSection);
  const setBrushSettings = useAppStore(state => state.setBrushSettings);

  const hueShift = brushSettings.hueShift ?? 0;
  const lightness = brushSettings.lightnessAdjust ?? 0;
  const saturation = brushSettings.saturationAdjust ?? 100;

  const getCurrentBrushId = React.useCallback(() => {
    if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush) {
      return brushSettings.selectedCustomBrush;
    }
    return `standard_${brushSettings.brushShape}`;
  }, [brushSettings.brushShape, brushSettings.selectedCustomBrush]);

  const handleHueShiftChange = React.useCallback((newHueShift: number) => {
    setBrushSettings({ hueShift: newHueShift });

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  const handleSaturationChange = React.useCallback((newSaturation: number) => {
    setBrushSettings({ saturationAdjust: newSaturation });

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  const handleLightnessChange = React.useCallback((newLightness: number) => {
    setBrushSettings({ lightnessAdjust: newLightness });

    if (brushSettings.brushShape === BrushShape.CUSTOM) {
      const brushId = getCurrentBrushId();
      scaledBrushCache.clearForBrush(brushId);
      scaledBrushCache.clearForBrush('current-brush-tip');
      brushCache.clear();
    }
  }, [brushSettings.brushShape, getCurrentBrushId, setBrushSettings]);

  const shouldShowBrushEditor =
    brushSettings.brushShape === BrushShape.CUSTOM || brushEditorStatus === 'EDITING';

  const isFiltersSection = brushPanelSection === 'filters';

  return (
    <div className="bg-[#1A1A1A] flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {isFiltersSection ? (
          <div className="px-4 py-4">
            <DisplayFiltersSection />
          </div>
        ) : currentTool === 'crop' ? (
          <CropOptionsPanel />
        ) : (
          <>
            {currentTool === 'color-picker' && <ColorPickerToolPanel />}
            {currentTool === 'selection' && <SelectionOptionsPanel />}
            {(currentTool === 'brush' || currentTool === 'eraser') && <BrushControls />}
            {currentTool === 'fill' && <FillControls />}
            {currentTool === 'custom' && <CustomBrushPanel />}
            {brushSettings.brushShape === BrushShape.CUSTOM && (
              <div className="px-4 pb-0">
                <ColorSlidersPanel
                  hueShift={hueShift}
                  lightness={lightness}
                  saturation={saturation}
                  onHueShiftChange={handleHueShiftChange}
                  onLightnessChange={handleLightnessChange}
                  onSaturationChange={handleSaturationChange}
                  brushShape={brushSettings.brushShape}
                />
              </div>
            )}
            {currentTool === 'recolor' && (
              <div className="p-2">
                <ColorCycleUI isVisible={true} />
              </div>
            )}
            {currentTool === 'color-adjust' && <ColorAdjustToolPanel />}
            {shouldShowBrushEditor && <BrushEditorUI key={brushEditorStatus} />}
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(BrushSettingsPanel);
