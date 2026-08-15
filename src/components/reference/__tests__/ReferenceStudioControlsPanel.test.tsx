import { render, screen } from '@testing-library/react';

import { ReferenceStudioControlsPanel } from '@/components/reference/ReferenceStudioControlsPanel';
import type { ReferenceStudioSnapshot } from '@/referenceStudio/referenceStudioChannel';
import type { ReferenceAsset } from '@/types';

const asset: ReferenceAsset = {
  id: 'reference-1',
  name: 'Portrait reference',
  dataUrl: 'data:image/png;base64,AAAA',
  naturalWidth: 400,
  naturalHeight: 600,
  visible: true,
  locked: false,
  opacity: 0.8,
  x: 20,
  y: 30,
  scale: 0.75,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  flipX: false,
  flipY: false,
  createdAt: 1,
  updatedAt: 1,
};

const snapshot: ReferenceStudioSnapshot = {
  project: {
    id: 'project-1',
    name: 'Portrait',
    width: 800,
    height: 1000,
  },
  grid: {
    enabled: true,
    rows: 4,
    columns: 4,
  },
  layers: [{ id: 'layer-1', name: 'Paint' }] as ReferenceStudioSnapshot['layers'],
  referenceAssets: [asset],
  samplingSource: { kind: 'canvas' },
};

const renderPanel = () => render(
  <ReferenceStudioControlsPanel
    project={snapshot.project!}
    grid={snapshot.grid}
    layers={snapshot.layers}
    assets={snapshot.referenceAssets}
    samplingSource={snapshot.samplingSource}
    selectedId={asset.id}
    viewScale={0.5}
    error={null}
    onHide={jest.fn()}
    onImportFiles={jest.fn()}
    onSelectAsset={jest.fn()}
    onPreviewAsset={jest.fn()}
    onUpdateAsset={jest.fn()}
    onRemoveAsset={jest.fn()}
    onMoveAssetToTop={jest.fn()}
    onFitSelectedAsset={jest.fn()}
    onSetSamplingSource={jest.fn()}
    onSetGrid={jest.fn()}
  />,
);

describe('ReferenceStudioControlsPanel design contract', () => {
  it('uses Vessel panel dimensions, hierarchy, rows, and shared controls', () => {
    const { container } = renderPanel();

    const panel = screen.getByTestId('reference-controls');
    expect(panel).toHaveClass('w-[260px]');
    expect(panel).toHaveAttribute('data-vessel-panel', 'true');
    expect(screen.getByText('Sample source')).toHaveClass('text-sm', 'font-medium');
    expect(screen.queryByText('SAMPLE FROM')).not.toBeInTheDocument();

    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('button', { name: 'Canvas composite' })).toBeInTheDocument();

    const switches = container.querySelectorAll('.switch');
    expect(switches).toHaveLength(3);
    expect(screen.getByRole('slider', { name: 'Reference scale' })).toHaveClass('slider');
    expect(screen.getByRole('slider', { name: 'Reference opacity' })).toHaveClass('slider');
    expect(screen.getAllByRole('spinbutton').every((input) => input.className.includes('!border-0'))).toBe(true);

    const selectedRow = screen.getByRole('button', { name: asset.name }).closest('[data-selected]');
    expect(selectedRow).toHaveAttribute('data-selected', 'true');
    expect(selectedRow).toHaveClass('bg-[#E8F2FF]');
    expect(selectedRow?.className).not.toContain('border');

    screen.getAllByTestId('reference-section-divider').forEach((divider) => {
      expect(divider.className).not.toContain('border');
    });
  });
});
