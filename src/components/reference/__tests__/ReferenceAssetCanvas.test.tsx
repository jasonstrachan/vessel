import { fireEvent, render, screen } from '@testing-library/react';

import { ReferenceAssetCanvas } from '@/components/reference/ReferenceAssetCanvas';
import type { ReferenceAsset } from '@/types';

const asset: ReferenceAsset = {
  id: 'reference-1',
  name: 'Portrait',
  dataUrl: 'data:image/png;base64,dGVzdA==',
  naturalWidth: 400,
  naturalHeight: 600,
  visible: true,
  locked: false,
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  flipX: false,
  flipY: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('ReferenceAssetCanvas', () => {
  it('draws resize handles only around the selected unlocked image', () => {
    render(
      <ReferenceAssetCanvas
        asset={asset}
        originX={0}
        originY={0}
        viewScale={1}
        isSelected
        onSelect={jest.fn()}
        onPreview={jest.fn()}
        onCommit={jest.fn()}
        onClearPreview={jest.fn()}
      />,
    );

    const reference = screen.getByTestId('reference-asset-reference-1');
    expect(reference.className).not.toContain('border');
    expect(reference).toHaveStyle({ zIndex: 2 });
    expect(screen.getByTestId('reference-selection-reference-1')).toHaveStyle({ zIndex: 5 });
    expect(screen.getByTestId('reference-selection-reference-1')).toHaveClass('pointer-events-none');
    expect(screen.getByTestId('reference-resize-top-left')).toBeInTheDocument();
    expect(screen.getByTestId('reference-resize-top-right')).toBeInTheDocument();
    expect(screen.getByTestId('reference-resize-bottom-right')).toBeInTheDocument();
    expect(screen.getByTestId('reference-resize-bottom-left')).toBeInTheDocument();
    expect(screen.getByTestId('reference-resize-bottom-left')).toHaveClass('pointer-events-auto');
    expect(screen.queryByText('Portrait')).not.toBeInTheDocument();
  });

  it('previews a proportional corner resize and commits it once', () => {
    const onPreview = jest.fn();
    const onCommit = jest.fn();
    render(
      <ReferenceAssetCanvas
        asset={{ ...asset, x: 10, y: 20 }}
        originX={0}
        originY={0}
        viewScale={2}
        isSelected
        onSelect={jest.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
        onClearPreview={jest.fn()}
      />,
    );

    const handle = screen.getByTestId('reference-resize-bottom-right');
    Object.defineProperty(handle, 'setPointerCapture', { configurable: true, value: jest.fn() });
    Object.defineProperty(handle, 'hasPointerCapture', { configurable: true, value: jest.fn(() => false) });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      return event;
    };

    fireEvent(handle, pointerEvent('pointerdown', 100, 100));
    fireEvent(handle, pointerEvent('pointermove', 300, 400));

    expect(onPreview).toHaveBeenCalledWith(asset.id, { x: 10, y: 20, scale: 1.25 });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent(handle, pointerEvent('pointerup', 300, 400));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(asset.id, { x: 10, y: 20, scale: 1.25 });
  });

  it('keeps resize handles unavailable while the selected image is locked', () => {
    render(
      <ReferenceAssetCanvas
        asset={{ ...asset, locked: true }}
        originX={0}
        originY={0}
        viewScale={1}
        isSelected
        onSelect={jest.fn()}
        onPreview={jest.fn()}
        onCommit={jest.fn()}
        onClearPreview={jest.fn()}
      />,
    );

    expect(screen.getByTestId('reference-selection-reference-1')).toBeInTheDocument();
    expect(screen.queryByTestId('reference-resize-bottom-right')).not.toBeInTheDocument();
  });

  it('does not publish project updates during pointer movement', () => {
    const onPreview = jest.fn();
    const onCommit = jest.fn();
    render(
      <ReferenceAssetCanvas
        asset={{ ...asset, x: 10, y: 20 }}
        originX={0}
        originY={0}
        viewScale={2}
        isSelected={false}
        onSelect={jest.fn()}
        onPreview={onPreview}
        onCommit={onCommit}
        onClearPreview={jest.fn()}
      />,
    );

    const reference = screen.getByTestId('reference-asset-reference-1');
    Object.defineProperty(reference, 'setPointerCapture', { configurable: true, value: jest.fn() });
    Object.defineProperty(reference, 'releasePointerCapture', { configurable: true, value: jest.fn() });

    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    fireEvent(reference, pointerEvent('pointerdown', 100, 100));
    fireEvent(reference, pointerEvent('pointermove', 120, 80));
    fireEvent(reference, pointerEvent('pointermove', 140, 60));

    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent(reference, pointerEvent('pointerup', 140, 60));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(asset.id, { x: 30, y: 0 });
  });

  it('clears a drag preview when the reference returns to its starting position', () => {
    const onCommit = jest.fn();
    const onClearPreview = jest.fn();
    render(
      <ReferenceAssetCanvas
        asset={{ ...asset, x: 10, y: 20 }}
        originX={0}
        originY={0}
        viewScale={1}
        isSelected={false}
        onSelect={jest.fn()}
        onPreview={jest.fn()}
        onCommit={onCommit}
        onClearPreview={onClearPreview}
      />,
    );

    const reference = screen.getByTestId('reference-asset-reference-1');
    Object.defineProperty(reference, 'setPointerCapture', { configurable: true, value: jest.fn() });
    Object.defineProperty(reference, 'hasPointerCapture', { configurable: true, value: jest.fn(() => false) });
    const pointerEvent = (type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    fireEvent(reference, pointerEvent('pointerdown', 100, 100));
    fireEvent(reference, pointerEvent('pointermove', 140, 120));
    fireEvent(reference, pointerEvent('pointermove', 100, 100));
    fireEvent(reference, pointerEvent('pointerup', 100, 100));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onClearPreview).toHaveBeenCalledWith(asset.id);
  });

  it('continues when pointer capture is unavailable', () => {
    const onCommit = jest.fn();
    render(
      <ReferenceAssetCanvas
        asset={asset}
        originX={0}
        originY={0}
        viewScale={1}
        isSelected={false}
        onSelect={jest.fn()}
        onPreview={jest.fn()}
        onCommit={onCommit}
        onClearPreview={jest.fn()}
      />,
    );

    const reference = screen.getByTestId('reference-asset-reference-1');
    Object.defineProperty(reference, 'setPointerCapture', {
      configurable: true,
      value: jest.fn(() => { throw new DOMException('Unavailable', 'NotFoundError'); }),
    });
    const pointerEvent = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX, clientY: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };

    expect(() => fireEvent(reference, pointerEvent('pointerdown', 0))).not.toThrow();
    fireEvent(reference, pointerEvent('pointermove', 20));
    fireEvent(reference, pointerEvent('pointerup', 20));
    expect(onCommit).toHaveBeenCalledWith(asset.id, { x: 20, y: 0 });
  });
});
