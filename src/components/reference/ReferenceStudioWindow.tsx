'use client';

import React from 'react';

import GridOverlay from '@/components/canvas/GridOverlay';
import { ReferenceAssetCanvas } from '@/components/reference/ReferenceAssetCanvas';
import {
  createReferenceStudioChannel,
  getReferenceStudioSessionIdFromLocation,
  type ReferenceStudioCommand,
  type ReferenceStudioMainMessage,
  type ReferenceStudioSnapshot,
} from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset, ReferenceAssetCrop, ReferenceSamplingSource } from '@/types';

const MAX_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;
const BOARD_MARGIN_CANVASES = 1;
const fieldClass = 'h-8 w-full border border-[#444] bg-[#111] px-2 text-xs text-[#E7E7E7] focus:border-[#D9D9D9] focus:outline-none';
const buttonClass = 'border border-[#555] bg-[#242424] px-2 py-1.5 text-xs text-[#E7E7E7] hover:bg-[#303030] disabled:cursor-not-allowed disabled:opacity-40';

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

const encodeSource = (source: ReferenceSamplingSource): string => {
  if (source.kind === 'layer') return `layer:${source.layerId}`;
  if (source.kind === 'asset') return `asset:${source.assetId}`;
  return 'canvas';
};

const decodeSource = (value: string): ReferenceSamplingSource => {
  if (value.startsWith('layer:')) return { kind: 'layer', layerId: value.slice(6) };
  if (value.startsWith('asset:')) return { kind: 'asset', assetId: value.slice(6) };
  return { kind: 'canvas' };
};

const updateCropEdge = (
  crop: ReferenceAssetCrop,
  edge: 'left' | 'top' | 'right' | 'bottom',
  percent: number,
): ReferenceAssetCrop => {
  const value = Math.max(0, Math.min(99, percent)) / 100;
  const right = 1 - crop.x - crop.width;
  const bottom = 1 - crop.y - crop.height;
  if (edge === 'left') return { ...crop, x: value, width: Math.max(0.01, 1 - value - right) };
  if (edge === 'top') return { ...crop, y: value, height: Math.max(0.01, 1 - value - bottom) };
  if (edge === 'right') return { ...crop, width: Math.max(0.01, 1 - crop.x - value) };
  return { ...crop, height: Math.max(0.01, 1 - crop.y - value) };
};

export const ReferenceStudioWindow = () => {
  const [snapshot, setSnapshot] = React.useState<ReferenceStudioSnapshot | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [viewScale, setViewScale] = React.useState(0.5);
  const [error, setError] = React.useState<string | null>(null);
  const channelRef = React.useRef<BroadcastChannel | null>(null);
  const boardViewportRef = React.useRef<HTMLDivElement | null>(null);

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
      setSnapshot(event.data.snapshot);
      setSelectedId((current) => (
        current && event.data.snapshot.referenceAssets.some((asset) => asset.id === current)
          ? current
          : event.data.snapshot.referenceAssets[0]?.id ?? null
      ));
    };
    channel.postMessage({ type: 'studio-ready' } satisfies ReferenceStudioCommand);
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, []);

  const project = snapshot?.project ?? null;
  const assets = snapshot?.referenceAssets ?? [];
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;

  const fitBoard = React.useCallback(() => {
    const viewport = boardViewportRef.current;
    if (!viewport || !project) return;
    const scale = Math.min(
      (viewport.clientWidth - 48) / Math.max(1, project.width * (1 + BOARD_MARGIN_CANVASES * 2)),
      (viewport.clientHeight - 48) / Math.max(1, project.height * (1 + BOARD_MARGIN_CANVASES * 2)),
      2,
    );
    setViewScale(Math.max(0.05, scale));
  }, [project]);

  React.useEffect(() => {
    fitBoard();
  }, [fitBoard]);

  const importFiles = React.useCallback(async (files: FileList | null) => {
    if (!files || !project) return;
    setError(null);
    for (const file of Array.from(files)) {
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

  const updateAsset = React.useCallback((id: string, updates: Partial<ReferenceAsset>) => {
    send({ type: 'update-reference', id, updates });
  }, [send]);

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

  const boardPaddingX = project.width * BOARD_MARGIN_CANVASES;
  const boardPaddingY = project.height * BOARD_MARGIN_CANVASES;
  const originX = boardPaddingX * viewScale;
  const originY = boardPaddingY * viewScale;

  return (
    <main className="flex h-screen min-w-[760px] overflow-hidden bg-[#141514] text-[#D9D9D9]">
      <aside className="flex w-[310px] flex-shrink-0 flex-col border-r border-[#333] bg-[#1A1A1A]">
        <header className="border-b border-[#333] px-4 py-3">
          <div className="text-sm font-semibold">Reference Studio</div>
          <div className="mt-1 truncate text-[11px] text-[#929292]" data-testid="reference-project-name">
            {project.name} · {project.width}×{project.height}
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <label className={`${buttonClass} block cursor-pointer text-center`}>
            Import references
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              data-testid="reference-file-input"
              onChange={(event) => {
                void importFiles(event.target.files);
                event.currentTarget.value = '';
              }}
            />
          </label>
          {error ? <div role="alert" className="border border-red-700 bg-red-950/40 p-2 text-xs text-red-200">{error}</div> : null}

          <section className="space-y-2">
            <label className="block text-[11px] uppercase tracking-[0.14em] text-[#999]" htmlFor="reference-sampling-source">Sample from</label>
            <select
              id="reference-sampling-source"
              className={fieldClass}
              data-testid="reference-sampling-source"
              value={encodeSource(snapshot.samplingSource)}
              onChange={(event) => send({ type: 'set-sampling-source', source: decodeSource(event.target.value) })}
            >
              <option value="canvas">Canvas composite</option>
              <optgroup label="Artwork layers">
                {snapshot.layers.map((layer) => <option key={layer.id} value={`layer:${layer.id}`}>{layer.name}</option>)}
              </optgroup>
              <optgroup label="Reference Studio">
                {assets.map((asset) => <option key={asset.id} value={`asset:${asset.id}`}>{asset.name}</option>)}
              </optgroup>
            </select>
          </section>

          <section className="space-y-2 border-t border-[#333] pt-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.14em] text-[#999]">Synced grid</span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={snapshot.grid.enabled}
                  onChange={(event) => send({ type: 'set-grid', grid: { enabled: event.target.checked } })}
                />
                Visible
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(['rows', 'columns'] as const).map((key) => (
                <label key={key} className="text-xs capitalize">
                  {key}
                  <input
                    className={`${fieldClass} mt-1`}
                    type="number"
                    min={1}
                    max={128}
                    value={snapshot.grid[key]}
                    data-testid={`reference-grid-${key}`}
                    onChange={(event) => send({ type: 'set-grid', grid: { [key]: Number(event.target.value) } })}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-2 border-t border-[#333] pt-3" data-testid="reference-list">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[#999]">References · {assets.length}</div>
            {assets.length === 0 ? <div className="text-xs text-[#777]">Import an image to begin.</div> : null}
            {assets.map((asset, index) => (
              <div key={asset.id} className={`border p-2 ${selectedId === asset.id ? 'border-[#D9D9D9]' : 'border-[#3A3A3A]'}`}>
                <button type="button" className="w-full bg-transparent text-left text-xs" onClick={() => setSelectedId(asset.id)}>{asset.name}</button>
                <div className="mt-2 flex items-center gap-2 text-[11px]">
                  <label><input type="checkbox" checked={asset.visible} onChange={(event) => updateAsset(asset.id, { visible: event.target.checked })} /> Show</label>
                  <label><input type="checkbox" checked={asset.locked} onChange={(event) => updateAsset(asset.id, { locked: event.target.checked })} /> Lock</label>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={index === assets.length - 1}
                    onClick={() => send({
                      type: 'reorder-references',
                      orderedIds: [
                        ...assets.filter((entry) => entry.id !== asset.id).map((entry) => entry.id),
                        asset.id,
                      ],
                    })}
                  >
                    Top
                  </button>
                  <button type="button" className={`${buttonClass} ml-auto`} onClick={() => send({ type: 'remove-reference', id: asset.id })}>Remove</button>
                </div>
              </div>
            ))}
          </section>

          {selectedAsset ? (
            <section className="space-y-3 border-t border-[#333] pt-3" data-testid="reference-inspector">
              <div className="text-[11px] uppercase tracking-[0.14em] text-[#999]">Selected reference</div>
              <label className="block text-xs">Name<input className={`${fieldClass} mt-1`} defaultValue={selectedAsset.name} key={`${selectedAsset.id}-${selectedAsset.name}`} onBlur={(event) => updateAsset(selectedAsset.id, { name: event.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                {(['x', 'y'] as const).map((key) => <label key={key} className="text-xs uppercase">{key}<input className={`${fieldClass} mt-1`} type="number" value={Math.round(selectedAsset[key])} onChange={(event) => updateAsset(selectedAsset.id, { [key]: Number(event.target.value) })} /></label>)}
              </div>
              <label className="block text-xs">Scale · {Math.round(selectedAsset.scale * 100)}%<input className="mt-1 w-full" type="range" min={1} max={400} value={Math.round(selectedAsset.scale * 100)} onChange={(event) => updateAsset(selectedAsset.id, { scale: Number(event.target.value) / 100 })} /></label>
              <label className="block text-xs">Opacity · {Math.round(selectedAsset.opacity * 100)}%<input className="mt-1 w-full" type="range" min={0} max={100} value={Math.round(selectedAsset.opacity * 100)} onChange={(event) => updateAsset(selectedAsset.id, { opacity: Number(event.target.value) / 100 })} /></label>
              <div className="grid grid-cols-4 gap-1">
                {(['left', 'top', 'right', 'bottom'] as const).map((edge) => {
                  const percent = edge === 'left'
                    ? selectedAsset.crop.x * 100
                    : edge === 'top'
                      ? selectedAsset.crop.y * 100
                      : edge === 'right'
                        ? (1 - selectedAsset.crop.x - selectedAsset.crop.width) * 100
                        : (1 - selectedAsset.crop.y - selectedAsset.crop.height) * 100;
                  return <label key={edge} className="text-[10px] capitalize">{edge}<input className={`${fieldClass} mt-1 px-1 text-center`} type="number" min={0} max={99} value={Math.round(percent)} onChange={(event) => updateAsset(selectedAsset.id, { crop: updateCropEdge(selectedAsset.crop, edge, Number(event.target.value)) })} /></label>;
                })}
              </div>
              <div className="flex gap-2">
                <button type="button" className={buttonClass} onClick={() => updateAsset(selectedAsset.id, { flipX: !selectedAsset.flipX })}>Flip X</button>
                <button type="button" className={buttonClass} onClick={() => updateAsset(selectedAsset.id, { flipY: !selectedAsset.flipY })}>Flip Y</button>
                <button type="button" className={buttonClass} onClick={() => updateAsset(selectedAsset.id, { crop: { x: 0, y: 0, width: 1, height: 1 } })}>Reset crop</button>
              </div>
            </section>
          ) : null}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 flex-shrink-0 items-center gap-3 border-b border-[#333] bg-[#1A1A1A] px-4">
          <span className="text-xs text-[#999]">Board zoom</span>
          <input type="range" min={5} max={200} value={Math.round(viewScale * 100)} onChange={(event) => setViewScale(Number(event.target.value) / 100)} />
          <span className="w-12 text-xs">{Math.round(viewScale * 100)}%</span>
          <button type="button" className={buttonClass} onClick={fitBoard}>Fit</button>
          <span className="ml-auto text-[11px] text-[#858585]">Drag unlocked references. Grid changes sync both ways.</span>
        </header>
        <div ref={boardViewportRef} className="min-h-0 flex-1 overflow-auto bg-[#101110]" data-testid="reference-board">
          <div
            className="relative"
            style={{
              width: project.width * (1 + BOARD_MARGIN_CANVASES * 2) * viewScale,
              height: project.height * (1 + BOARD_MARGIN_CANVASES * 2) * viewScale,
              minWidth: '100%',
              minHeight: '100%',
            }}
          >
            <div
              className="absolute border border-[#555] bg-[#202020]"
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
                selected={selectedId === asset.id}
                onSelect={setSelectedId}
                onUpdate={updateAsset}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
