'use client';

import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  createReferenceStudioChannel,
  getReferenceStudioSessionId,
  type ReferenceStudioCommand,
  type ReferenceStudioMainMessage,
  type ReferenceStudioSnapshot,
} from '@/referenceStudio/referenceStudioChannel';
import { useAppStore } from '@/stores/useAppStore';

const EMPTY_ASSETS: ReferenceStudioSnapshot['referenceAssets'] = [];
const CANVAS_SOURCE = { kind: 'canvas' as const };

export const ReferenceStudioBridge = () => {
  const snapshotState = useAppStore(useShallow((state) => ({
    project: state.project,
    layers: state.layers,
    grid: state.ui.grid,
  })));
  const actions = useAppStore(useShallow((state) => ({
    addReferenceAsset: state.addReferenceAsset,
    updateReferenceAsset: state.updateReferenceAsset,
    removeReferenceAsset: state.removeReferenceAsset,
    reorderReferenceAssets: state.reorderReferenceAssets,
    setReferenceSamplingSource: state.setReferenceSamplingSource,
    setGridEnabled: state.setGridEnabled,
    setGridDimensions: state.setGridDimensions,
  })));
  const channelRef = React.useRef<BroadcastChannel | null>(null);

  const snapshot = React.useMemo<ReferenceStudioSnapshot>(() => ({
    project: snapshotState.project
      ? {
          id: snapshotState.project.id,
          name: snapshotState.project.name,
          width: snapshotState.project.width,
          height: snapshotState.project.height,
        }
      : null,
    grid: snapshotState.grid,
    layers: snapshotState.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      layerType: layer.layerType,
    })),
    referenceAssets: snapshotState.project?.referenceAssets ?? EMPTY_ASSETS,
    samplingSource: snapshotState.project?.referenceSamplingSource ?? CANVAS_SOURCE,
  }), [snapshotState.grid, snapshotState.layers, snapshotState.project]);
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;

  React.useEffect(() => {
    const channel = createReferenceStudioChannel(getReferenceStudioSessionId());
    if (!channel) return;
    channelRef.current = channel;

    const sendSnapshot = () => {
      channel.postMessage({
        type: 'snapshot',
        snapshot: snapshotRef.current,
      } satisfies ReferenceStudioMainMessage);
    };

    channel.onmessage = (event: MessageEvent<ReferenceStudioCommand>) => {
      const message = event.data;
      switch (message?.type) {
        case 'studio-ready':
          sendSnapshot();
          break;
        case 'add-reference':
          actions.addReferenceAsset(message.asset);
          break;
        case 'update-reference':
          actions.updateReferenceAsset(message.id, message.updates);
          break;
        case 'remove-reference':
          actions.removeReferenceAsset(message.id);
          break;
        case 'reorder-references':
          actions.reorderReferenceAssets(message.orderedIds);
          break;
        case 'set-sampling-source':
          actions.setReferenceSamplingSource(message.source);
          break;
        case 'set-grid':
          if (typeof message.grid.enabled === 'boolean') {
            actions.setGridEnabled(message.grid.enabled);
          }
          actions.setGridDimensions(message.grid);
          break;
      }
    };
    sendSnapshot();

    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, [actions]);

  React.useEffect(() => {
    channelRef.current?.postMessage({
      type: 'snapshot',
      snapshot,
    } satisfies ReferenceStudioMainMessage);
  }, [snapshot]);

  return null;
};
