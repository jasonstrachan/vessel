export type CcHangProbePhase =
  | 'shape-preview-frame-start'
  | 'shape-preview-before-runtime'
  | 'shape-preview-after-runtime-call'
  | 'cc-runtime-job-start'
  | 'cc-runtime-before-fillCcGradientDither'
  | 'cc-runtime-after-fillCcGradientDither'
  | 'cc-runtime-before-putImageData'
  | 'cc-runtime-after-putImageData'
  | 'cc-runtime-before-display-blit'
  | 'cc-runtime-after-display-blit'
  | 'shape-finalize-start'
  | 'shape-finalize-before-fill'
  | 'shape-finalize-after-fill'
  | 'shape-finalize-before-commit'
  | 'shape-finalize-after-commit';

export type CcHangProbeSnapshot = {
  phase: CcHangProbePhase;
  t: number;
  dt: number;
  markKind?: string;
  source?: string | null;
  algorithm?: string | null;
  levels?: number | null;
  colors?: number | null;
  pointCount?: number | null;
  previewPointCountRaw?: number | null;
  previewPointCountSimplified?: number | null;
  replayKeyPointCount?: number | null;
  w?: number | null;
  h?: number | null;
  scaledW?: number | null;
  scaledH?: number | null;
  pixelSize?: number | null;
  sampledFlatPreviewBypass?: boolean;
  inFlight?: boolean;
  dirty?: boolean;
  seq?: number | null;
  previewFrameCount: number;
  finalizeCount: number;
};

declare global {
  interface Window {
    __ccHangProbe?: CcHangProbeSnapshot;
    __ccHangProbeCanvas?: HTMLCanvasElement;
  }
}

type StampCcHangProbeArgs = Omit<Partial<CcHangProbeSnapshot>, 't' | 'dt' | 'previewFrameCount' | 'finalizeCount'> & {
  phase: CcHangProbePhase;
  canvas?: HTMLCanvasElement | null;
  ctx?: CanvasRenderingContext2D | null;
  incrementPreviewFrame?: boolean;
  incrementFinalizeCount?: boolean;
};

const HUD_X = 8;
const HUD_Y = 8;
const HUD_WIDTH = 520;
const HUD_LINE_HEIGHT = 12;
const HUD_PADDING = 8;

let persistentHudCanvas: HTMLCanvasElement | null = null;
let persistentHudCtx: CanvasRenderingContext2D | null = null;

const resolveCcHangProbeHudOn = (): boolean => {
  const scope = globalThis as { CC_HANG_PROBE?: { on?: boolean } };
  if (scope.CC_HANG_PROBE?.on === true) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  if ((window as Window & { __CC_HANG_PROBE__?: boolean }).__CC_HANG_PROBE__ === true) {
    return true;
  }

  try {
    return window.localStorage?.getItem('ccHangProbe') === '1';
  } catch {
    return false;
  }
};

const resolveNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const drawCcHangProbeHud = (
  ctx: CanvasRenderingContext2D,
  snapshot: CcHangProbeSnapshot,
  options?: { clearCanvas?: boolean }
): void => {
  const orderedKeys: Array<keyof CcHangProbeSnapshot> = [
    'phase',
    't',
    'dt',
    'markKind',
    'source',
    'algorithm',
    'levels',
    'colors',
    'pointCount',
    'previewPointCountRaw',
    'previewPointCountSimplified',
    'replayKeyPointCount',
    'w',
    'h',
    'scaledW',
    'scaledH',
    'pixelSize',
    'sampledFlatPreviewBypass',
    'inFlight',
    'dirty',
    'seq',
    'previewFrameCount',
    'finalizeCount',
  ];
  const lines = orderedKeys.map((key) => {
    const value = snapshot[key];
    if (typeof value === 'number') {
      return `${key}: ${Number.isInteger(value) ? value : value.toFixed(2)}`;
    }
    return `${key}: ${value ?? 'null'}`;
  });
  const hudHeight = HUD_PADDING * 2 + lines.length * HUD_LINE_HEIGHT + 6;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (options?.clearCanvas) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
  ctx.fillRect(HUD_X, HUD_Y, HUD_WIDTH, hudHeight);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(HUD_X + 0.5, HUD_Y + 0.5, HUD_WIDTH - 1, hudHeight - 1);
  ctx.fillStyle = '#9dfc9d';
  ctx.font = '11px monospace';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, HUD_X + HUD_PADDING, HUD_Y + HUD_PADDING + index * HUD_LINE_HEIGHT);
  });
  ctx.restore();
};

const ensurePersistentHud = (): CanvasRenderingContext2D | null => {
  if (!resolveCcHangProbeHudOn()) {
    if (persistentHudCanvas && persistentHudCanvas.parentNode) {
      persistentHudCanvas.parentNode.removeChild(persistentHudCanvas);
    }
    persistentHudCanvas = null;
    persistentHudCtx = null;
    if (typeof window !== 'undefined') {
      delete window.__ccHangProbeCanvas;
    }
    return null;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  if (persistentHudCanvas && persistentHudCtx && document.body.contains(persistentHudCanvas)) {
    return persistentHudCtx;
  }

  const canvas = document.createElement('canvas');
  canvas.width = HUD_WIDTH + HUD_X * 2;
  canvas.height = 320;
  canvas.style.position = 'fixed';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2147483647';
  canvas.style.opacity = '1';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  persistentHudCanvas = canvas;
  persistentHudCtx = canvas.getContext('2d');
  if (typeof window !== 'undefined') {
    window.__ccHangProbeCanvas = canvas;
  }
  return persistentHudCtx;
};

export const stampCcHangProbe = ({
  phase,
  canvas,
  ctx,
  incrementPreviewFrame = false,
  incrementFinalizeCount = false,
  ...rest
}: StampCcHangProbeArgs): CcHangProbeSnapshot => {
  const scope = globalThis as typeof globalThis & { __ccHangProbe?: CcHangProbeSnapshot };
  const previous = scope.__ccHangProbe;
  const now = resolveNow();
  const snapshot: CcHangProbeSnapshot = {
    phase,
    t: now,
    dt: previous ? now - previous.t : 0,
    previewFrameCount: (previous?.previewFrameCount ?? 0) + (incrementPreviewFrame ? 1 : 0),
    finalizeCount: (previous?.finalizeCount ?? 0) + (incrementFinalizeCount ? 1 : 0),
    ...previous,
    ...rest,
  };
  snapshot.phase = phase;
  snapshot.t = now;
  snapshot.dt = previous ? now - previous.t : 0;
  snapshot.previewFrameCount = (previous?.previewFrameCount ?? 0) + (incrementPreviewFrame ? 1 : 0);
  snapshot.finalizeCount = (previous?.finalizeCount ?? 0) + (incrementFinalizeCount ? 1 : 0);
  scope.__ccHangProbe = snapshot;

  const targetCtx = ensurePersistentHud();
  if (targetCtx) {
    drawCcHangProbeHud(targetCtx, snapshot, { clearCanvas: true });
  }
  void canvas;
  void ctx;

  return snapshot;
};
