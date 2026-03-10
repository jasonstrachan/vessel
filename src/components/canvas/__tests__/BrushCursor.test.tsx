import { render } from '@testing-library/react';
import BrushCursor from '../BrushCursor';

describe('BrushCursor', () => {
  const getContext = jest.fn(() => ({
    clearRect: jest.fn(),
    putImageData: jest.fn(),
  }));

  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: getContext,
    });
  });

  beforeEach(() => {
    getContext.mockClear();
  });

  it('renders a custom brush cursor with preserved aspect ratio', () => {
    const imageData = {
      width: 20,
      height: 10,
      data: new Uint8ClampedArray(20 * 10 * 4),
    } as ImageData;

    const { container } = render(
      <BrushCursor
        descriptor={{
          kind: 'custom-brush',
          pixelSize: 40,
          pixelWidth: 40,
          pixelHeight: 20,
          imageData,
        }}
        zoom={2}
        visible
      />
    );

    const cursor = container.firstChild as HTMLElement;
    expect(cursor).not.toBeNull();
    expect(cursor.style.width).toBe('80px');
    expect(cursor.style.height).toBe('40px');
    expect(cursor.style.outline).toBe('1px solid white');
    expect(cursor.querySelector('canvas')).not.toBeNull();
  });
});
