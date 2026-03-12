import React from 'react';
import Dropdown from '../ui/Dropdown';
import ProgressSlider from '../ui/ProgressSlider';
import CustomSwitch from '../ui/CustomSwitch';
import Input from '../ui/Input';
import type { BrushSettings } from '@/types';
import { BrushShape } from '@/types';
import type { DitherAlgorithm } from '@/utils/ditherAlgorithms';

type Props = {
  settings: BrushSettings;
  onChange: (updates: Partial<BrushSettings>) => void;
  canToggle?: boolean;
  forceOn?: boolean;
  hideToggle?: boolean; // hides the switch entirely; useful when always-on
  compact?: boolean;
  isDitherPreset?: boolean;
  beforeResolution?: React.ReactNode; // rendered directly before the Resolution slider
  afterPresRes?: React.ReactNode; // rendered directly after PresRes toggle
  afterResolution?: React.ReactNode; // rendered directly after the Resolution slider
  hideLostEdge?: boolean; // suppress the Lostedge slider (useful when shown elsewhere)
  hideResolution?: boolean; // hide the resolution slider (for shape-specific UIs)
  showPxlEdgeToggle?: boolean;
};

export const PATTERN_STYLES: { value: NonNullable<BrushSettings['patternStyle']>; label: string }[] = [
  { value: 'dots', label: 'Dots' },
  { value: 'lines', label: 'Diagonal Lines' },
  { value: 'vertical-lines', label: 'Vertical Lines' },
  { value: 'horizontal-lines', label: 'Horizontal Lines' },
  { value: 'crosshatch', label: 'Crosshatch' },
  { value: 'diagonal', label: 'Diamond' }
];

export const DITHER_OPTIONS: { value: DitherAlgorithm; label: string }[] = [
  { value: 'sierra-lite', label: 'Sierra Lite' },
  { value: 'sierra-2', label: 'Sierra 2-row' },
  { value: 'sierra-3', label: 'Sierra 3-row' },
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg' },
  { value: 'jarvis-judice-ninke', label: 'Jarvis–Judice–Ninke' },
  { value: 'stucki', label: 'Stucki' },
  { value: 'burkes', label: 'Burkes' },
  { value: 'atkinson', label: 'Atkinson' },
  { value: 'bayer', label: 'Bayer ordered' },
  { value: 'blue-noise', label: 'Blue noise' },
  { value: 'void-and-cluster', label: 'Void & cluster' },
  { value: 'pattern', label: 'Pattern' }
];

const labelClass = 'text-[#D9D9D9] w-16';
const labelStyle: React.CSSProperties = { fontSize: '14px' };

export const DitherControls: React.FC<Props> = ({
  settings,
  onChange,
  canToggle = true,
  forceOn = false,
  hideToggle = false,
  compact = false,
  isDitherPreset = false,
  beforeResolution,
  afterPresRes,
  afterResolution,
  hideLostEdge = false,
  hideResolution = false,
  showPxlEdgeToggle = false
}) => {
  const ditherEnabled = forceOn ? true : Boolean(settings.ditherEnabled);
  const labelWidth = compact ? 'w-12' : labelClass;
  const showLostEdge = !hideLostEdge || settings.brushShape === BrushShape.PIXEL_DITHER;
  const isPressureLinked = Boolean(settings.pressureLinkedFillResolution);

  return (
    <div className="mb-2">
      {!(forceOn && hideToggle) && (
        <div className="flex items-center gap-2">
          <label className={labelWidth} style={labelStyle}>
            Dither
          </label>
          {forceOn ? (
            hideToggle ? null : <span className="text-xs text-[#D9D9D9]">Always on</span>
          ) : canToggle ? (
            <CustomSwitch
              checked={ditherEnabled}
              onChange={(checked) => onChange({ ditherEnabled: checked })}
            />
          ) : (
            <span className="text-xs text-[#D9D9D9]">On</span>
          )}
        </div>
      )}

      {ditherEnabled && (
        <>
          <div className="flex items-center gap-2 mt-2">
            <div className={labelWidth} /> {/* spacer to align with labels */}
            <Dropdown
              value={settings.ditherAlgorithm || 'sierra-lite'}
              options={DITHER_OPTIONS}
              onChange={(value) => onChange({ ditherAlgorithm: value as DitherAlgorithm })}
              className="flex-1"
            />
          </div>

          {settings.ditherAlgorithm === 'pattern' && (
            <div className="flex items-center gap-2 mt-2">
              <div className={labelWidth} />
              <Dropdown
                value={settings.patternStyle || 'dots'}
                options={PATTERN_STYLES}
                onChange={(value) =>
                  onChange({ patternStyle: value as NonNullable<BrushSettings['patternStyle']> })
                }
                className="flex-1"
              />
            </div>
          )}

          {beforeResolution ? <div className="mt-2">{beforeResolution}</div> : null}

          {!hideResolution && (
            <div className="flex items-center gap-2 mt-2">
              <label className={labelWidth} style={labelStyle}>
                Res
              </label>
              <ProgressSlider
                value={settings.fillResolution || 1}
                min={1}
                max={64}
                step={1}
                onChange={(value) => onChange({ fillResolution: Math.max(1, Math.round(value)) })}
                disabled={Boolean(isPressureLinked && isDitherPreset)}
                aria-label="Dither Resolution"
                className="flex-1"
              />
            </div>
          )}

          {afterResolution ? <div className="mt-2">{afterResolution}</div> : null}

          <div className="flex items-center gap-2 mt-1">
            <label className={labelWidth} style={labelStyle}>
              PresRes
            </label>
            <CustomSwitch
              checked={Boolean(settings.pressureLinkedFillResolution)}
              onChange={(checked) => onChange({ pressureLinkedFillResolution: checked })}
              aria-label="Pressure-linked Resolution"
            />
            {isPressureLinked && (
              <>
                <label className="text-[#D9D9D9] text-xs ml-2" style={labelStyle}>
                Max
                </label>
                <Input
                  type="number"
                  variant="compact"
                  value={settings.fillResolution || 1}
                  min={1}
                  max={999}
                  step={1}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) {
                      return;
                    }
                    onChange({ fillResolution: Math.max(1, Math.min(999, Math.round(next))) });
                  }}
                  aria-label="Pressure-linked Max Pixel Size"
                  className="w-16"
                />
              </>
            )}
          </div>

          {afterPresRes ? <div className="mt-2">{afterPresRes}</div> : null}

          {showLostEdge && (
            <div className="flex items-center gap-2 mt-2">
              <label
                className={labelWidth}
                style={labelStyle}
                title="Lostedge: break up edges with Sierra Lite dithering (higher = wider fade)"
              >
                Lostedge
              </label>
              <ProgressSlider
                value={settings.lostEdge ?? 0}
                min={0}
                max={100}
                step={1}
                onChange={(value) =>
                  onChange({
                    lostEdge: Math.max(0, Math.min(100, Math.round(value)))
                  })
                }
                aria-label="Lost Edge"
                className="flex-1"
              />
            </div>
          )}

          {showPxlEdgeToggle && (
            <div className="flex items-center gap-2 mt-1">
              <label
                className={labelWidth}
                style={labelStyle}
                title="Keep whole pixels at shape edges (no chopped partial edge pixels)"
              >
                Pxl Edge
              </label>
              <CustomSwitch
                checked={Boolean(settings.pxlEdge)}
                onChange={(checked) => onChange({ pxlEdge: checked })}
                aria-label="Pixel Edge"
              />
            </div>
          )}

          <div className="flex items-center gap-2 mt-1">
            <label className={labelWidth} style={labelStyle} title="Re-dither whole stroke with latest pressure (legacy behavior)">
              Smoosh
            </label>
            <CustomSwitch
              checked={Boolean(settings.pressureDitherSmoosh)}
              onChange={(checked) => onChange({ pressureDitherSmoosh: checked })}
              aria-label="Pressure dither Smoosh"
              disabled={!settings.pressureLinkedFillResolution}
            />
          </div>

          <div className="flex items-center gap-2 mt-2">
            <label className={labelWidth} style={labelStyle} title="Dephase tiles between stamps">
              Dephase
            </label>
            <ProgressSlider
              value={settings.ditherPhaseJitter ?? 0}
              min={0}
              max={100}
              step={1}
              onChange={(value) =>
                onChange({
                  ditherPhaseJitter: Math.max(0, Math.min(100, Math.round(value)))
                })
              }
              aria-label="Dither Dephase"
              className="flex-1"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default DitherControls;
