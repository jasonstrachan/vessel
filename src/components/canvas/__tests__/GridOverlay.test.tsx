import { render, screen } from '@testing-library/react';
import React from 'react';

import GridOverlay from '@/components/canvas/GridOverlay';

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
});
