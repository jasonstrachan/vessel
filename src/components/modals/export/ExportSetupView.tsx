'use client';

import { useState } from 'react';

import Button from '@/components/ui/Button';
import ButtonGroup from '@/components/ui/ButtonGroup';
import CustomSwitch from '@/components/ui/CustomSwitch';
import Input from '@/components/ui/Input';
import type { WebGLExportSettings } from '@/types';
import type { DitherMethod } from '@/utils/gifDither';

import {
  compressionPercentToBitrate,
  GIF_FPS_PRESETS,
  GOBLET_VERSION_LABELS,
  WEBGL_DESIGN_SCALE_PRESETS,
  WEBGL_EXPORT_FORMATS,
  WEBGL_VIEWPORT_PRESETS,
  type ExportKind,
  type RasterExportScale,
  type WebglViewportPreset,
} from './exportModalModel';

interface PngExportOptions {
  includeBackground: boolean;
  quality: number;
}

interface GifExportOptions {
  fps: number;
  duration: number;
  repeat: number;
  autoFrames: boolean;
  ditherMethod: DitherMethod;
  ditherStrength: number;
  frameStep: 1 | 2 | 3 | 4;
  maxColors: 4 | 8 | 16 | 32 | 64 | 128 | 256;
  autoColors: boolean;
}

interface VideoExportOptions {
  fps: number;
  duration: number;
  autoFrames: boolean;
  mime: 'video/mp4' | 'video/webm';
  bitrate: number;
  compressionPercent: number;
}

interface GobletExportOptions {
  settings: WebGLExportSettings;
  viewportPreset: WebglViewportPreset;
  designScalePercent: number;
  fps: number;
  duration: number;
  autoFrames: boolean;
  visibleLayerCount: number;
  hiddenLayerCount: number;
  participatingLayerCount: number;
  projectBackgroundColor?: string;
}

interface ExportSetupViewProps {
  isExporting: boolean;
  exportKind: ExportKind;
  scale: RasterExportScale;
  scaleOptions: Array<{ value: RasterExportScale; label: string }>;
  filenameBase: string;
  png: PngExportOptions;
  gif: GifExportOptions;
  video: VideoExportOptions;
  goblet: GobletExportOptions;
  onExportKindChange: (kind: ExportKind) => void;
  onScaleChange: (scale: RasterExportScale) => void;
  onPngChange: (patch: Partial<PngExportOptions>) => void;
  onGifChange: (patch: Partial<GifExportOptions>) => void;
  onVideoChange: (patch: Partial<VideoExportOptions>) => void;
  onGobletAnimationChange: (patch: Partial<Pick<GobletExportOptions, 'fps' | 'duration' | 'autoFrames'>>) => void;
  onGobletSettingsChange: (patch: Partial<WebGLExportSettings>) => void;
  onClose: () => void;
  onExport: () => void;
}

const SECTION_CLASS = 'border-t border-[#424242] pt-4';
const FIELD_CLASS = 'bg-[#4a4a4a] border border-[#343434] text-sm text-[#E5E5E5] px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#D9D9D9] disabled:text-[#5C5C5C] disabled:bg-[#151515]';
const INPUT_CLASS = '!bg-[#4a4a4a] !border-[#343434] !text-[#E5E5E5] !px-3 !py-2 !h-9 focus:!border-[#D9D9D9] focus:!ring-0 focus:!outline-none disabled:!text-[#5C5C5C] disabled:!bg-[#151515]';

const Row = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-sm text-[#D4D4D4]">{label}</span>
    {children}
  </div>
);

export const ExportSetupView = ({
  isExporting,
  exportKind,
  scale,
  scaleOptions,
  filenameBase,
  png,
  gif,
  video,
  goblet,
  onExportKindChange,
  onScaleChange,
  onPngChange,
  onGifChange,
  onVideoChange,
  onGobletAnimationChange,
  onGobletSettingsChange,
  onClose,
  onExport,
}: ExportSetupViewProps) => {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const layerSummary = goblet.settings.includeHiddenLayers
    ? `${goblet.participatingLayerCount} layers included`
    : `${goblet.visibleLayerCount} visible · ${goblet.hiddenLayerCount} hidden excluded`;
  const formatLabel = WEBGL_EXPORT_FORMATS.find(
    (format) => format.value === goblet.settings.bundleFormat,
  )?.label ?? 'Goblet';
  const footerSummary = exportKind === 'webgl'
    ? `${layerSummary} · ${formatLabel}`
    : `${filenameBase} · ${scale}x`;

  return (
    <>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm text-[#E0E0E0]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#9C9C9C]">
              Format
            </div>
            <ButtonGroup
              options={[
                { value: 'webgl', label: 'Goblet' },
                { value: 'gif', label: 'GIF' },
                { value: 'mp4', label: 'Video' },
                { value: 'png', label: 'PNG' },
              ]}
              value={exportKind}
              onChange={(value) => onExportKindChange(value as ExportKind)}
              size="sm"
            />
          </div>
          {exportKind !== 'webgl' && (
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[#9C9C9C]">
                Scale
              </div>
              <ButtonGroup
                options={scaleOptions.map(({ value, label }) => ({ value: String(value), label }))}
                value={String(scale)}
                onChange={(value) => onScaleChange(Number(value) as RasterExportScale)}
                size="sm"
              />
            </div>
          )}
        </div>

        {exportKind === 'png' && (
          <div className={`${SECTION_CLASS} space-y-4`}>
            <Row label="Include background">
              <CustomSwitch
                checked={png.includeBackground}
                onChange={(checked) => onPngChange({ includeBackground: checked })}
                aria-label="Include background"
                disabled={isExporting}
              />
            </Row>
            <Row label={`Quality ${Math.round(png.quality * 100)}%`}>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={png.quality}
                onChange={(event) => onPngChange({ quality: parseFloat(event.target.value) })}
                className="slider w-56"
                aria-label="PNG quality"
              />
            </Row>
          </div>
        )}

        {exportKind === 'gif' && (
          <div className={`${SECTION_CLASS} space-y-4`}>
            <Row label="FPS">
              <div className="flex items-center gap-2">
                <ButtonGroup
                  options={GIF_FPS_PRESETS.map((value) => ({ value: String(value), label: String(value) }))}
                  value={String(gif.fps)}
                  onChange={(value) => onGifChange({ fps: Number(value) })}
                  size="xs"
                />
                <Input
                  type="number"
                  min={1}
                  max={60}
                  value={gif.fps}
                  onChange={(event) => onGifChange({
                    fps: Math.max(1, Math.min(60, parseInt(event.target.value, 10) || 1)),
                  })}
                  className="w-20 text-right"
                />
              </div>
            </Row>
            <Row label="Duration (s)">
              <Input
                type="number"
                min={1}
                max={20}
                value={gif.duration}
                onChange={(event) => onGifChange({
                  duration: Math.max(1, Math.min(20, parseInt(event.target.value, 10) || 1)),
                })}
                className="w-20 text-right"
                disabled={gif.autoFrames}
              />
            </Row>
            <Row label="Perfect loop">
              <CustomSwitch
                checked={gif.autoFrames}
                onChange={(checked) => onGifChange({ autoFrames: checked })}
                aria-label="Perfect loop"
                disabled={isExporting}
              />
            </Row>
            <Row label="Repeat">
              <select
                className={FIELD_CLASS}
                value={gif.repeat}
                onChange={(event) => onGifChange({ repeat: parseInt(event.target.value, 10) })}
              >
                <option value={0}>Forever</option>
                <option value={-1}>Once</option>
                <option value={1}>1 time</option>
                <option value={2}>2 times</option>
              </select>
            </Row>
            <Row label="Dithering">
              <select
                className={FIELD_CLASS}
                value={gif.ditherMethod}
                onChange={(event) => onGifChange({ ditherMethod: event.target.value as DitherMethod })}
              >
                <option value="none">None</option>
                <option value="floyd-steinberg">Floyd–Steinberg</option>
                <option value="ordered-4x4">Ordered (Bayer 4×4)</option>
              </select>
            </Row>
            {gif.ditherMethod !== 'none' && (
              <Row label={`Dither strength ${Math.round(gif.ditherStrength * 100)}%`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gif.ditherStrength}
                  onChange={(event) => onGifChange({ ditherStrength: parseFloat(event.target.value) })}
                  className="slider w-56"
                  aria-label="Dither strength"
                />
              </Row>
            )}
            <Row label="Palette size">
              <select
                className={FIELD_CLASS}
                value={gif.autoColors ? 'auto' : String(gif.maxColors)}
                onChange={(event) => {
                  if (event.target.value === 'auto') {
                    onGifChange({ autoColors: true });
                    return;
                  }
                  onGifChange({
                    autoColors: false,
                    maxColors: parseInt(event.target.value, 10) as GifExportOptions['maxColors'],
                  });
                }}
              >
                <option value="auto">Auto</option>
                {[4, 8, 16, 32, 64, 128, 256].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </Row>
            <Row label="Frame step">
              <select
                className={FIELD_CLASS}
                value={gif.frameStep}
                onChange={(event) => onGifChange({
                  frameStep: Math.max(1, Math.min(4, parseInt(event.target.value, 10))) as GifExportOptions['frameStep'],
                })}
              >
                <option value={1}>Every frame</option>
                <option value={2}>Every other frame</option>
                <option value={3}>Every third frame</option>
                <option value={4}>Every fourth frame</option>
              </select>
            </Row>
          </div>
        )}

        {exportKind === 'mp4' && (
          <div className={`${SECTION_CLASS} space-y-4`}>
            <Row label="FPS">
              <Input
                type="number"
                min={1}
                max={60}
                value={video.fps}
                onChange={(event) => onVideoChange({
                  fps: Math.max(1, Math.min(60, parseInt(event.target.value, 10) || 1)),
                })}
                className="w-20 text-right"
              />
            </Row>
            <Row label="Duration (s)">
              <Input
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={video.duration}
                onChange={(event) => onVideoChange({
                  duration: Math.max(1, Math.min(60, parseFloat(event.target.value) || 1)),
                })}
                className="w-20 text-right"
                disabled={video.autoFrames}
              />
            </Row>
            <Row label="Perfect loop (best guess)">
              <CustomSwitch
                checked={video.autoFrames}
                onChange={(checked) => onVideoChange({ autoFrames: checked })}
                aria-label="Perfect loop best guess"
                disabled={isExporting}
              />
            </Row>
            <Row label="Format">
              <select
                className={FIELD_CLASS}
                value={video.mime}
                onChange={(event) => onVideoChange({
                  mime: event.target.value as VideoExportOptions['mime'],
                })}
              >
                <option value="video/webm">WebM</option>
                <option value="video/mp4">MP4 (best-effort)</option>
              </select>
            </Row>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-[#D4D4D4]">Compression</span>
                <div className="text-right leading-tight">
                  <div className="text-sm text-[#E5E5E5]">{video.compressionPercent}%</div>
                  <div className="text-xs text-[#888]">{video.bitrate.toLocaleString()} kbps</div>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={video.compressionPercent}
                onChange={(event) => onVideoChange({
                  bitrate: compressionPercentToBitrate(parseInt(event.target.value, 10) || 0),
                })}
                className="slider w-full"
                disabled={isExporting}
                aria-label="Video compression"
              />
            </div>
          </div>
        )}

        {exportKind === 'webgl' && (
          <>
            <section className={`${SECTION_CLASS} space-y-3`}>
              <h3 className="text-base font-semibold text-[#E5E5E5]">File</h3>
              <ButtonGroup
                options={WEBGL_EXPORT_FORMATS}
                value={goblet.settings.bundleFormat}
                onChange={(value) => onGobletSettingsChange({
                  bundleFormat: value as WebGLExportSettings['bundleFormat'],
                })}
                size="sm"
              />
              <label className="flex flex-col gap-1">
                <span className="text-xs text-[#9C9C9C]">HTML title</span>
                <Input
                  type="text"
                  maxLength={120}
                  value={goblet.settings.htmlTitle}
                  onChange={(event) => onGobletSettingsChange({ htmlTitle: event.target.value })}
                  placeholder="Goblet"
                  className={INPUT_CLASS}
                  disabled={isExporting}
                />
              </label>
            </section>

            <section className={`${SECTION_CLASS} space-y-3`}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-[#E5E5E5]">Layers</h3>
                  <p className="mt-1 text-xs text-[#9C9C9C]">{layerSummary}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#D4D4D4]">Include hidden</span>
                  <CustomSwitch
                    checked={goblet.settings.includeHiddenLayers}
                    onChange={(checked) => onGobletSettingsChange({ includeHiddenLayers: checked })}
                    aria-label="Include hidden layers"
                    disabled={isExporting || goblet.hiddenLayerCount === 0}
                  />
                </div>
              </div>
            </section>

            <section className={`${SECTION_CLASS} space-y-3`}>
              <h3 className="text-base font-semibold text-[#E5E5E5]">Presentation</h3>
              <ButtonGroup
                options={WEBGL_VIEWPORT_PRESETS.map((preset) => ({ ...preset }))}
                value={goblet.viewportPreset}
                onChange={(value) => onGobletSettingsChange({
                  viewportPreset: value as WebGLExportSettings['viewportPreset'],
                })}
                size="sm"
              />
              <p className="text-xs text-[#9C9C9C]">
                {goblet.viewportPreset === 'embed-fill'
                  ? 'Fills the host container; composition-level cropping is allowed.'
                  : goblet.viewportPreset === 'embed-fit'
                    ? 'Keeps the full composition visible inside the host container.'
                    : goblet.viewportPreset === 'fixed'
                      ? 'Uses a fixed non-responsive design canvas.'
                      : 'Fits the full composition for standalone playback.'}
              </p>
              {goblet.viewportPreset === 'fixed' && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-[#D4D4D4]">Design scale</span>
                  <div className="flex items-center gap-2">
                    <ButtonGroup
                      options={WEBGL_DESIGN_SCALE_PRESETS.map((value) => ({
                        value: String(value),
                        label: `${value}%`,
                      }))}
                      value={String(goblet.designScalePercent)}
                      onChange={(value) => onGobletSettingsChange({
                        designScalePercent: Number(value),
                      })}
                      size="xs"
                    />
                    <Input
                      type="number"
                      min={25}
                      max={800}
                      value={goblet.designScalePercent}
                      onChange={(event) => onGobletSettingsChange({
                        designScalePercent: parseInt(event.target.value, 10),
                      })}
                      className={`${INPUT_CLASS} w-20 text-right`}
                    />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-[#9C9C9C]">FPS</span>
                  <Input
                    type="number"
                    min={1}
                    max={120}
                    value={goblet.fps}
                    onChange={(event) => onGobletAnimationChange({
                      fps: Math.max(1, Math.min(120, parseInt(event.target.value, 10) || 1)),
                    })}
                    className={`${INPUT_CLASS} w-full text-right`}
                    disabled={isExporting}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-[#9C9C9C]">Duration (s)</span>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={goblet.duration}
                    onChange={(event) => onGobletAnimationChange({
                      duration: Math.max(0.5, parseFloat(event.target.value) || 0.5),
                    })}
                    className={`${INPUT_CLASS} w-full text-right`}
                    disabled={isExporting || goblet.autoFrames}
                  />
                </label>
              </div>
              <Row label="Perfect loop">
                <CustomSwitch
                  checked={goblet.autoFrames}
                  onChange={(checked) => onGobletAnimationChange({ autoFrames: checked })}
                  aria-label="Perfect loop"
                  disabled={isExporting}
                />
              </Row>
            </section>

            <section className={SECTION_CLASS}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 py-1 text-left"
                aria-expanded={isAdvancedOpen}
                onClick={() => setIsAdvancedOpen((open) => !open)}
              >
                <span className="text-base font-semibold text-[#E5E5E5]">Advanced</span>
                <span className="text-[#9C9C9C]" aria-hidden="true">
                  {isAdvancedOpen ? '−' : '+'}
                </span>
              </button>
              {isAdvancedOpen && (
                <div className="mt-3 space-y-4">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-[#9C9C9C]">Goblet runtime</span>
                    <select
                      className={FIELD_CLASS}
                      value={goblet.settings.gobletVersion}
                      onChange={(event) => onGobletSettingsChange({
                        gobletVersion: event.target.value as WebGLExportSettings['gobletVersion'],
                      })}
                      disabled={isExporting}
                    >
                      <option value="goblet2">{GOBLET_VERSION_LABELS.goblet2}</option>
                      <option value="goblet1">{GOBLET_VERSION_LABELS.goblet1}</option>
                    </select>
                  </label>
                  <Row label="Minify output">
                    <CustomSwitch
                      checked={goblet.settings.minifyOutput}
                      onChange={(checked) => onGobletSettingsChange({ minifyOutput: checked })}
                      aria-label="Minify output"
                      disabled={isExporting}
                    />
                  </Row>
                  <Row label="Embed Canvas2D fallback">
                    <CustomSwitch
                      checked={goblet.settings.embedCanvasFallback}
                      onChange={(checked) => onGobletSettingsChange({ embedCanvasFallback: checked })}
                      aria-label="Embed Canvas2D fallback"
                      disabled={isExporting}
                    />
                  </Row>
                  <Row label="Diagnostics helpers">
                    <CustomSwitch
                      checked={goblet.settings.enableGobletDiagnostics}
                      onChange={(checked) => onGobletSettingsChange({
                        enableGobletDiagnostics: checked,
                      })}
                      aria-label="Diagnostics helpers"
                      disabled={isExporting}
                    />
                  </Row>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center justify-between gap-3 border border-[#343434] bg-[#1F1F1F] px-3 py-2">
                      <span className="text-[#9C9C9C]">Artwork</span>
                      <span
                        className="h-5 w-5 border border-[#555]"
                        style={{
                          background: goblet.projectBackgroundColor === 'transparent'
                            ? 'repeating-conic-gradient(#666 0% 25%, #333 0% 50%) 50% / 8px 8px'
                            : goblet.projectBackgroundColor || 'transparent',
                        }}
                        aria-hidden="true"
                      />
                    </div>
                    <label className="flex items-center justify-between gap-3 border border-[#343434] bg-[#1F1F1F] px-3 py-2">
                      <span className="text-[#9C9C9C]">Index shell</span>
                      <input
                        type="color"
                        value={goblet.settings.htmlBackgroundColor}
                        onChange={(event) => onGobletSettingsChange({
                          htmlBackgroundColor: event.target.value,
                        })}
                        className="h-6 w-8 cursor-pointer border border-[#555] bg-transparent p-0"
                        disabled={isExporting}
                        aria-label="Goblet HTML shell background color"
                      />
                    </label>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[#424242] bg-[#252525] px-6 py-3">
        <div className="min-w-0 truncate text-xs text-[#9C9C9C]" title={footerSummary}>
          {footerSummary}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onExport}>Export</Button>
        </div>
      </div>
    </>
  );
};
