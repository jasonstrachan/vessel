import React from 'react';
import { fireEvent, render } from '@testing-library/react';

import FloatingPasteOverlay from '@/components/canvas/FloatingPasteOverlay';

const updateFloatingPasteRect = jest.fn();
const updateFloatingPasteRotation = jest.fn();
const floatingPaste = {
  position: { x: 20, y: 30 },
  displayWidth: 40,
  displayHeight: 20,
  rotation: 0,
};

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    floatingPaste,
    updateFloatingPasteRect,
    updateFloatingPasteRotation,
  }),
}));

// jsdom lacks PointerEvent; retain the pointer identity alongside real MouseEvent coordinates.
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
beforeEach(() => { jest.clearAllMocks(); });

const mount = () => {
  const { container } = render(
    <FloatingPasteOverlay projectWidth={256} projectHeight={256} zoom={2} offsetX={10} offsetY={15} />,
  );
  const overlay = container.firstElementChild as HTMLDivElement;
  overlay.setPointerCapture = jest.fn();
  overlay.hasPointerCapture = jest.fn(() => true);
  overlay.releasePointerCapture = jest.fn();
  const pointer = (x: number, y: number) => ({
    clientX: x * 2 + 10, clientY: y * 2 + 15, pointerId: 1, bubbles: true,
  });
  return { container, overlay, pointer };
};

it('applies the resize release coordinate even without an intermediate move', () => {
  const { container, overlay, pointer } = mount();
  const handle = container.querySelector('[data-floating-handle="right"]')!;
  fireEvent.pointerDown(handle, pointer(60, 40));
  fireEvent.pointerUp(overlay, pointer(72, 40));
  expect(updateFloatingPasteRect).toHaveBeenLastCalledWith({ x: 20, y: 30, width: 52, height: 20 });
  fireEvent.pointerMove(overlay, pointer(90, 40));
  expect(updateFloatingPasteRect).toHaveBeenCalledTimes(1);
});

it('uses the latest release position after an earlier resize move', () => {
  const { container, overlay, pointer } = mount();
  fireEvent.pointerDown(container.querySelector('[data-floating-handle="bottom"]')!, pointer(40, 50));
  fireEvent.pointerMove(overlay, pointer(40, 55));
  fireEvent.pointerUp(overlay, pointer(40, 63));
  expect(updateFloatingPasteRect).toHaveBeenLastCalledWith({ x: 20, y: 30, width: 40, height: 33 });
});

it('applies the move release coordinate at the current zoom and offset', () => {
  const { container, overlay, pointer } = mount();
  const mover = container.querySelector('[style*="cursor: move"]')!;
  fireEvent.pointerDown(mover, pointer(40, 40));
  fireEvent.pointerUp(overlay, pointer(48, 46));
  expect(updateFloatingPasteRect).toHaveBeenLastCalledWith({ x: 28, y: 36, width: 40, height: 20 });
});

it('applies rotation and the release event snapping modifier', () => {
  const { container, overlay, pointer } = mount();
  fireEvent.pointerDown(container.querySelector('[data-floating-rotate-handle]')!, pointer(40, 10));
  fireEvent.pointerUp(overlay, { ...pointer(66, 25), shiftKey: true });
  expect(updateFloatingPasteRotation).toHaveBeenLastCalledWith(60);
});

it('does not apply cancellation coordinates as a terminal move', () => {
  const { container, overlay, pointer } = mount();
  fireEvent.pointerDown(container.querySelector('[data-floating-handle="right"]')!, pointer(60, 40));
  fireEvent.pointerCancel(overlay, pointer(72, 40));
  fireEvent.pointerUp(overlay, pointer(80, 40));
  expect(updateFloatingPasteRect).not.toHaveBeenCalled();
});

it.each(
  [1, 2].flatMap((button) => [
    { button, selector: '[style*="cursor: move"]', label: 'move' },
    { button, selector: '[data-floating-handle="right"]', label: 'resize' },
    { button, selector: '[data-floating-rotate-handle]', label: 'rotate' },
  ]),
)('ignores button $button for floating $label', ({ button, selector }) => {
  const { container, overlay, pointer } = mount();
  fireEvent.pointerDown(container.querySelector(selector)!, { ...pointer(60, 40), button });
  fireEvent.pointerMove(overlay, { ...pointer(70, 50), buttons: button === 1 ? 4 : 2 });
  fireEvent.pointerUp(overlay, { ...pointer(80, 60), button });
  expect(overlay.setPointerCapture).not.toHaveBeenCalled();
  expect(updateFloatingPasteRect).not.toHaveBeenCalled();
  expect(updateFloatingPasteRotation).not.toHaveBeenCalled();
});
