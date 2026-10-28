export interface SequentialLayerRendererDiagnostics {
  renderCalls: number;
  presentationHits: number;
  frameCacheMisses: number;
  materializeMisses: number;
  workerHits: number;
  workerWarmRequests: number;
  workerCurrentRequests: number;
  workerDeferredFrames: number;
  signatureResets: number;
  eventTailResets: number;
  appendBatches: number;
  dirtyPatchMisses: number;
  deferredAppendPatches: number;
  lastLayerId: string | null;
  lastFrameIndex: number | null;
  lastSourceFrameIndex: number | null;
  lastMaterializeEvents: number;
  lastResetReason: 'signature' | 'event-tail' | null;
  lastRenderSignature: string | null;
}

export const rendererDiagnostics: SequentialLayerRendererDiagnostics = {
  renderCalls: 0,
  presentationHits: 0,
  frameCacheMisses: 0,
  materializeMisses: 0,
  workerHits: 0,
  workerWarmRequests: 0,
  workerCurrentRequests: 0,
  workerDeferredFrames: 0,
  signatureResets: 0,
  eventTailResets: 0,
  appendBatches: 0,
  dirtyPatchMisses: 0,
  deferredAppendPatches: 0,
  lastLayerId: null,
  lastFrameIndex: null,
  lastSourceFrameIndex: null,
  lastMaterializeEvents: 0,
  lastResetReason: null,
  lastRenderSignature: null,
};

export const publishRendererDiagnostics = (): void => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const target = globalThis as typeof globalThis & {
    __vesselSequentialRendererDiagnostics?: SequentialLayerRendererDiagnostics;
    __vesselSequentialRendererResetDiagnostics?: () => void;
  };
  target.__vesselSequentialRendererDiagnostics = { ...rendererDiagnostics };
  target.__vesselSequentialRendererResetDiagnostics = resetSequentialLayerRendererDiagnostics;
};

export const getSequentialLayerRendererDiagnostics = (): SequentialLayerRendererDiagnostics => ({
  ...rendererDiagnostics,
});

export const resetSequentialLayerRendererDiagnostics = (): void => {
  rendererDiagnostics.renderCalls = 0;
  rendererDiagnostics.presentationHits = 0;
  rendererDiagnostics.frameCacheMisses = 0;
  rendererDiagnostics.materializeMisses = 0;
  rendererDiagnostics.workerHits = 0;
  rendererDiagnostics.workerWarmRequests = 0;
  rendererDiagnostics.workerCurrentRequests = 0;
  rendererDiagnostics.workerDeferredFrames = 0;
  rendererDiagnostics.signatureResets = 0;
  rendererDiagnostics.eventTailResets = 0;
  rendererDiagnostics.appendBatches = 0;
  rendererDiagnostics.dirtyPatchMisses = 0;
  rendererDiagnostics.deferredAppendPatches = 0;
  rendererDiagnostics.lastLayerId = null;
  rendererDiagnostics.lastFrameIndex = null;
  rendererDiagnostics.lastSourceFrameIndex = null;
  rendererDiagnostics.lastMaterializeEvents = 0;
  rendererDiagnostics.lastResetReason = null;
  rendererDiagnostics.lastRenderSignature = null;
  publishRendererDiagnostics();
};
