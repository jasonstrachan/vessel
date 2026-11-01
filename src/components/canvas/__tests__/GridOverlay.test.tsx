import { render, screen } from '@testing-library/react';
import React from 'react';

import GridOverlay from '@/components/canvas/GridOverlay';
import { DEFAULT_PIXEL_GRID_ZOOM_THRESHOLD } from '@/constants/canvas';

describe('GridOverlay', () => {
  it('does not render when disabled', () => {
    const { container } = render(
      <GridOverlay
        enabled={false}
        projectWidth={100}
        projectHeight={50}
        zoom={1}
        offsetX={0}
        offsetY={0}
        rows={4}
        columns={5}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders project-aligned grid geometry', () => {
    render(
      <GridOverlay
        enabled={true}
        projectWidth={100}
        projectHeight={50}
        zoom={2}
        offsetX={15}
        offsetY={20}
        rows={5}
        columns={4}
      />,
    );

    const svg = screen.getByTestId('grid-overlay');
    expect(svg).toHaveAttribute('width', '200');
    expect(svg).toHaveAttribute('height', '100');
    expect(svg).toHaveAttribute('viewBox', '0 0 200 100');
    expect(svg).toHaveStyle({ left: '15px', top: '20px', width: '200px', height: '100px' });

    const lines = svg.querySelectorAll('line');
    expect(lines).toHaveLength(14);
  });

  it('uses the selected pixel-grid threshold', () => {
    const props = {
      enabled: false, projectWidth: 100, projectHeight: 50, zoom: 20,
      offsetX: 0, offsetY: 0, rows: 4, columns: 4, showPixelGridAtMaxZoom: true,
    };
    const { rerender } = render(<GridOverlay {...props} pixelGridZoomThreshold={20} />);
    expect(screen.getByTestId('pixel-grid-overlay')).toBeInTheDocument();
    rerender(<GridOverlay {...props} pixelGridZoomThreshold={30} />);
    expect(screen.queryByTestId('pixel-grid-overlay')).not.toBeInTheDocument();
  });

  it('keeps the pixel grid hidden at 2000% and renders it from 3000% zoom by default', () => {
    const { rerender } = render(
      <GridOverlay
        enabled={false}
        projectWidth={100}
        projectHeight={50}
        zoom={20}
        offsetX={15}
        offsetY={20}
        rows={5}
        columns={4}
        showPixelGridAtMaxZoom
      />,
    );

    expect(screen.queryByTestId('pixel-grid-overlay')).not.toBeInTheDocument();

    rerender(
      <GridOverlay
        enabled={false}
        projectWidth={100}
        projectHeight={50}
        zoom={DEFAULT_PIXEL_GRID_ZOOM_THRESHOLD}
        offsetX={15}
        offsetY={20}
        rows={5}
        columns={4}
        showPixelGridAtMaxZoom
      />,
    );

    const pixelGrid = screen.getByTestId('pixel-grid-overlay');
    expect(pixelGrid).toHaveAttribute('viewBox', '0 0 3000 1500');
    expect(pixelGrid).toHaveStyle({ left: '15px', top: '20px', width: '3000px', height: '1500px' });
    expect(pixelGrid.querySelector('pattern')).toHaveAttribute('width', String(DEFAULT_PIXEL_GRID_ZOOM_THRESHOLD));
    const pixelGridPaths = pixelGrid.querySelectorAll('path');
    expect(pixelGridPaths).toHaveLength(1);
    expect(pixelGridPaths[0]).toHaveAttribute('stroke', 'rgba(255, 255, 255, 0.5)');
    expect(pixelGridPaths[0]).toHaveAttribute('stroke-width', '2');
    expect(screen.queryByTestId('grid-overlay')).not.toBeInTheDocument();
  });
});
