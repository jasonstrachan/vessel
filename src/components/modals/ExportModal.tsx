"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../stores/useAppStore';
import { XIcon } from '../icons/XIcon';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { useKeyboardScope } from '../../hooks/useKeyboardScope';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { mapToIndexedWithDithering, type DitherMethod } from '@/utils/gifDither';

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
  // Draggable position (px)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [exportKind, setExportKind] = useState<ExportKind>('png');
  const [scale, setScale] = useState<1 | 2 | 3 | 4>(1);

  // PNG options
  const [pngIncludeBg, setPngIncludeBg] = useState(true);
  const [pngQuality, setPngQuality] = useState(1);

  // GIF options
  const [gifFps, setGifFps] = useState(12);
  const [gifDuration, setGifDuration] = useState(3);
  const [gifRepeat, setGifRepeat] = useState(0); // 0 = forever
  const [gifAutoFrames, setGifAutoFrames] = useState(true);
  const [gifDitherMethod, setGifDitherMethod] = useState<DitherMethod>('none');
  const [gifDitherStrength, setGifDitherStrength] = useState(1);
  const [gifFrameStep, setGifFrameStep] = useState<1 | 2 | 3 | 4>(1); // Capture every Nth frame
  const [gifMaxColors, setGifMaxColors] = useState<16 | 32 | 64 | 128 | 256>(128);
  const [gifAutoColors, setGifAutoColors] = useState(true);

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
      // Initial position: center horizontally, shifted up
      const modalWidth = 540; // matches class w-[540px]
      const x = Math.max(16, Math.round((window.innerWidth - modalWidth) / 2));
      const y = Math.max(24, Math.round(window.innerHeight * 0.12));
      setPos({ x, y });
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

  // Drag handlers (title bar)
  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const nx = Math.min(window.innerWidth - 60, Math.max(8, e.clientX - dragOffset.current.x));
      const ny = Math.min(window.innerHeight - 60, Math.max(8, e.clientY - dragOffset.current.y));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, pos.x, pos.y]);

  // Initialize GIF options when modal opens
  useEffect(() => {
    if (!isOpen) return;
    try {
      // Default auto-detect ON by default when opening
      setGifAutoFrames(true);
    } catch {}
  }, [isOpen]);

  // Compute suggested frames/duration for a perfect loop based on animation speeds
  // Strategy:
  // 1) Try to find the SHORTEST perfect loop (minimal frames) within a sane bound (<= 20s)
  // 2) If none found, pick the closest to user target with best residuals
  const autoFrameSuggestion = useMemo(() => {
    try {
      const fps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
      const targetFrames = Math.max(1, Math.round(gifDuration * fps));
      const store = useAppStore.getState();
      const recolorSpeeds: number[] = store.layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode === 'recolor' && l.colorCycleData?.recolorSettings)
        .map(l => l.colorCycleData!.recolorSettings!.animation.speed || 0.1)
        .filter(s => Number.isFinite(s) && s > 0);
      // Gather per-layer speeds for brush-mode CC layers (fallback to current UI speed if undefined)
      const brushSpeeds: number[] = store.layers
        .filter(l => l.layerType === 'color-cycle' && (l.colorCycleData?.mode !== 'recolor'))
        .map(l => (l.colorCycleData?.brushSpeed ?? store.tools?.brushSettings?.colorCycleSpeed ?? 0.1))
        .filter(s => Number.isFinite(s) && s > 0);
      const speeds = [...recolorSpeeds, ...brushSpeeds];

      // No animated speeds detected – fall back to user's target
      if (speeds.length === 0) {
        return { frames: targetFrames, success: false, duration: targetFrames / fps };
      }

      const minFrames = 8;
      const maxFrames = Math.max(minFrames, Math.round(fps * 20)); // cap search at 20s
      const EPS = 1e-3;

      // Phase 1: shortest perfect loop search
      for (let f = minFrames; f <= maxFrames; f++) {
        let ok = true;
        for (const s of speeds) {
          const cycles = (s * f) / fps; // cycles completed by this speed in f frames
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual >= EPS) { ok = false; break; }
        }
        if (ok) {
          return { frames: f, success: true, duration: f / fps };
        }
      }

      // Phase 2: best fit near user's target (closest + smallest residual)
      const searchRadius = Math.max(50, Math.round(targetFrames * 0.5));
      const start = Math.max(minFrames, targetFrames - searchRadius);
      const end = Math.min(maxFrames, targetFrames + searchRadius);
      let best = targetFrames;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let f = start; f <= end; f++) {
        let maxResidual = 0;
        for (const s of speeds) {
          const cycles = (s * f) / fps;
          const residual = Math.abs(cycles - Math.round(cycles));
          if (residual > maxResidual) maxResidual = residual;
          if (maxResidual > bestScore) break;
        }
        // Combine residual quality with distance from target (very small weight on distance)
        const dist = Math.abs(f - targetFrames) / Math.max(1, targetFrames);
        const score = maxResidual + dist * 1e-3;
        if (score < bestScore) {
          bestScore = score;
          best = f;
        }
      }
      return { frames: best, success: false, duration: best / fps };
    } catch {
      const fps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
      const fallbackFrames = Math.max(1, Math.round(gifDuration * fps));
      return { frames: fallbackFrames, success: false, duration: fallbackFrames / fps };
    }
  }, [gifDuration, gifFps, gifFrameStep, layers]);

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
    const effectiveFps = Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)));
    let totalFrames = Math.max(1, Math.round(gifDuration * effectiveFps));
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
    try {
      const st0 = useAppStore.getState();
      const hasAnyCC = st0.layers.some(l => l.layerType === 'color-cycle');
      const useAutoFrames = gifAutoFrames && hasAnyCC;
      if (useAutoFrames) {
        totalFrames = autoFrameSuggestion.frames;
      }
    } catch {}

    // Prepare recolor animation (if any recolor-mode layers)
    const recolorManager = RecolorManager.getInstance();
    try { recolorManager.setFPS(effectiveFps); } catch {}

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
          // Sync brush FPS to GIF FPS for tighter loops
          try {
            if (brush && (brush as any).setFPS) {
              (brush as any).setFPS(effectiveFps);
            }
          } catch {}
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
        let colors = Math.max(32, Math.min(256, gifMaxColors));
        if (gifAutoColors) {
          try {
            // Estimate needed colors by counting unique indices when quantized at 256
            const testPalette = quantize(frame.data, 256, { format: 'rgba4444', oneBitAlpha: 128, clearAlpha: true });
            const tmpIndex = applyPalette(frame.data, testPalette);
            const used = new Uint8Array(256);
            for (let k = 0; k < tmpIndex.length; k++) used[tmpIndex[k]] = 1;
            let unique = 0; for (let k = 0; k < 256; k++) unique += used[k];
            const estimated = Math.ceil(unique * 1.1); // margin
            if (estimated <= 32) colors = 32;
            else if (estimated <= 64) colors = 64;
            else if (estimated <= 128) colors = 128;
            else colors = 256;
          } catch {}
        }
        fixedPalette = quantize(frame.data, colors, { format: 'rgba4444', oneBitAlpha: 128, clearAlpha: true });
      }
      let index: Uint8Array;
      if (gifDitherMethod === 'none') {
        index = applyPalette(frame.data, fixedPalette);
      } else {
        // Custom dithering path
        index = mapToIndexedWithDithering(
          frame.data,
          scaledW,
          scaledH,
          fixedPalette,
          { method: gifDitherMethod, strength: gifDitherStrength, alphaThreshold: 16 }
        );
      }
      gif.writeFrame(index, scaledW, scaledH, { palette: fixedPalette, delay: Math.round(1000 / effectiveFps), repeat: gifRepeat });

      setProgress(Math.round(((i + 1) / totalFrames) * 100));
      // Step time – allow animations to advance roughly per frame
      await new Promise((r) => setTimeout(r, Math.max(0, Math.floor(1000 / effectiveFps))));
    }

    // Restore animation states
    try {
      const store = useAppStore.getState();
      for (const st of originalStates) {
        const layer = store.layers.find((l) => l.id === st.layerId);
        if (!layer) continue;
        if (!st.wasAnimating) store.updateLayer(layer.id, { colorCycleData: { ...layer.colorCycleData!, isAnimating: false } } as any);
        const brush = store.getLayerColorCycleBrush(layer.id);
        // Restore brush FPS to configured setting
        try {
          const fps0 = store.tools?.brushSettings?.colorCycleFPS || 30;
          if (brush && (brush as any).setFPS) {
            (brush as any).setFPS(fps0);
          }
        } catch {}
        if (brush && brush.setPlaying) brush.setPlaying(st.wasPlaying);
      }
    } catch {}

    gif.finish();
    const bytes = gif.bytes();
    // Ensure BlobPart is ArrayBuffer-backed to satisfy TS DOM lib types
    const bytesCopy = new Uint8Array(bytes.length);
    bytesCopy.set(bytes);
    const blob = new Blob([bytesCopy], { type: 'image/gif' });
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
          // Sync brush FPS to video FPS during export
          try {
            if (brush && (brush as any).setFPS) {
              (brush as any).setFPS(videoFps);
            }
          } catch {}
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
        // Restore brush FPS to configured setting
        try {
          const fps0 = store.tools?.brushSettings?.colorCycleFPS || 30;
          if (brush && (brush as any).setFPS) {
            (brush as any).setFPS(fps0);
          }
        } catch {}
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
      className={`fixed inset-0 z-50 ${isVisible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-300`}
      onClick={() => { if (!isExporting) onClose(); }}
    >
      <div
        className="bg-[#31313A] rounded-lg w-[540px] max-w-full mx-4 shadow-xl"
        style={{ position: 'fixed', left: pos.x, top: pos.y }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-[#555] cursor-move"
          onMouseDown={onDragStart}
        >
          <h2 className="text-[#D9D9D9] text-base font-semibold">Export</h2>
          <button
            onClick={() => { if (!isExporting) onClose(); }}
            className="text-[#888] hover:text-white transition-colors p-1"
            disabled={isExporting}
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 p-6 pt-4">
          {/* Type & Scale */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-base text-[#D9D9D9]">Type</label>
              <div className="flex gap-1">
                {(['png','gif','mp4'] as ExportKind[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setExportKind(k)}
                    className={`px-2 py-1 text-xs rounded border ${exportKind===k? 'bg-[#D9D9D9] text-[#31313A] border-[#D9D9D9]' : 'bg-transparent text-[#D9D9D9] border-[#888]'}`}
                    disabled={isExporting}
                  >
                    {k === 'png' ? 'PNG' : k === 'gif' ? 'GIF' : 'Video'}
                  </button>
                ))}
              </div>
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
                <label className="text-base text-[#888]">Auto-detect best frame count</label>
                <input
                  type="checkbox"
                  checked={gifAutoFrames}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setGifAutoFrames(v);
                  }}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Dithering</label>
                <select
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  value={gifDitherMethod}
                  onChange={(e) => setGifDitherMethod(e.target.value as DitherMethod)}
                >
                  <option value="none">None</option>
                  <option value="floyd-steinberg">Floyd–Steinberg</option>
                  <option value="ordered-4x4">Ordered (Bayer 4×4)</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Dither Strength</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={gifDitherStrength}
                  onChange={(e) => setGifDitherStrength(parseFloat(e.target.value))}
                  className="w-48"
                  disabled={gifDitherMethod === 'none'}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Palette Size</label>
                <select
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  value={gifAutoColors ? 'auto' : String(gifMaxColors)}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'auto') {
                      setGifAutoColors(true);
                    } else {
                      setGifAutoColors(false);
                      setGifMaxColors(parseInt(v, 10) as 16 | 32 | 64 | 128 | 256);
                    }
                  }}
                >
                  <option value="auto">Auto</option>
                  <option value={32}>32</option>
                  <option value={64}>64</option>
                  <option value={128}>128</option>
                  <option value={256}>256</option>
                </select>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-base text-[#888]">Frame Step</label>
                <select
                  className="bg-[#444] text-[#D9D9D9] px-3 py-1 rounded border border-[#555] text-base"
                  value={gifFrameStep}
                  onChange={(e) => setGifFrameStep(Math.max(1, Math.min(4, parseInt(e.target.value))) as 1|2|3|4)}
                >
                  <option value={1}>1 (every frame)</option>
                  <option value={2}>2 (every other)</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                </select>
              </div>
              {gifAutoFrames && (
                <div className="text-xs text-[#aaa] flex flex-col gap-1">
                  <div>Frames: {autoFrameSuggestion.frames} {autoFrameSuggestion.success ? '(perfect)' : '(closest)'} · FPS: {Math.max(1, Math.floor(gifFps / Math.max(1, gifFrameStep)))}</div>
                  <div>Resulting duration: {autoFrameSuggestion.duration.toFixed(2)}s</div>
                </div>
              )}
              <div className="text-xs text-[#aaa]">Tip: Lower FPS or increase Frame Step to reduce frames. Fewer palette colors and disabling dithering can significantly shrink file size. For long/high-res animations, prefer Video.</div>
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
