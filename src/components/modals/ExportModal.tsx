"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';

type ExportKind = 'png' | 'gif' | 'mp4';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  // Suspend global/canvas shortcuts while modal is open
  useKeyboardScope('modal', isOpen);

  const project = useAppStore((s) => s.project);
  const compositeLayersToCanvas = useAppStore((s) => s.compositeLayersToCanvas);
  const layers = useAppStore((s) => s.layers);

  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  const [exportKind, setExportKind] = useState<ExportKind>('png');
  const [scale, setScale] = useState<1 | 2 | 3 | 4>(1);

  // PNG options
  const [pngIncludeBg, setPngIncludeBg] = useState(true);
  const [pngQuality, setPngQuality] = useState(1);

  // GIF options
  const [gifFps, setGifFps] = useState(12);
  const [gifDuration, setGifDuration] = useState(3);
  const [gifRepeat, setGifRepeat] = useState(0); // 0 = forever
  const [gifLoopPerfect, setGifLoopPerfect] = useState(false);
  const [gifAutoFrames, setGifAutoFrames] = useState(false);
  const [gifLoopCycles, setGifLoopCycles] = useState(1); // cycles per GIF when overriding speed

  // Video options
  const [videoFps, setVideoFps] = useState(30);
  const [videoDuration, setVideoDuration] = useState(3);
  const [videoMime, setVideoMime] = useState<'video/mp4' | 'video/webm'>('video/webm');
  const [videoBitrate, setVideoBitrate] = useState(6000); // kbps

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setTimeout(() => setIsVisible(true), 10);
    } else {
      setIsVisible(false);
      setTimeout(() => setShouldRender(false), 300);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen && !isExporting) {
        onClose();
      }
    };
    if (isOpen) document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isExporting, onClose]);

  // Default GIF loop mode: on if color-cycling layers exist when opening
  useEffect(() => {
    if (!isOpen) return;
    try {
      const hasAnyCC = layers.some(l => l.layerType === 'color-cycle');
      setGifLoopPerfect(hasAnyCC);
      setGifAutoFrames(false);
      setGifLoopCycles(1);
    } catch {}
  }, [isOpen, layers]);

  // Compute suggested auto-detected frames for perfect loop (without changing speeds)
  const autoFrameSuggestion = useMemo(() => {
    try {
      const targetFrames = Math.max(1, Math.round(gifDuration * gifFps));
      const store = useAppStore.getState();
      const recolorSpeeds: number[] = store.layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings)
        .map(l => l.colorCycleData!.recolorSettings!.animation.speed || 0.1)
        .filter(s => Number.isFinite(s) && s > 0);
      const hasBrushCC = store.layers.some(l => l.layerType === 'color-cycle' && (!l.colorCycleData || l.colorCycleData.mode !== 'recolor'));
      const brushSpeed = hasBrushCC ? (store.tools?.brushSettings?.colorCycleSpeed || 0.1) : null;
      const speeds = [...recolorSpeeds, ...(brushSpeed ? [brushSpeed] : [])];
      if (speeds.length === 0) {
        return { frames: targetFrames, success: false, duration: targetFrames / gifFps };
      }
      const minFrames = 8;
      const searchRadius = Math.max(50, Math.round(targetFrames * 0.5));
      const start = Math.max(minFrames, targetFrames - searchRadius);
      const end = targetFrames + searchRadius;
      const epsilon = 1e-3;
      let best = targetFrames;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let f = start; f <= end; f++) {
        let maxResidual = 0;
        for (const s of speeds) {
          const cycles = (s * f) / gifFps;
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual > maxResidual) maxResidual = residual;
          if (maxResidual > bestScore) break;
        }
        if (maxResidual < epsilon) {
          return { frames: f, success: true, duration: f / gifFps };
        }
        if (maxResidual < bestScore) {
          bestScore = maxResidual;
          best = f;
        }
      }
      return { frames: best, success: false, duration: best / gifFps };
    } catch {
      const fallbackFrames = Math.max(1, Math.round(gifDuration * gifFps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / gifFps };
    }
  }, [gifDuration, gifFps, layers]);

  const filenameBase = useMemo(() => {
    const name = project?.name || 'TinyBrush';
    return name.replace(/\s+/g, '_');
  }, [project?.name]);

  const composeBaseCanvas = (): HTMLCanvasElement => {
    const base = document.createElement('canvas');
    const w = project?.width || 1;
    const h = project?.height || 1;
    base.width = w;
    base.height = h;
    if (compositeLayersToCanvas) {
      compositeLayersToCanvas(base);
    }
    return base;
  };

  const drawScaled = (src: HTMLCanvasElement, scaleFactor: number): HTMLCanvasElement => {
    if (scaleFactor === 1) return src;
    const dst = document.createElement('canvas');
    dst.width = Math.max(1, Math.floor(src.width * scaleFactor));
    dst.height = Math.max(1, Math.floor(src.height * scaleFactor));
    const dctx = dst.getContext('2d', { colorSpace: 'srgb' });
    if (!dctx) return src;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(src, 0, 0, dst.width, dst.height);
    return dst;
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  async function exportPNG() {
    const base = composeBaseCanvas();
    const scaled = drawScaled(base, scale);
    const includeBg = pngIncludeBg;

    // If background should be transparent off, paint background color on a copy
    let finalCanvas = scaled;
    if (includeBg && project?.backgroundColor && project.backgroundColor !== 'transparent') {
      const withBg = document.createElement('canvas');
      withBg.width = scaled.width;
      withBg.height = scaled.height;
      const bgctx = withBg.getContext('2d', { colorSpace: 'srgb' });
      if (bgctx) {
        bgctx.fillStyle = project.backgroundColor;
        bgctx.fillRect(0, 0, withBg.width, withBg.height);
        bgctx.drawImage(scaled, 0, 0);
        finalCanvas = withBg;
      }
    }
    const quality = Math.max(0.1, Math.min(1, pngQuality));
    return new Promise<void>((resolve, reject) => {
      finalCanvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error('Failed to create PNG'));
          downloadBlob(blob, `${filenameBase}@${scale}x.png`);
          resolve();
        },
        'image/png',
        quality
      );
    });
  }

  async function exportGIF() {
    let totalFrames = Math.max(1, Math.round(gifDuration * gifFps));
    cancelRef.current.cancelled = false;
    setProgress(0);

    // Dynamically import gifenc to keep bundle light
    const { GIFEncoder, quantize, applyPalette } = await import('gifenc');

    // We'll render to base size then scale for encoding
    const base = document.createElement('canvas');
    base.width = project?.width || 1;
    base.height = project?.height || 1;
    const scaledW = Math.max(1, Math.floor(base.width * scale));
    const scaledH = Math.max(1, Math.floor(base.height * scale));
    const scaled = document.createElement('canvas');
    scaled.width = scaledW;
    scaled.height = scaledH;
    const sctx = scaled.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!sctx) throw new Error('No canvas context for GIF export');

    const gif = GIFEncoder();

    // If requested and color-cycling exists, adjust frames for a perfect loop
    let enforcePerfectLoop = false;
    try {
      const st0 = useAppStore.getState();
      const hasAnyCC = st0.layers.some(l => l.layerType === 'color-cycle');
      const useAutoFrames = gifAutoFrames && hasAnyCC;
      enforcePerfectLoop = gifLoopPerfect && hasAnyCC && !useAutoFrames;
      if (useAutoFrames) {
        totalFrames = autoFrameSuggestion.frames;
      } else if (enforcePerfectLoop) {
        const minFrames = 8;
        if (totalFrames < minFrames) totalFrames = minFrames;
      }
    } catch {}

    // Prepare recolor animation (if any recolor-mode layers)
    const recolorManager = RecolorManager.getInstance();
    try { recolorManager.setFPS(gifFps); } catch {}
    const recolorStates: Array<{ layerId: string; wasPlaying: boolean; prevSpeed: number }> = [];
    const brushRestores: Array<{ layerId: string; prevSpeed?: number; prevFPS?: number }> = [];
    if (enforcePerfectLoop) {
      try {
        const store = useAppStore.getState();
        for (const layer of store.layers) {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor' && layer.colorCycleData.recolorSettings) {
            const wasPlaying = !!layer.colorCycleData.recolorSettings.animation.isPlaying;
            const prevSpeed = layer.colorCycleData.recolorSettings.animation.speed;
            recolorStates.push({ layerId: layer.id, wasPlaying, prevSpeed });
            // Set speed so cycles per GIF completes exactly
            const cycles = Math.max(1, Math.floor(gifLoopCycles));
            try { recolorManager.setLayerSpeed(layer.id, (cycles * gifFps) / totalFrames); } catch {}
            // Force playing so updateAnimation has effect
            layer.colorCycleData.recolorSettings.animation.isPlaying = true;
          }
          // Brush-based color-cycle layers (non-recolor)
          if (layer.layerType === 'color-cycle' && (!layer.colorCycleData || layer.colorCycleData.mode !== 'recolor')) {
            const brush = store.getLayerColorCycleBrush(layer.id);
            if (brush) {
              const prevFPS = store.tools?.brushSettings?.colorCycleFPS;
              const prevSpeed = store.tools?.brushSettings?.colorCycleSpeed;
              try { brush.setFPS(gifFps); } catch {}
              // Speed so that updateFrame (1/30 step) advances cycles/totalFrames per frame
              const cycles = Math.max(1, Math.floor(gifLoopCycles));
              try { brush.setSpeed((cycles * 30) / totalFrames); } catch {}
              brushRestores.push({ layerId: layer.id, prevSpeed, prevFPS });
            }
          }
        }
      } catch {}
    }

    // Attempt to ensure color-cycle layers are animating during export
    const originalStates: Array<{ layerId: string; wasPlaying: boolean; wasAnimating: boolean }> = [];
    try {
      const store = useAppStore.getState();
      for (const layer of store.layers) {
        if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
          const brush = store.getLayerColorCycleBrush(layer.id);
          const wasPlaying = !!(brush && brush.isPlaying && brush.isPlaying());
          const wasAnimating = !!layer.colorCycleData.isAnimating;
          originalStates.push({ layerId: layer.id, wasPlaying, wasAnimating });
          // Turn on
          if (!wasAnimating) store.updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData, isAnimating: true } } as any);
          if (brush && brush.setPlaying) brush.setPlaying(true);
        }
      }
    } catch {}

    // Lock palette to first frame for stable colors and smooth loop
    let fixedPalette: any = null;

    for (let i = 0; i < totalFrames; i++) {
      if (cancelRef.current.cancelled) break;
      // Advance recolor-mode layers one step
      try {
        const store = useAppStore.getState();
        for (const layer of store.layers) {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
            recolorManager.updateAnimation(layer);
          }
        }
      } catch {}

      // Composite current frame
      compositeLayersToCanvas(base);
      // Scale draw
      sctx.imageSmoothingEnabled = true;
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(base, 0, 0, scaledW, scaledH);

      const frame = sctx.getImageData(0, 0, scaledW, scaledH);
      if (!fixedPalette) {
        fixedPalette = quantize(frame.data, 256, { format: 'rgba4444', oneBitAlpha: 128, clearAlpha: true });
      }
      const index = applyPalette(frame.data, fixedPalette);
      gif.writeFrame(index, scaledW, scaledH, { palette: fixedPalette, delay: Math.round(1000 / gifFps), repeat: gifRepeat });

      setProgress(Math.round(((i + 1) / totalFrames) * 100));
      // Step time – allow animations to advance roughly per frame
      await new Promise((r) => setTimeout(r, Math.max(0, Math.floor(1000 / gifFps))));
    }

    // Restore animation states and speeds
    try {
      const store = useAppStore.getState();
      for (const st of originalStates) {
        const layer = store.layers.find((l) => l.id === st.layerId);
        if (!layer) continue;
        if (!st.wasAnimating) store.updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData!, isAnimating: false } } as any);
        const brush = store.getLayerColorCycleBrush(layer.id);
        if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
      }
      if (enforcePerfectLoop) {
        // Restore recolor play flags and speeds
        for (const st of recolorStates) {
          const layer = store.layers.find((l) => l.id === st.layerId);
          if (layer?.colorCycleData?.recolorSettings) {
            layer.colorCycleData.recolorSettings.animation.isPlaying = st.wasPlaying;
            layer.colorCycleData.recolorSettings.animation.speed = st.prevSpeed;
          }
        }
        // Restore brush speeds/fps (best effort via current tool settings)
        for (const r of brushRestores) {
          const brush = store.getLayerColorCycleBrush(r.layerId);
          if (brush) {
            try { if (r.prevFPS !== undefined) brush.setFPS(r.prevFPS); } catch {}
            try { if (r.prevSpeed !== undefined) brush.setSpeed(r.prevSpeed); } catch {}
          }
        }
      }
    } catch {}

    gif.finish();
    const bytes = gif.bytes();
    const blob = new Blob([bytes], { type: 'image/gif' });
    downloadBlob(blob, `${filenameBase}@${scale}x.gif`);
  }

  async function exportVideo() {
    // Prepare canvases
    const base = document.createElement('canvas');
    base.width = project?.width || 1;
    base.height = project?.height || 1;
    const scaled = document.createElement('canvas');
    scaled.width = Math.max(1, Math.floor(base.width * scale));
    scaled.height = Math.max(1, Math.floor(base.height * scale));
    const sctx = scaled.getContext('2d', { colorSpace: 'srgb' });
    if (!sctx) throw new Error('No canvas context for video export');

    // Choose a supported mime type
    const preferredTypes = [
      videoMime + ';codecs=avc1.42E01E', // mp4 (may fail in many browsers)
      videoMime,
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    let mime: string | undefined;
    for (const t of preferredTypes) {
      if ((window as any).MediaRecorder && (window as any).MediaRecorder.isTypeSupported && (window as any).MediaRecorder.isTypeSupported(t)) {
        mime = t;
        break;
      }
    }
    if (!mime) mime = 'video/webm;codecs=vp8';

    const stream = (scaled as any).captureStream ? (scaled as any).captureStream(videoFps) : null;
    if (!stream) throw new Error('Canvas captureStream not supported');

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.max(1000, videoBitrate * 1000),
    } as any);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    const totalFrames = Math.max(1, Math.round(videoDuration * videoFps));
    cancelRef.current.cancelled = false;
    setProgress(0);

    // Try to ensure animations are running
    const originalStates: Array<{ layerId: string; wasPlaying: boolean; wasAnimating: boolean }> = [];
    try {
      const store = useAppStore.getState();
      for (const layer of store.layers) {
        if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
          const brush = store.getLayerColorCycleBrush(layer.id);
          const wasPlaying = !!(brush && brush.isPlaying && brush.isPlaying());
          const wasAnimating = !!layer.colorCycleData.isAnimating;
          originalStates.push({ layerId: layer.id, wasPlaying, wasAnimating });
          if (!wasAnimating) store.updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData, isAnimating: true } } as any);
          if (brush && brush.setPlaying) brush.setPlaying(true);
        }
      }
    } catch {}

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.start();
      let frame = 0;
      const interval = Math.max(0, Math.floor(1000 / videoFps));
      const tick = async () => {
        if (cancelRef.current.cancelled || frame >= totalFrames) {
          recorder.stop();
          return;
        }
        // Advance recolor-mode layers one step
        try {
          const rm = RecolorManager.getInstance();
          const store = useAppStore.getState();
          for (const layer of store.layers) {
            if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
              rm.updateAnimation(layer);
            }
          }
        } catch {}

        // Render current frame
        compositeLayersToCanvas(base);
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(base, 0, 0, scaled.width, scaled.height);
        frame++;
        setProgress(Math.round((frame / totalFrames) * 100));
        setTimeout(tick, interval);
      };
      setTimeout(tick, 0);
    });

    // Restore animation states
    try {
      const store = useAppStore.getState();
      for (const st of originalStates) {
        const layer = store.layers.find((l) => l.id === st.layerId);
        if (!layer) continue;
        if (!st.wasAnimating) store.updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData!, isAnimating: false } } as any);
        const brush = store.getLayerColorCycleBrush(layer.id);
        if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
      }
    } catch {}

    const blob = new Blob(chunks, { type: recorder.mimeType });
    const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
    downloadBlob(blob, `${filenameBase}@${scale}x.${ext}`);
  }

  const handleExport = async () => {
    if (!project) return;
    setIsExporting(true);
    cancelRef.current.cancelled = false;
    setProgress(0);
    try {
      if (exportKind === 'png') await exportPNG();
      else if (exportKind === 'gif') await exportGIF();
      else await exportVideo();
      onClose();
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsExporting(false);
      setProgress(0);
      cancelRef.current.cancelled = false;
    }
  };

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={() => { if (!isExporting) onClose(); }}
    >
      <div
        className={`bg-[#31313A] rounded-lg p-6 w-[540px] max-w-full mx-4 shadow-xl transition-all duration-300 ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[#D9D9D9] text-base font-semibold">Export</h2>
          <button
            onClick={() => { if (!isExporting) onClose(); }}
            className="text-[#888] hover:text-white transition-colors p-1"
            disabled={isExporting}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Type & Scale */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-base text-[#D9D9D9]">Type</label>
              <select
                className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                value={exportKind}
                onChange={(e) => setExportKind(e.target.value as ExportKind)}
                disabled={isExporting}
              >
                <option value="png">PNG (image)</option>
                <option value="gif">GIF (animation)</option>
                <option value="mp4">MP4/WebM (video)</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-base text-[#D9D9D9]">Scale</label>
              <div className="flex gap-1">
                {[1,2,3,4].map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s as 1|2|3|4)}
                    className={`px-2 py-1 text-xs rounded border ${scale===s? 'bg-[#D9D9D9] text-[#31313A] border-[#D9D9D9]' : 'bg-transparent text-[#D9D9D9] border-[#888]'}`}
                    disabled={isExporting}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* PNG Options */}
          {exportKind === 'png' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Include Background</label>
                <input type="checkbox" checked={pngIncludeBg} onChange={(e) => setPngIncludeBg(e.target.checked)} />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Quality</label>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={pngQuality}
                  onChange={(e) => setPngQuality(parseFloat(e.target.value))}
                  className="w-48"
                />
              </div>
            </div>
          )}

          {/* GIF Options */}
          {exportKind === 'gif' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">FPS</label>
                <Input type="number" min={1} max={60} value={gifFps} onChange={(e) => setGifFps(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Duration (s)</label>
                <Input type="number" min={1} max={20} value={gifDuration} onChange={(e) => setGifDuration(Math.max(1, Math.min(20, parseInt(e.target.value)||1)))} className="w-24 text-right" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Repeat</label>
                <select
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  value={gifRepeat}
                  onChange={(e) => setGifRepeat(parseInt(e.target.value))}
                >
                  <option value={0}>Forever</option>
                  <option value={-1}>Once</option>
                  <option value={1}>1 time</option>
                  <option value={2}>2 times</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Loop perfectly (speed override)</label>
                <input
                  type="checkbox"
                  checked={gifLoopPerfect}
                  onChange={(e) => setGifLoopPerfect(e.target.checked)}
                  disabled={gifAutoFrames}
                />
              </div>
              {gifLoopPerfect && (
                <div className="flex items-center justify-between">
                  <label className="text-base text-[#888]">Cycles per GIF</label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={gifLoopCycles}
                    onChange={(e) => setGifLoopCycles(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-24 text-right"
                  />
                </div>
              )}
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Auto-detect best frame count</label>
                <input
                  type="checkbox"
                  checked={gifAutoFrames}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setGifAutoFrames(v);
                    if (v) setGifLoopPerfect(false);
                  }}
                />
              </div>
              {gifAutoFrames && (
                <div className="text-xs text-[#aaa] flex flex-col gap-1">
                  <div>Frames: {autoFrameSuggestion.frames} {autoFrameSuggestion.success ? '(perfect)' : '(closest)'} · FPS: {gifFps}</div>
                  <div>Resulting duration: {autoFrameSuggestion.duration.toFixed(2)}s</div>
                </div>
              )}
              <div className="text-xs text-[#aaa]">Tip: GIF export is optimized for flat colors. For long/high-res animations prefer Video.</div>
            </div>
          )}

          {/* Video Options */}
          {exportKind === 'mp4' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">FPS</label>
                <Input type="number" min={1} max={60} value={videoFps} onChange={(e) => setVideoFps(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Duration (s)</label>
                <Input type="number" min={1} max={60} value={videoDuration} onChange={(e) => setVideoDuration(Math.max(1, Math.min(60, parseInt(e.target.value)||1)))} className="w-24 text-right" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Format</label>
                <select
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  value={videoMime}
                  onChange={(e) => setVideoMime(e.target.value as any)}
                >
                  <option value="video/webm">WebM</option>
                  <option value="video/mp4">MP4 (best-effort)</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Bitrate (kbps)</label>
                <Input type="number" min={1000} max={20000} value={videoBitrate} onChange={(e) => setVideoBitrate(Math.max(1000, Math.min(20000, parseInt(e.target.value)||6000)))} className="w-24 text-right" />
              </div>
              <div className="text-xs text-[#aaa]">Note: Many browsers only support WebM in MediaRecorder. MP4 will fallback to WebM if unsupported.</div>
            </div>
          )}

          {/* Progress */}
          {isExporting && (
            <div className="w-full bg-[#444] h-2 rounded overflow-hidden">
              <div className="bg-[#D9D9D9] h-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {isExporting ? (
              <Button variant="secondary" onClick={() => { cancelRef.current.cancelled = true; }}>
                Cancel
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose}>Close</Button>
                <Button variant="primary" onClick={handleExport}>Export</Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
