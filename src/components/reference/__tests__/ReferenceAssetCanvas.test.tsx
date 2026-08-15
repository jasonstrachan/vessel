import { render, screen } from '@testing-library/react';

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
  it('does not draw selection chrome around the image', () => {
    render(
      <ReferenceAssetCanvas
        asset={asset}
        originX={0}
        originY={0}
        viewScale={1}
        selected
        onSelect={jest.fn()}
        onUpdate={jest.fn()}
      />,
    );

    const reference = screen.getByTestId('reference-asset-reference-1');
    expect(reference.className).not.toContain('border');
    expect(screen.queryByText('Portrait')).not.toBeInTheDocument();
  });
});
