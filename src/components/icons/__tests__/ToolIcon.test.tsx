import { render } from '@testing-library/react';

import { TOOL_BITMAPS, ToolIcon } from '@/components/icons/ToolIcon';

describe('ToolIcon', () => {
  it.each(Object.entries(TOOL_BITMAPS))('%s is a 12 × 12 bitmap of known cells', (_tool, rows) => {
    expect(rows).toHaveLength(12);
    rows.forEach((row) => expect(row).toMatch(/^[.#+]{12}$/));
  });

  it('merges each tone into a single crisp path', () => {
    const { container } = render(<ToolIcon tool="load" />);
    const svg = container.querySelector('svg');
    const [tone, ink] = Array.from(container.querySelectorAll('path'));

    expect(svg).toHaveAttribute('viewBox', '0 0 12 12');
    expect(svg).toHaveAttribute('width', '24');
    expect(svg).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(tone).toHaveAttribute('opacity', '0.4');
    expect(ink.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
  });

  it('omits the tone path for single-tone icons and falls back to the brush', () => {
    expect(render(<ToolIcon tool="selection" />).container.querySelectorAll('path')).toHaveLength(1);
    const fallback = render(<ToolIcon tool="unknown" />).container.innerHTML;
    expect(fallback).toBe(render(<ToolIcon tool="brush" />).container.innerHTML);
  });
});
