import React from 'react';
import { render, screen } from '@testing-library/react';

import { RulerOverlay } from '../RulerOverlay';

const defaults = {
  enabled: true,
  projectWidth: 256,
  projectHeight: 256,
  viewportWidth: 800,
  viewportHeight: 600,
  zoom: 1,
  offsetX: 260,
  offsetY: 250,
};

const ticks = (axis = 'Horizontal') => Array.from(
  screen.getByRole('img', { name: `${axis} ruler` }).querySelectorAll('line[data-coordinate]'),
);

describe('RulerOverlay document coordinates', () => {
  it.each([
    { enabled: false }, { projectWidth: 0 }, { projectHeight: -1 },
    { viewportWidth: 0 }, { viewportHeight: Number.NaN },
    { zoom: 0 }, { zoom: Number.POSITIVE_INFINITY }, { offsetX: Number.NaN },
  ])('omits unavailable/invalid geometry %j', override => {
    const { container } = render(<RulerOverlay {...defaults} {...override} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('uses two pointer-transparent 20px clipped CSS strips and a blank corner', () => {
    const { container } = render(<RulerOverlay {...defaults} />);
    const horizontal = screen.getByRole('img', { name: 'Horizontal ruler' });
    const vertical = screen.getByRole('img', { name: 'Vertical ruler' });
    expect(horizontal).toHaveAttribute('height', '20');
    expect(horizontal).toHaveAttribute('viewBox', '0 0 800 20');
    expect(vertical).toHaveAttribute('width', '20');
    expect(vertical).toHaveAttribute('viewBox', '0 0 20 600');
    expect(container.firstElementChild).toHaveClass('pointer-events-none');
    expect(horizontal).toHaveClass('pointer-events-none');
    expect(vertical).toHaveClass('pointer-events-none');
    expect(container.querySelector('[data-ruler-corner]')).toHaveStyle({ width: '20px', height: '20px' });
    expect(container.querySelectorAll('button, input, [tabindex]')).toHaveLength(0);
    expect(horizontal.querySelector('clipPath rect')).toHaveAttribute('x', '20');
    expect(vertical.querySelector('clipPath rect')).toHaveAttribute('y', '20');
  });

  it('positions literal document values at offset+coordinate*zoom, independently per axis', () => {
    const { rerender } = render(<RulerOverlay {...defaults} />);
    expect(ticks().find(e => e.getAttribute('data-coordinate') === '0')).toHaveAttribute('x1', '260');
    expect(ticks().find(e => e.getAttribute('data-coordinate') === '50')).toHaveAttribute('x1', '310');
    expect(ticks('Vertical').find(e => e.getAttribute('data-coordinate') === '50')).toHaveAttribute('y1', '300');
    rerender(<RulerOverlay {...defaults} zoom={2} />);
    expect(ticks().find(e => e.getAttribute('data-coordinate') === '50')).toHaveAttribute('x1', '360');
    expect(ticks('Vertical').find(e => e.getAttribute('data-coordinate') === '50')).toHaveAttribute('y1', '350');
  });

  it.each([
    { zoom: 0.1, major: 500, minor: 100 },
    { zoom: 19, major: 5, minor: 1 },
    { zoom: 20, major: 5, minor: 1 },
    { zoom: 40, major: 2, minor: 1 },
  ])('chooses integer 1/2/5 spacing at zoom $zoom', ({ zoom, major, minor }) => {
    render(<RulerOverlay {...defaults} projectWidth={1e9} projectHeight={1e9} zoom={zoom} offsetX={0} offsetY={0} />);
    const ruler = screen.getByRole('img', { name: 'Horizontal ruler' });
    expect(ruler).toHaveAttribute('data-major-step', String(major));
    expect(ruler).toHaveAttribute('data-minor-step', String(minor));
    expect(major * zoom).toBeGreaterThanOrEqual(48);
    expect(minor * zoom).toBeGreaterThanOrEqual(8);
    const values = ticks().map(e => Number(e.getAttribute('data-coordinate')));
    expect(values.every(Number.isInteger)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('clips the corner and both document limits with no negative/duplicate ticks', () => {
    render(<RulerOverlay {...defaults} offsetX={-30} offsetY={-40} />);
    for (const [axis, attribute, limit] of [['Horizontal', 'x1', 800], ['Vertical', 'y1', 600]] as const) {
      for (const tick of ticks(axis)) {
        expect(Number(tick.getAttribute(attribute))).toBeGreaterThanOrEqual(20);
        expect(Number(tick.getAttribute(attribute))).toBeLessThanOrEqual(Number(limit));
        expect(Number(tick.getAttribute('data-coordinate'))).toBeGreaterThanOrEqual(0);
        expect(Number(tick.getAttribute('data-coordinate'))).toBeLessThanOrEqual(256);
      }
    }
    expect(screen.getAllByRole('img').flatMap(e => Array.from(e.querySelectorAll('text'))).some(e => e.textContent === '-0')).toBe(false);
  });

  it('includes a visible document endpoint once when it falls on an integer tick', () => {
    render(<RulerOverlay {...defaults} projectWidth={250} />);
    expect(ticks().filter(e => e.getAttribute('data-coordinate') === '250')).toHaveLength(1);
  });

  it('enumerates only a bounded visible window of a huge document and handles offscreen/unsafe values', () => {
    const { rerender } = render(<RulerOverlay {...defaults} projectWidth={1e9} projectHeight={1e9} offsetX={-1e8} offsetY={-1e8} />);
    expect(ticks().length + ticks('Vertical').length).toBeLessThanOrEqual((800 + 600) / 8 + 4);
    expect(ticks().length).toBeGreaterThan(0);
    rerender(<RulerOverlay {...defaults} offsetX={1e8} offsetY={1e8} />);
    expect(ticks()).toHaveLength(0);
    expect(ticks('Vertical')).toHaveLength(0);
    rerender(<RulerOverlay {...defaults} projectWidth={Number.MAX_VALUE} />);
    expect(screen.queryByRole('img', { name: 'Horizontal ruler' })).not.toBeInTheDocument();
  });

  it('changes only visible enumeration/strip lengths on CSS resize, independent of DPR', () => {
    const { rerender } = render(<RulerOverlay {...defaults} />);
    const first = ticks().map(e => [e.getAttribute('data-coordinate'), e.getAttribute('x1')]);
    rerender(<RulerOverlay {...defaults} viewportWidth={350} viewportHeight={300} />);
    expect(screen.getByRole('img', { name: 'Horizontal ruler' })).toHaveAttribute('width', '350');
    expect(ticks().map(e => [e.getAttribute('data-coordinate'), e.getAttribute('x1')])).toEqual(first.filter(e => Number(e[1]) <= 350));
  });

  it('uses the same CSS SVG geometry for a different physical backing DPR', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    try {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
      const { container, rerender } = render(<RulerOverlay {...defaults} />);
      const before = container.innerHTML;
      Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
      rerender(<RulerOverlay {...defaults} />);
      expect(container.innerHTML).toBe(before);
    } finally {
      if (original) Object.defineProperty(window, 'devicePixelRatio', original);
    }
  });

});
