import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';

import CropOverlay from '@/components/canvas/CropOverlay';
import { useCropState } from '@/hooks/useCropState';
import type { CropState } from '@/types';

jest.mock('@/hooks/useCropState');

// jsdom lacks PointerEvent; preserve coordinates and identity for capture routing.
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

const originalPointerEvent = window.PointerEvent;
beforeAll(() => { window.PointerEvent = TestPointerEvent as typeof PointerEvent; });
afterAll(() => { window.PointerEvent = originalPointerEvent; });

const mount = (marquee: CropState['marquee'] = null, isSpacePressed = false) => {
  let latestCrop: CropState;
  let resetCrop: () => void;
  jest.mocked(useCropState).mockImplementation(function useTestCropState() {
    const [crop, setCrop] = React.useState<CropState>({
      status: marquee ? 'ready' : 'idle',
      marquee,
      activeHandle: null,
      commitInFlight: false,
    });
    latestCrop = crop;
    const setCropState = React.useCallback((partial: Partial<CropState>) => {
      setCrop((previous) => ({ ...previous, ...partial }));
    }, []);
    resetCrop = () => setCropState({ status: 'idle', marquee: null, activeHandle: null });
    return {
      crop,
      setCropState,
      resetCrop: jest.fn(),
      cancelCrop: jest.fn(),
      commitCrop: jest.fn(),
    };
  });

  let capturedTarget: HTMLDivElement | null = null;
  const parentPointerDown = jest.fn((event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  const { container } = render(
    <div onPointerDown={parentPointerDown}>
      <CropOverlay
        projectWidth={256}
        projectHeight={256}
        zoom={2}
        offsetX={10}
        offsetY={15}
        active
        isSpacePressed={isSpacePressed}
      />
    </div>,
  );
  const parent = container.firstElementChild as HTMLDivElement;
  const overlay = parent.firstElementChild as HTMLDivElement;
  for (const element of [parent, overlay]) {
    element.setPointerCapture = jest.fn(() => { capturedTarget = element; });
    element.hasPointerCapture = jest.fn(() => capturedTarget === element);
    element.releasePointerCapture = jest.fn(() => { capturedTarget = null; });
  }
  const pointer = (x: number, y: number) => ({
    clientX: x * 2 + 10,
    clientY: y * 2 + 15,
    pointerId: 1,
    bubbles: true,
  });
  return {
    overlay,
    parentPointerDown,
    pointer,
    crop: () => latestCrop,
    resetCrop: () => act(() => resetCrop()),
    capturedTarget: () => capturedTarget ?? parent,
  };
};

it('keeps capture while creating a crop inside a canvas that also captures pointer down', () => {
  const { overlay, parentPointerDown, pointer, crop, capturedTarget } = mount();
  fireEvent.pointerDown(overlay, pointer(20, 30));
  fireEvent.pointerMove(capturedTarget(), pointer(80, 70));
  fireEvent.pointerUp(capturedTarget(), pointer(80, 70));

  expect(crop()).toMatchObject({
    marquee: { x: 20, y: 30, width: 60, height: 40 },
    status: 'ready',
    activeHandle: null,
  });
  expect(parentPointerDown).not.toHaveBeenCalled();
  expect(overlay.releasePointerCapture).toHaveBeenCalledWith(1);
});

it.each([
  { selector: '[style*="cursor: move"]', expected: { x: 30, y: 40, width: 60, height: 40 } },
  { selector: '[data-handle="bottom-right"]', expected: { x: 20, y: 30, width: 70, height: 50 } },
])('retains crop capture for $selector', ({ selector, expected }) => {
  const { overlay, parentPointerDown, pointer, crop, capturedTarget } = mount({
    x: 20, y: 30, width: 60, height: 40,
  });
  fireEvent.pointerDown(overlay.querySelector(selector)!, pointer(80, 70));
  fireEvent.pointerMove(capturedTarget(), pointer(90, 80));
  fireEvent.pointerUp(capturedTarget(), pointer(90, 80));

  expect(crop()).toMatchObject({ marquee: expected, status: 'ready', activeHandle: null });
  expect(parentPointerDown).not.toHaveBeenCalled();
  expect(overlay.releasePointerCapture).toHaveBeenCalledWith(1);
});

const cropInteractions = [
  { label: 'create', selector: null, expected: { x: 80, y: 70, width: 10, height: 10 } },
  { label: 'move', selector: '[style*="cursor: move"]', expected: { x: 30, y: 40, width: 60, height: 40 } },
  { label: 'resize', selector: '[data-handle="bottom-right"]', expected: { x: 20, y: 30, width: 70, height: 50 } },
];

it.each(cropInteractions.flatMap((interaction) => [
  { ...interaction, intermediateMove: false },
  { ...interaction, intermediateMove: true },
]))('applies the $label release coordinate with intermediate move $intermediateMove', ({ selector, expected, intermediateMove }) => {
  const { overlay, pointer, crop } = mount({ x: 20, y: 30, width: 60, height: 40 });
  fireEvent.pointerDown(selector ? overlay.querySelector(selector)! : overlay, pointer(80, 70));
  if (intermediateMove) {
    fireEvent.pointerMove(overlay, pointer(85, 75));
  }
  fireEvent.pointerUp(overlay, pointer(90, 80));

  expect(crop()).toMatchObject({ marquee: expected, status: 'ready', activeHandle: null });
  const releasedCrop = crop();
  fireEvent.pointerMove(overlay, pointer(110, 100));
  expect(crop()).toBe(releasedCrop);
});

it.each(cropInteractions.flatMap((interaction) => [
  { ...interaction, button: 1 },
  { ...interaction, button: 2 },
]))('ignores button $button for crop $label', ({ selector, button }) => {
  const { overlay, pointer, crop } = mount({ x: 20, y: 30, width: 60, height: 40 });
  const initialCrop = crop();
  fireEvent.pointerDown(selector ? overlay.querySelector(selector)! : overlay, { ...pointer(80, 70), button });
  fireEvent.pointerMove(overlay, { ...pointer(90, 80), buttons: button === 1 ? 4 : 2 });
  fireEvent.pointerUp(overlay, { ...pointer(90, 80), button });

  expect(crop()).toBe(initialCrop);
  expect(overlay.setPointerCapture).not.toHaveBeenCalled();
});

it.each(cropInteractions)('keeps the last $label position on cancellation and ignores a later release', ({ selector }) => {
  const { overlay, pointer, crop } = mount({ x: 20, y: 30, width: 60, height: 40 });
  fireEvent.pointerDown(selector ? overlay.querySelector(selector)! : overlay, pointer(80, 70));
  fireEvent.pointerMove(overlay, pointer(85, 75));
  const lastMarquee = crop().marquee;
  fireEvent.pointerCancel(overlay, pointer(90, 80));
  expect(crop()).toMatchObject({ marquee: lastMarquee, status: 'ready', activeHandle: null });

  const cancelledCrop = crop();
  fireEvent.pointerUp(overlay, pointer(110, 100));
  expect(crop()).toBe(cancelledCrop);
});

it('leaves crop state unchanged when released or cancelled without a crop interaction', () => {
  const { overlay, pointer, crop } = mount();
  const initialCrop = crop();
  fireEvent.pointerUp(overlay, pointer(90, 80));
  fireEvent.pointerCancel(overlay, pointer(90, 80));
  expect(crop()).toBe(initialCrop);
});

it.each(cropInteractions)('does not resurrect a cancelled crop during an active $label drag', ({ selector }) => {
  const { overlay, pointer, crop, resetCrop } = mount({ x: 20, y: 30, width: 60, height: 40 });
  fireEvent.pointerDown(selector ? overlay.querySelector(selector)! : overlay, pointer(80, 70));
  fireEvent.pointerMove(overlay, pointer(85, 75));
  resetCrop();
  const cancelledCrop = crop();
  fireEvent.pointerMove(overlay, pointer(90, 80));
  fireEvent.pointerUp(overlay, pointer(100, 90));

  expect(crop()).toBe(cancelledCrop);
  expect(crop()).toMatchObject({ status: 'idle', marquee: null, activeHandle: null });
  expect(overlay.releasePointerCapture).toHaveBeenCalledWith(1);
});

it.each(cropInteractions)('passes Space input to the parent without starting crop $label', ({ selector }) => {
  const { overlay, parentPointerDown, pointer, crop } = mount({ x: 20, y: 30, width: 60, height: 40 }, true);
  const initialCrop = crop();
  fireEvent.pointerDown(selector ? overlay.querySelector(selector)! : overlay, pointer(80, 70));
  fireEvent.pointerMove(overlay, pointer(90, 80));
  fireEvent.pointerUp(overlay, pointer(100, 90));

  expect(crop()).toBe(initialCrop);
  expect(parentPointerDown).toHaveBeenCalledTimes(1);
  expect(overlay.setPointerCapture).not.toHaveBeenCalled();
});

it('lets the crop body inherit the Space-disabled overlay hit testing', () => {
  const { overlay } = mount({ x: 20, y: 30, width: 60, height: 40 }, true);
  const body = overlay.querySelector<HTMLDivElement>('[style*="cursor: move"]')!;
  expect(overlay.style.pointerEvents).toBe('none');
  expect(body.style.pointerEvents).toBe('');
});
