import type { VesselCollaborationPoint } from './vesselCollaborationProtocol';

interface DispatchVesselCollaborationStrokeOptions {
  canvas: HTMLCanvasElement;
  points: VesselCollaborationPoint[];
  pointsPerFrame: number;
  zoom: number;
  worldToScreen: (x: number, y: number, zoom: number) => { x: number; y: number };
  isBusy: () => boolean;
  waitForFrame?: () => Promise<void>;
  now?: () => number;
  idleTimeoutMs?: number;
}

const defaultWaitForFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const dispatchVesselCollaborationStroke = async ({
  canvas,
  points,
  pointsPerFrame,
  zoom,
  worldToScreen,
  isBusy,
  waitForFrame = defaultWaitForFrame,
  now = () => performance.now(),
  idleTimeoutMs = 30000,
}: DispatchVesselCollaborationStrokeOptions) => {
  const createPointerEvent = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    point: VesselCollaborationPoint,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const screenPoint = worldToScreen(point.x, point.y, zoom || 1);
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 9191,
      pointerType: 'pen',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + screenPoint.x,
      clientY: rect.top + screenPoint.y,
      pressure: point.pressure ?? 1,
    });
  };

  const dispatchPointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    point: VesselCollaborationPoint,
    coalescedPoints?: VesselCollaborationPoint[],
  ) => {
    const event = createPointerEvent(type, point);
    if (coalescedPoints && coalescedPoints.length > 1) {
      const coalescedEvents = coalescedPoints.map((coalescedPoint) =>
        createPointerEvent('pointermove', coalescedPoint));
      Object.defineProperty(event, 'getCoalescedEvents', {
        configurable: true,
        value: () => coalescedEvents,
      });
    }
    canvas.dispatchEvent(event);
  };

  const [first, ...rest] = points;
  dispatchPointer('pointerdown', first);
  await waitForFrame();
  for (let index = 0; index < rest.length; index += pointsPerFrame) {
    const framePoints = rest.slice(index, index + pointsPerFrame);
    dispatchPointer('pointermove', framePoints.at(-1)!, framePoints);
    await waitForFrame();
  }
  dispatchPointer('pointerup', rest.at(-1) ?? first);
  await waitForFrame();

  const idleDeadline = now() + idleTimeoutMs;
  while (isBusy() && now() < idleDeadline) {
    await waitForFrame();
  }
  if (isBusy()) {
    throw new Error('Vessel stroke finalization did not become idle');
  }
  await waitForFrame();
};
