'use client';

import React from 'react';
import { Menu } from 'lucide-react';

import GridOverlay from '@/components/canvas/GridOverlay';
import { ReferenceAssetCanvas } from '@/components/reference/ReferenceAssetCanvas';
import {
  ReferenceStudioControlsPanel,
  type ReferenceStudioTool,
} from '@/components/reference/ReferenceStudioControlsPanel';
import { fitReferenceAssetToProject } from '@/referenceStudio/referenceAssets';
import {
  createReferenceStudioChannel,
  getReferenceStudioSessionIdFromLocation,
  type ReferenceStudioCommand,
  type ReferenceStudioMainMessage,
  type ReferenceStudioSnapshot,
} from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset } from '@/types';

const MAX_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;
const INITIAL_VIEW_MARGIN_CANVASES = 1;
const MIN_VIEW_SCALE = 0.05;
const MAX_VIEW_SCALE = 40;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const iconButtonClass = 'flex h-8 w-8 items-center justify-center bg-[#1A1A1A] text-[#999] hover:bg-[#242424] hover:text-[#D9D9D9] focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#7DD3FC]';
const EMPTY_REFERENCE_ASSETS: ReferenceAsset[] = [];

interface PanDrag {
  pointerId: number;
  clientX: number;
  clientY: number;
  originX: number;
  originY: number;
}

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="slider"]',
  '[role="switch"]',
].join(',');

const isInteractiveTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest(INTERACTIVE_SELECTOR));
};

const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error ?? new Error('Unable to read image'));
  reader.readAsDataURL(file);
});

const readImageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('Unable to decode image'));
    image.src = dataUrl;
  });

export const ReferenceStudioWindow = () => {
  const [snapshot, setSnapshot] = React.useState<ReferenceStudioSnapshot | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [assetPreviews, setAssetPreviews] = React.useState<Record<string, Partial<ReferenceAsset>>>({});
  const [viewScale, setViewScale] = React.useState(0.5);
  const [viewOrigin, setViewOrigin] = React.useState({ x: 0, y: 0 });
  const [areControlsVisible, setAreControlsVisible] = React.useState(false);
  const [activeTool, setActiveTool] = React.useState<ReferenceStudioTool>('move');
  const [liquifySize, setLiquifySize] = React.useState(160);
  const [liquifyStrength, setLiquifyStrength] = React.useState(0.65);
  const [viewportSize, setViewportSize] = React.useState({ width: 0, height: 0 });
  const [isFitView, setIsFitView] = React.useState(true);
  const [panCursor, setPanCursor] = React.useState<'grab' | 'grabbing' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  const boardViewportRef = React.useRef<HTMLDivElement | null>(null);
  const isFitViewRef = React.useRef(true);
  const viewportSizeRef = React.useRef(viewportSize);
  const isSpacePressedRef = React.useRef(false);
  const panDragRef = React.useRef<PanDrag | null>(null);
  const panOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const snapshotProjectIdRef = React.useRef<string | null>(null);

  const send = React.useCallback((message: ReferenceStudioCommand) => {
    channelRef.current?.postMessage(message);
  }, []);

  React.useEffect(() => {
    const sessionId = getReferenceStudioSessionIdFromLocation();
    if (!sessionId) {
      setError('Open Reference Studio from the Vessel toolbar to connect it.');
      return;
    }
    const channel = createReferenceStudioChannel(sessionId);
    if (!channel) {
      setError('This browser does not support synchronized reference windows.');
      return;
    }
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<ReferenceStudioMainMessage>) => {
      if (event.data?.type !== 'snapshot') return;
      const nextProjectId = event.data.snapshot.project?.id ?? null;
      const didProjectChange = snapshotProjectIdRef.current !== nextProjectId;
      snapshotProjectIdRef.current = nextProjectId;
      setSnapshot(event.data.snapshot);
      setAssetPreviews((current) => {
        if (didProjectChange) {
          return Object.keys(current).length > 0 ? {} : current;
        }
        let didChange = false;
        const next: Record<string, Partial<ReferenceAsset>> = {};
        Object.entries(current).forEach(([id, updates]) => {
          const asset = event.data.snapshot.referenceAssets.find((entry) => entry.id === id);
          const didSnapshotApplyPreview = asset
            ? Object.entries(updates).every(([key, value]) => (
              asset[key as keyof ReferenceAsset] === value
            ))
            : true;
          if (didSnapshotApplyPreview) {
            didChange = true;
          } else {
            next[id] = updates;
          }
        });
        return didChange ? next : current;
      });
      setSelectedId((current) => {
        if (didProjectChange) {
          return event.data.snapshot.referenceAssets[0]?.id ?? null;
        }
        return current && event.data.snapshot.referenceAssets.some((asset) => asset.id === current)
          ? current
          : null;
      });
    };
    channel.postMessage({ type: 'studio-ready' } satisfies ReferenceStudioCommand);
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, []);

  const project = snapshot?.project ?? null;
  const sourceAssets = snapshot?.referenceAssets ?? EMPTY_REFERENCE_ASSETS;
  const assets = React.useMemo(() => sourceAssets.map((asset) => (
    assetPreviews[asset.id]
      ? { ...asset, ...assetPreviews[asset.id] }
      : asset
  )), [assetPreviews, sourceAssets]);
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  const shouldResetTool = !selectedAsset || selectedAsset.locked;
  const projectId = project?.id ?? null;
  const projectWidth = project?.width ?? 0;
  const projectHeight = project?.height ?? 0;
  const viewMetricsRef = React.useRef({ viewScale, viewOrigin });
  viewMetricsRef.current = { viewScale, viewOrigin };
  viewportSizeRef.current = viewportSize;

  React.useEffect(() => {
    if (shouldResetTool) {
      setActiveTool('move');
    }
  }, [shouldResetTool]);

  const fitInitialView = React.useCallback(() => {
    if (!projectId || viewportSize.width <= 0 || viewportSize.height <= 0) return;
    const scale = Math.min(
      (viewportSize.width - 48) / Math.max(1, projectWidth * (1 + INITIAL_VIEW_MARGIN_CANVASES * 2)),
      (viewportSize.height - 48) / Math.max(1, projectHeight * (1 + INITIAL_VIEW_MARGIN_CANVASES * 2)),
      2,
    );
    isFitViewRef.current = true;
    setIsFitView(true);
    const nextScale = Math.max(MIN_VIEW_SCALE, scale);
    setViewScale(nextScale);
    setViewOrigin({
      x: (viewportSize.width - projectWidth * nextScale) / 2,
      y: (viewportSize.height - projectHeight * nextScale) / 2,
    });
  }, [projectHeight, projectId, projectWidth, viewportSize.height, viewportSize.width]);

  React.useLayoutEffect(() => {
    const viewport = boardViewportRef.current;
    if (!viewport || !projectId) return;

    const updateViewportSize = () => {
      const nextSize = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      const previousSize = viewportSizeRef.current;
      if (previousSize.width === nextSize.width && previousSize.height === nextSize.height) return;
      if (!isFitViewRef.current && previousSize.width > 0 && previousSize.height > 0) {
        const metrics = viewMetricsRef.current;
        const worldX = (previousSize.width / 2 - metrics.viewOrigin.x) / metrics.viewScale;
        const worldY = (previousSize.height / 2 - metrics.viewOrigin.y) / metrics.viewScale;
        setViewOrigin({
          x: nextSize.width / 2 - worldX * metrics.viewScale,
          y: nextSize.height / 2 - worldY * metrics.viewScale,
        });
      }
      viewportSizeRef.current = nextSize;
      setViewportSize(nextSize);
    };

    updateViewportSize();
    window.addEventListener('resize', updateViewportSize);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateViewportSize);
    resizeObserver?.observe(viewport);
    return () => {
      window.removeEventListener('resize', updateViewportSize);
      resizeObserver?.disconnect();
    };
  }, [projectId]);

  React.useEffect(() => {
    if (isFitView) fitInitialView();
  }, [fitInitialView, isFitView]);

  React.useEffect(() => {
    const endSpacePan = () => {
      const overlay = panOverlayRef.current;
      const pointerId = panDragRef.current?.pointerId;
      try {
        if (overlay && pointerId !== undefined && overlay.hasPointerCapture?.(pointerId)) {
          overlay.releasePointerCapture(pointerId);
        }
      } catch {
        // Pointer capture can already be gone after cancellation or window blur.
      }
      isSpacePressedRef.current = false;
      panDragRef.current = null;
      setPanCursor(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isInteractiveTarget(event.target)) return;
      event.preventDefault();
      if (event.repeat || isSpacePressedRef.current) return;
      isSpacePressedRef.current = true;
      setPanCursor('grab');
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !isSpacePressedRef.current) return;
      event.preventDefault();
      endSpacePan();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', endSpacePan);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', endSpacePan);
    };
  }, []);

  React.useEffect(() => {
    const viewport = boardViewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();

      const rect = viewport.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const metrics = viewMetricsRef.current;
      const zoomFactor = 1 - event.deltaY * WHEEL_ZOOM_SENSITIVITY;
      const nextScale = Math.max(
        MIN_VIEW_SCALE,
        Math.min(metrics.viewScale * zoomFactor, MAX_VIEW_SCALE),
      );
      if (Math.abs(nextScale - metrics.viewScale) < 0.0001) return;

      const worldX = (pointerX - metrics.viewOrigin.x) / metrics.viewScale;
      const worldY = (pointerY - metrics.viewOrigin.y) / metrics.viewScale;
      setViewOrigin({
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      });
      isFitViewRef.current = false;
      setIsFitView(false);
      setViewScale(nextScale);
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleWheel);
  }, [projectId]);

  const importFiles = React.useCallback(async (files: File[]) => {
    if (files.length === 0 || !project) return;
    setError(null);
    for (const file of files) {
      try {
        if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
        if (file.size > MAX_REFERENCE_FILE_BYTES) throw new Error(`${file.name} exceeds 20 MB`);
        const dataUrl = await readFileAsDataUrl(file);
        const dimensions = await readImageDimensions(dataUrl);
        const scale = Math.min(
          (project.width * 0.8) / dimensions.width,
          (project.height * 0.8) / dimensions.height,
          1,
        );
        const now = Date.now();
        const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? `reference-${crypto.randomUUID()}`
          : `reference-${now}-${Math.random().toString(36).slice(2, 9)}`;
        send({
          type: 'add-reference',
          asset: {
            id,
            name: file.name.replace(/\.[^.]+$/, '') || 'Reference',
            dataUrl,
            naturalWidth: dimensions.width,
            naturalHeight: dimensions.height,
            visible: true,
            locked: false,
            opacity: 1,
            x: (project.width - dimensions.width * scale) / 2,
            y: (project.height - dimensions.height * scale) / 2,
            scale,
            crop: { x: 0, y: 0, width: 1, height: 1 },
            flipX: false,
            flipY: false,
            createdAt: now,
            updatedAt: now,
          },
        });
        setSelectedId(id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to import reference');
      }
    }
  }, [project, send]);

  React.useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData) return;
      const itemFiles = Array.from(clipboardData.items)
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const imageFiles = itemFiles.length > 0
        ? itemFiles
        : Array.from(clipboardData.files).filter((file) => file.type.startsWith('image/'));
      if (imageFiles.length === 0) return;
      event.preventDefault();
      void importFiles(imageFiles);
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [importFiles]);

  const updateAsset = React.useCallback((id: string, updates: Partial<ReferenceAsset>) => {
    send({ type: 'update-reference', id, updates });
  }, [send]);

  const previewAsset = React.useCallback((id: string, updates: Partial<ReferenceAsset>) => {
    setAssetPreviews((current) => ({
      ...current,
      [id]: {
        ...current[id],
        ...updates,
      },
    }));
  }, []);

  const clearAssetPreview = React.useCallback((id: string) => {
    setAssetPreviews((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const fitSelectedAsset = React.useCallback(() => {
    if (!project || !selectedAsset) return;
    updateAsset(
      selectedAsset.id,
      fitReferenceAssetToProject(selectedAsset, project.width, project.height),
    );
  }, [project, selectedAsset, updateAsset]);

  if (!snapshot) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#141514] text-sm text-[#CFCFCF]">
        <div className="border border-[#3A3A3A] bg-[#1A1A1A] px-5 py-4">
          {error ?? 'Waiting for Vessel…'}
        </div>
      </main>
    );
  }

  if (!project) {
    return <main className="flex h-screen items-center justify-center bg-[#141514] text-[#CFCFCF]">Open a Vessel project first.</main>;
  }

  const originX = viewOrigin.x;
  const originY = viewOrigin.y;

  return (
    <main className="flex h-screen min-w-0 overflow-hidden bg-[#141514] text-[#D9D9D9]">
      {areControlsVisible ? (
        <ReferenceStudioControlsPanel
          grid={snapshot.grid}
          layers={snapshot.layers}
          assets={assets}
          samplingSource={snapshot.samplingSource}
          selectedId={selectedId}
          activeTool={activeTool}
          liquifySize={liquifySize}
          liquifyStrength={liquifyStrength}
          error={error}
          onHide={() => setAreControlsVisible(false)}
          onImportFiles={(files) => void importFiles(files)}
          onSelectAsset={setSelectedId}
          onPreviewAsset={previewAsset}
          onClearAssetPreview={clearAssetPreview}
          onUpdateAsset={updateAsset}
          onRemoveAsset={(id) => send({ type: 'remove-reference', id })}
          onMoveAssetToTop={(id) => send({
            type: 'reorder-references',
            orderedIds: [
              ...assets.filter((entry) => entry.id !== id).map((entry) => entry.id),
              id,
            ],
          })}
          onFitSelectedAsset={fitSelectedAsset}
          onSetActiveTool={setActiveTool}
          onSetLiquifySize={setLiquifySize}
          onSetLiquifyStrength={setLiquifyStrength}
          onSetSamplingSource={(source) => send({ type: 'set-sampling-source', source })}
          onSetGrid={(grid) => send({ type: 'set-grid', grid })}
        />
      ) : null}

      <section className="relative flex min-w-0 flex-1 flex-col">
        {!areControlsVisible ? (
          <button
            type="button"
            className={`${iconButtonClass} absolute left-3 top-3 z-20`}
            aria-label="Open controls"
            aria-controls="reference-studio-controls"
            aria-expanded="false"
            onClick={() => setAreControlsVisible(true)}
          >
            <Menu size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
        {panCursor ? (
          <div
            ref={panOverlayRef}
            className="absolute inset-0 z-30"
            data-testid="reference-pan-overlay"
            style={{ cursor: panCursor }}
            onPointerDown={(event) => {
              if (!isSpacePressedRef.current) return;
              const viewport = boardViewportRef.current;
              if (!viewport) return;
              event.preventDefault();
              const metrics = viewMetricsRef.current;
              panDragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY,
                originX: metrics.viewOrigin.x,
                originY: metrics.viewOrigin.y,
              };
              isFitViewRef.current = false;
              setIsFitView(false);
              try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
              } catch {
                // Space-pan still works while the pointer remains over the overlay.
              }
              setPanCursor('grabbing');
            }}
            onPointerMove={(event) => {
              const viewport = boardViewportRef.current;
              const drag = panDragRef.current;
              if (!viewport || !drag || drag.pointerId !== event.pointerId) return;
              setViewOrigin({
                x: drag.originX + event.clientX - drag.clientX,
                y: drag.originY + event.clientY - drag.clientY,
              });
            }}
            onPointerUp={(event) => {
              if (panDragRef.current?.pointerId !== event.pointerId) return;
              panDragRef.current = null;
              try {
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              } catch {
                // The browser may release capture before this handler runs.
              }
              setPanCursor('grab');
            }}
            onPointerCancel={() => {
              panDragRef.current = null;
              setPanCursor(isSpacePressedRef.current ? 'grab' : null);
            }}
          />
        ) : null}
        <div ref={boardViewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#101110]" data-testid="reference-board">
          <div
            className="relative h-full w-full"
            data-testid="reference-board-surface"
            onPointerDown={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest('[data-reference-asset="true"]')) {
                return;
              }
              setSelectedId(null);
            }}
          >
            <div
              className="absolute bg-[#202020]"
              data-testid="reference-document-frame"
              style={{
                left: originX,
                top: originY,
                width: project.width * viewScale,
                height: project.height * viewScale,
              }}
            />
            <GridOverlay
              enabled={snapshot.grid.enabled}
              projectWidth={project.width}
              projectHeight={project.height}
              zoom={viewScale}
              offsetX={originX}
              offsetY={originY}
              rows={snapshot.grid.rows}
              columns={snapshot.grid.columns}
            />
            {assets.map((asset) => (
              <ReferenceAssetCanvas
                key={asset.id}
                asset={asset}
                originX={originX}
                originY={originY}
                viewScale={viewScale}
                isSelected={asset.id === selectedId}
                isLiquifyActive={activeTool === 'liquify'}
                liquifySize={liquifySize}
                liquifyStrength={liquifyStrength}
                onSelect={setSelectedId}
                onPreview={previewAsset}
                onCommit={updateAsset}
                onClearPreview={clearAssetPreview}
                onError={setError}
              />
            ))}
            <div
              className="pointer-events-none absolute shadow-[inset_0_0_0_1px_#B8B8B8]"
              data-testid="reference-document-outline"
              aria-hidden="true"
              style={{
                left: originX,
                top: originY,
                width: project.width * viewScale,
                height: project.height * viewScale,
                zIndex: 10,
              }}
            />
          </div>
        </div>
      </section>
    </main>
  );
};
