import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import ColorPicker from '../ColorPicker';

describe('ColorPicker', () => {
  const originalSetPointerCapture = HTMLDivElement.prototype.setPointerCapture;
  const originalReleasePointerCapture = HTMLDivElement.prototype.releasePointerCapture;

  beforeAll(() => {
    if (typeof window.PointerEvent === 'undefined') {
      class PointerEventShim extends MouseEvent {
        constructor(type: string, props?: PointerEventInit) {
          super(type, props);
        }
      }
      // @ts-expect-error - assign shim for test environment
      window.PointerEvent = PointerEventShim;
    }
  });

  beforeEach(() => {
    HTMLDivElement.prototype.setPointerCapture = jest.fn();
    HTMLDivElement.prototype.releasePointerCapture = jest.fn();
  });

  afterEach(() => {
    HTMLDivElement.prototype.setPointerCapture = originalSetPointerCapture;
    HTMLDivElement.prototype.releasePointerCapture = originalReleasePointerCapture;
  });

  const mockSurfaceRect = (
    surface: HTMLDivElement,
    { left, top, width, height }: { left: number; top: number; width: number; height: number },
  ) => {
    jest.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    });
  };

  it('keeps colours and selection working when canvas contexts are unavailable', () => {
    const getContext = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      const onChange = jest.fn();
      const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
      const [sv, hue] = Array.from(container.querySelectorAll<HTMLDivElement>('[data-color-picker]'));
      mockSurfaceRect(sv, { left: 0, top: 0, width: 212, height: 212 });
      mockSurfaceRect(hue, { left: 212, top: 0, width: 28, height: 212 });
      expect(sv.children).toHaveLength(196);
      expect(sv.children[0]).toHaveStyle({ backgroundColor: '#ffffff' });
      expect(sv.children[195]).toHaveStyle({ backgroundColor: '#000000' });
      expect(hue.style.background).toContain('linear-gradient');

      fireEvent.pointerDown(hue, { clientX: 226, clientY: 106, pointerId: 1 });
      fireEvent.pointerUp(hue, { pointerId: 1 });
      expect(sv.children[13]).toHaveStyle({ backgroundColor: '#12ffff' });
      fireEvent.pointerDown(sv, { clientX: 113, clientY: 113, pointerId: 2 });
      fireEvent.pointerUp(sv, { pointerId: 2 });
      expect(onChange).toHaveBeenLastCalledWith('#408080');
      expect(getContext).not.toHaveBeenCalled();
    } finally {
      getContext.mockRestore();
    }
  });

  it('selects the displayed cell colour when its size has fractional grid boundaries', () => {
    const width = jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(151);
    try {
      const onChange = jest.fn();
      const { container } = render(<ColorPicker color="#00FFFF" onChange={onChange} />);
      const sv = container.querySelector<HTMLDivElement>('[data-color-picker="sv"]')!;
      mockSurfaceRect(sv, { left: 0, top: 0, width: 123, height: 123 });
      expect(sv.children[7 * 14 + 7]).toHaveStyle({ backgroundColor: '#408080' });
      fireEvent.pointerDown(sv, { clientX: 123 * 7.5 / 14, clientY: 123 * 7.5 / 14, pointerId: 1 });
      expect(onChange).toHaveBeenLastCalledWith('#408080');
    } finally {
      width.mockRestore();
    }
  });

  it('renders with provided color and calls onChange for hex input', () => {
    const onChange = jest.fn();
    const { getByDisplayValue } = render(
      <ColorPicker color="#336699" onChange={onChange} showHexInput />
    );

    const hexInput = getByDisplayValue('#336699');
    fireEvent.change(hexInput, { target: { value: '#112233' } });
    fireEvent.blur(hexInput);

    expect(onChange).toHaveBeenCalledWith('#112233');
  });

  it('calls onCommit when the user releases SV pointer', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const { container } = render(
      <ColorPicker color="#336699" onChange={onChange} onCommit={onCommit} />
    );

    const surfaces = container.querySelectorAll<HTMLDivElement>('[data-color-picker]');
    const svSurface = surfaces[0];
    expect(svSurface).toBeTruthy();

    fireEvent.pointerDown(svSurface!, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(svSurface!, { clientX: 12, clientY: 12, pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('maps pointer coordinates from the rendered SV surface into surface space', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const svSurface = container.querySelectorAll<HTMLDivElement>('[data-color-picker]')[0];
    mockSurfaceRect(svSurface, { left: 10, top: 20, width: 424, height: 424 });

    fireEvent.pointerDown(svSurface, {
      clientX: 10 + (7.5 * 424) / 14,
      clientY: 20 + (7.5 * 424) / 14,
      pointerId: 1,
    });

    expect(onChange).toHaveBeenLastCalledWith('#804040');
  });

  it('moves the selection indicator to the exact grid cell clicked', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const svSurface = container.querySelectorAll<HTMLDivElement>('[data-color-picker]')[0];
    const indicator = container.querySelector(
      'div.pointer-events-none.absolute.left-0.top-0',
    ) as HTMLDivElement;
    mockSurfaceRect(svSurface, { left: 0, top: 0, width: 212, height: 212 });

    fireEvent.pointerDown(svSurface, {
      clientX: (1.5 * 212) / 14,
      clientY: (1.5 * 212) / 14,
      pointerId: 1,
    });
    expect(indicator.style.transform).toBe('translate(15.142857142857142px, 15.142857142857142px)');

    fireEvent.pointerDown(svSurface, {
      clientX: (1.5 * 212) / 14,
      clientY: (2.5 * 212) / 14,
      pointerId: 2,
    });
    expect(indicator.style.transform).toBe('translate(15.142857142857142px, 30.285714285714285px)');

    fireEvent.pointerDown(svSurface, {
      clientX: (2.5 * 212) / 14,
      clientY: (2.5 * 212) / 14,
      pointerId: 3,
    });
    expect(indicator.style.transform).toBe('translate(30.285714285714285px, 30.285714285714285px)');
  });

  it('maps pointer coordinates from the rendered hue surface into surface space', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const hueSurface = container.querySelectorAll<HTMLDivElement>('[data-color-picker]')[1];
    mockSurfaceRect(hueSurface, { left: 434, top: 20, width: 56, height: 424 });

    fireEvent.pointerDown(hueSurface, {
      clientX: 462,
      clientY: 232,
      pointerId: 1,
    });

    expect(onChange).toHaveBeenLastCalledWith('#00FFFF');
  });

  it('preserves the selected hue when choosing pure white or black', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#FF0000" onChange={onChange} />);
    const [svSurface, hueSurface] = Array.from(container.querySelectorAll<HTMLDivElement>('[data-color-picker]'));
    mockSurfaceRect(svSurface, { left: 0, top: 0, width: 212, height: 212 });
    mockSurfaceRect(hueSurface, { left: 212, top: 0, width: 28, height: 212 });

    fireEvent.pointerDown(hueSurface, {
      clientX: 226,
      clientY: 212 / 3,
      pointerId: 1,
    });
    fireEvent.pointerDown(svSurface, { clientX: 5, clientY: 5, pointerId: 2 });
    fireEvent.pointerDown(svSurface, {
      clientX: (13.5 * 212) / 14,
      clientY: (0.5 * 212) / 14,
      pointerId: 3,
    });

    expect(onChange).toHaveBeenLastCalledWith('#12FF12');

    fireEvent.pointerDown(svSurface, { clientX: 207, clientY: 207, pointerId: 4 });
    fireEvent.pointerDown(svSurface, {
      clientX: (13.5 * 212) / 14,
      clientY: (0.5 * 212) / 14,
      pointerId: 5,
    });

    expect(onChange).toHaveBeenLastCalledWith('#12FF12');
  });

  it('calls onCommit when pressing Enter in the hex input', () => {
    const onChange = jest.fn();
    const onCommit = jest.fn();
    const { getByDisplayValue } = render(
      <ColorPicker color="#336699" onChange={onChange} onCommit={onCommit} showHexInput />
    );

    const hexInput = getByDisplayValue('#336699');
    fireEvent.change(hexInput, { target: { value: '#445566' } });
    fireEvent.keyDown(hexInput, { key: 'Enter', code: 'Enter', charCode: 13 });

    expect(onCommit).toHaveBeenCalledTimes(3);
  });

  it('keeps SV indicator in-bounds for pure black', () => {
    const onChange = jest.fn();
    const { container } = render(<ColorPicker color="#000000" onChange={onChange} />);
    const indicator = container.querySelector('div.pointer-events-none.absolute.left-0.top-0') as HTMLDivElement;

    expect(indicator).toBeTruthy();
    expect(indicator.style.transform).toMatch(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);

    const [, x, y] = indicator.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/) || [];
    expect(Number(x)).toBeLessThan(212);
    expect(Number(y)).toBeLessThan(212);
    expect(Number(x)).toBeGreaterThan(190);
    expect(Number(y)).toBeGreaterThan(190);
  });
});
